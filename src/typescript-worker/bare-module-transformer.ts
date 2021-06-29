/**
 * @license
 * Copyright 2021 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import * as esModuleLexer from 'es-module-lexer';
import {
  MergedAsyncIterables,
  parseNpmStyleSpecifier,
  resolveUrlPath,
  charToLineAndChar,
  fileExtension,
  isExactVersion,
  classifySpecifier,
  relativeUrlPath,
} from './util.js';
import {Deferred} from '../shared/deferred.js';

import type {
  BuildOutput,
  DiagnosticBuildOutput,
  FileBuildOutput,
} from '../shared/worker-api.js';
import type {ModuleResolver} from './module-resolver.js';
import type {CachingCdn} from './cdn.js';
import type {NpmFileLocation, PackageJson} from './util.js';

export class BareModuleTransformer {
  // private _moduleResolver: ModuleResolver;
  private _cdn: CachingCdn;
  private _alreadyHandled = new Set<string>();

  constructor(_moduleResolver: ModuleResolver, cdn: CachingCdn) {
    // this._moduleResolver = moduleResolver;
    this._cdn = cdn;
  }

  async *process(
    results: AsyncIterable<BuildOutput> | Iterable<BuildOutput>
  ): AsyncIterable<BuildOutput> {
    const merged = new MergedAsyncIterables<BuildOutput>();
    merged.add(this._process(results, merged));
    yield* merged;
  }

  private async *_process(
    results: AsyncIterable<BuildOutput> | Iterable<BuildOutput>,
    merged: MergedAsyncIterables<BuildOutput>
  ) {
    const packageJson = new Deferred<PackageJson | undefined>();
    const getPackageJson = () => packageJson.promise;
    for await (const result of results) {
      if (result.kind === 'file' && result.file.name.endsWith('.js')) {
        merged.add(
          this._transformBareModuleSpecifiers(result, getPackageJson, merged)
        );
      } else {
        yield result;
        if (result.kind === 'file' && result.file.name === 'package.json') {
          try {
            packageJson.resolve(JSON.parse(result.file.content));
          } catch (e) {
            // TODO(aomarks) Diagnostic?
            console.error(`Invalid package.json: ${e}`);
          }
        }
      }
    }
    if (!packageJson.resolved) {
      packageJson.resolve(undefined);
    }
  }

  private async *_transformBareModuleSpecifiers(
    file: FileBuildOutput,
    getPackageJson: () => Promise<PackageJson | undefined>,
    merged: MergedAsyncIterables<BuildOutput>
  ): AsyncIterable<BuildOutput> {
    let js = file.file.content;
    let specifiers;
    await esModuleLexer.init;
    try {
      [specifiers] = esModuleLexer.parse(js);
    } catch (e) {
      yield file;
      const diagnostic = this._makeDiagnostic(e, file.file.name);
      if (diagnostic !== undefined) {
        yield diagnostic;
      }
      return;
    }
    let transforms = [];
    for (let i = specifiers.length - 1; i >= 0; i--) {
      const {n: oldSpecifier} = specifiers[i];
      if (oldSpecifier === undefined) {
        // E.g. A dynamic import that's not a static string, like
        // `import(someVariable)`. We can't handle this, skip.
        continue;
      }
      transforms.push({
        info: specifiers[i],
        newSpecifierPromise: this._transformSpecifier(
          oldSpecifier,
          file.file.name,
          getPackageJson,
          merged
        ),
      });
    }
    for (let i = transforms.length - 1; i >= 0; i--) {
      const {info, newSpecifierPromise} = transforms[i];
      const {s: start, e: end, n: oldSpecifier, d: dynamicStart} = info;
      let newSpecifier;
      try {
        newSpecifier = await newSpecifierPromise;
      } catch (e) {
        // TODO(aomarks) If this was a TypeScript file, the user isn't going to
        // see this diagnostic, since we're looking at the JS file. To show it
        // correctly on the original file, we'll need source maps support.
        yield {
          kind: 'diagnostic',
          filename: file.file.name,
          diagnostic: {
            message: `Could not resolve module "${oldSpecifier}": ${e.message}`,
            range: {
              start: charToLineAndChar(js, start),
              end: charToLineAndChar(js, end),
            },
          },
        };
        continue;
      }
      if (newSpecifier === oldSpecifier) {
        continue;
      }
      // For dynamic imports, the start/end range doesn't include quotes.
      const isDynamic = dynamicStart !== -1;
      const replacement = isDynamic ? `'${newSpecifier}'` : newSpecifier;
      js = js.substring(0, start) + replacement + js.substring(end);
    }
    file.file.content = js;
    yield file;
  }

  private async _transformSpecifier(
    specifier: string,
    referrer: string,
    getPackageJson: () => Promise<PackageJson | undefined>,
    merged: MergedAsyncIterables<BuildOutput>
  ): Promise<string> {
    const kind = classifySpecifier(specifier);
    if (kind === 'url') {
      return specifier;
    }
    if (kind === 'bare') {
      return this._transformBareSpecifier(
        specifier,
        referrer,
        getPackageJson,
        merged
      );
    }
    // Relative
    if (!referrer.startsWith('node_modules/')) {
      // Project local file, nothing special to do.
      return specifier;
    }
    const absolute = resolveUrlPath(referrer, specifier);
    const bare = absolute.slice('/node_modules/'.length);
    if (!fileExtension(specifier)) {
      // We can't simply return the existing relative specifier here, because we
      // still need to do path canonicalization. For example: "./bar" could
      // refer to "./bar.js" or "./bar/index.js" depending on what files are
      // published to this package, and we need to consult the CDN to find that
      // out.
      return this._transformBareSpecifier(
        bare,
        referrer,
        // TODO(aomarks) Refactor to make this less weird? We don't need a
        // package.json here, because the version is already in the specifier.
        // We wouldn't want to pass getPackageJson, because that's for the wrong
        // package.
        async () => undefined,
        merged
      );
    }
    const location = parseNpmStyleSpecifier(bare);
    if (location === undefined) {
      throw new Error('wtf');
    }
    merged.add(this._handleDependency(location, merged));
    return specifier;
  }

  private async _transformBareSpecifier(
    specifier: string,
    referrer: string,
    getPackageJson: () => Promise<PackageJson | undefined>,
    merged: MergedAsyncIterables<BuildOutput>
  ): Promise<string> {
    let location = parseNpmStyleSpecifier(specifier);
    if (location === undefined) {
      throw new Error(`Invalid specifier: ${specifier}`);
    }
    if (!location.version) {
      location.version =
        (await getPackageJson())?.dependencies?.[location.pkg] ?? 'latest';
    }
    if (location.path === '') {
      const packageJson = await this._cdn.fetchPackageJson(location);
      location.path = packageJson.module ?? packageJson.main ?? 'index.js';
    }
    if (!fileExtension(location.path) || !isExactVersion(location.version)) {
      location = await this._cdn.canonicalize(location);
    }
    merged.add(this._handleDependency(location, merged));
    const absolute = `node_modules/${location.pkg}@${location.version}/${location.path}`;
    const relative = relativeUrlPath(referrer, absolute);
    return relative;
  }

  private async *_handleDependency(
    location: NpmFileLocation,
    merged: MergedAsyncIterables<BuildOutput>
  ) {
    const key = `${location.pkg}@${location.version}/${location.path}`;
    if (this._alreadyHandled.has(key)) {
      return;
    }
    this._alreadyHandled.add(key);
    let asset;
    try {
      asset = await this._cdn.fetch(location);
    } catch (e) {
      // TODO(aomarks) A better error.
      console.error('x', e);
      return;
    }
    let packageJson: PackageJson | undefined | null = null;
    const getPackageJson = async (): Promise<PackageJson | undefined> => {
      if (packageJson === null) {
        try {
          packageJson = await this._cdn.fetchPackageJson(location);
        } catch {
          packageJson = undefined;
        }
      }
      return packageJson;
    };
    yield* this._transformBareModuleSpecifiers(
      {
        kind: 'file',
        file: {
          name: `node_modules/${location.pkg}@${location.version}/${location.path}`,
          content: asset.content,
          contentType: asset.contentType,
        },
      },
      getPackageJson,
      merged
    );
  }

  private _makeDiagnostic(
    e: Error,
    filename: string
  ): DiagnosticBuildOutput | undefined {
    const match = e.message.match(/@:(\d+):(\d+)$/);
    if (match === null) {
      return undefined;
    }
    const line = Number(match[1]) - 1;
    const character = Number(match[2]) - 1;
    return {
      kind: 'diagnostic',
      filename,
      diagnostic: {
        message: `es-module-lexer error: ${e.message}`,
        range: {
          start: {line, character},
          end: {line, character: character + 1},
        },
      },
    };
  }
}
