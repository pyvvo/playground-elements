/**
 * @license
 * Copyright 2021 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import ts from '../internal/typescript.js';
import {ModuleResolver} from './module-resolver.js';
import {Deferred} from '../shared/deferred.js';
import {
  parseNpmStyleSpecifier,
  changeFileExtension,
  classifySpecifier,
  resolveUrlPath,
} from './util.js';

import type {Result} from '../shared/util.js';
import type {CachingCdn} from './caching-cdn.js';
import type {PackageJson, NpmFileLocation} from './util.js';
import {
  PackageDependencies,
  DependencyGraph,
  NodeModulesDirectory,
  NodeModulesLayoutMaker,
} from './node-modules-layout-maker.js';

/**
 * Fetches typings for TypeScript imports and their transitive dependencies, and
 * for standard libraries.
 */
export class TypesFetcher {
  private readonly _cdn: CachingCdn;
  // TODO(aomarks) Apply this
  protected readonly _importMapResolver: ModuleResolver;
  private readonly _entrypointTasks: Promise<void>[] = [];
  private readonly _handledSpecifiers = new Set<string>();
  private readonly _specifierToFetchResult = new Map<
    string,
    Deferred<Result<string, number>>
  >();

  constructor(cdn: CachingCdn, importMapResolver: ModuleResolver) {
    this._cdn = cdn;
    this._importMapResolver = importMapResolver;
  }

  /**
   * Start fetching type definitions for all bare module specifiers in the given
   * TypeScript source text. Relative module specifiers are ignored.
   *
   * This function returns immediately, but begins an asynchronous walk of the
   * module import graph to fetch all typings and package.json files that will
   * be needed in order for TypeScript to type check this file. To access the
   * results, call {@link getTypings}.
   */
  addBareModuleTypings(
    sourceText: string,
    getPackageJson: () => Promise<PackageJson | undefined>
  ): void {
    const fileInfo = ts.preProcessFile(sourceText, undefined, true);
    for (const {fileName: specifier} of fileInfo.importedFiles) {
      if (classifySpecifier(specifier) === 'bare') {
        this._entrypointTasks.push(
          this._handleBareSpecifier(specifier, null, getPackageJson)
        );
      }
    }
    for (const {fileName: lib} of fileInfo.libReferenceDirectives) {
      this._entrypointTasks.push(
        this._addLibTypings(lib, null, getPackageJson)
      );
    }
  }

  /**
   * Start fetching type definitions for a built-in TypeScript lib, like "dom"
   * or "esnext".
   *
   * This function returns immediately, but begins an asynchronous walk of the
   * <reference> graph. To access the results, await {@link getTypings}.
   */
  addLibTypings(
    lib: string,
    getPackageJson: () => Promise<PackageJson | undefined>
  ): void {
    this._entrypointTasks.push(this._addLibTypings(lib, null, getPackageJson));
  }

  /**
   * Get the d.ts and package.json files that will be needed for type checking
   * for all bare modules and libs added since construction.
   *
   * @returns Promise of a Map whose keys are bare module specifiers, and values
   * are file contents. Example keys: "lit-html/lit-html.d.ts",
   * "lit-html/package.json".
   */
  async getFiles(): Promise<Map<string, string>> {
    await Promise.all(this._entrypointTasks);
    const filesByPv = new Map<string, Array<{path: string; content: string}>>();
    for (const [specifier, deferred] of this._specifierToFetchResult) {
      const fetched = await deferred.promise;
      if (fetched.error === undefined) {
        // Note that if the user writes an import for a package that doesn't
        // exist, we'll omit it here (since it will have error 404), so
        // TypeScript will fail to find a typings file, and will generate a
        // diagnostic on the bad import. So we don't actually need to do
        // anything special with errors (though we could potentially surface
        // more information).
        const {pkg, version, path} = parseNpmStyleSpecifier(specifier)!;
        const pv = `${pkg}@${version}`;
        let arr = filesByPv.get(pv);
        if (arr === undefined) {
          arr = [];
          filesByPv.set(pv, arr);
        }
        arr.push({path, content: fetched.result});
      }
    }
    const results = new Map<string, string>();
    const layouter = new NodeModulesLayoutMaker();
    const layout = layouter.layout(
      this._rootDependencies,
      this._dependencyGraph
    );
    this._buildFiles(filesByPv, layout, results, '');
    return results;
  }

  private _buildFiles(
    filesByPv: Map<string, Array<{path: string; content: string}>>,
    layout: NodeModulesDirectory,
    results: Map<string, string>,
    prefix: string
  ): void {
    if (prefix !== '') {
      prefix = prefix + '/';
    }
    for (const [pkg, {version, nodeModules: nested}] of Object.entries(
      layout
    )) {
      const pv = `${pkg}@${version}`;
      const files = filesByPv.get(pv) ?? [];
      for (const file of files) {
        const path = `${prefix}${pkg}/${file.path}`;
        results.set(path, file.content);
      }
      this._buildFiles(
        filesByPv,
        nested,
        results,
        `${prefix}${pkg}/node_modules`
      );
    }
  }

  private async _addLibTypings(
    lib: string,
    referrerSpecifier: NpmFileLocation | null,
    getPackageJson: () => Promise<PackageJson | undefined>
  ): Promise<void> {
    await this._handleBareSpecifier(
      `typescript/lib/lib.${lib.toLowerCase()}.js`,
      referrerSpecifier,
      getPackageJson
    );
  }

  private async _handleBareAndRelativeSpecifiers(
    sourceText: string,
    referrerSpecifier: NpmFileLocation | null,
    getPackageJson: () => Promise<PackageJson | undefined>
  ): Promise<void> {
    const fileInfo = ts.preProcessFile(sourceText, true, false);
    const promises = [];
    for (const {fileName: specifier} of fileInfo.importedFiles) {
      const kind = classifySpecifier(specifier);
      if (kind === 'bare') {
        promises.push(
          this._handleBareSpecifier(
            specifier,
            referrerSpecifier,
            getPackageJson
          )
        );
      } else if (kind === 'relative') {
        promises.push(
          this._handleRelativeSpecifier(
            specifier,
            referrerSpecifier,
            getPackageJson
          )
        );
      }
    }
    for (const {fileName: lib} of fileInfo.libReferenceDirectives) {
      promises.push(this.addLibTypings(lib, getPackageJson));
    }
    await Promise.all(promises);
  }

  private async _handleBareSpecifier(
    bare: string,
    referrerSpecifier: NpmFileLocation | null,
    getPackageJson: () => Promise<PackageJson | undefined>
  ): Promise<void> {
    const npm = parseNpmStyleSpecifier(bare);
    if (npm === undefined) {
      return;
    }
    if (!npm.version) {
      npm.version =
        (await getPackageJson())?.dependencies?.[npm.pkg] ?? 'latest';
    }
    const pkg = npm.pkg;
    const key = `${pkg}@${npm.version}/${npm.path}`;
    if (this._handledSpecifiers.has(key)) {
      return;
    }
    this._handledSpecifiers.add(key);
    // If there's no path, we need to discover the main module.
    let dtsPath = npm.path;
    let packageJson: PackageJson | undefined = undefined;
    if (dtsPath === '') {
      try {
        const res = await this._fetchAndAddToOutputFiles(
          {
            pkg,
            version: npm.version,
            path: 'package.json',
          },
          referrerSpecifier
        );
        if (res.error === undefined) {
          packageJson = JSON.parse(res.result) as PackageJson;
        }
      } catch (e) {
        return;
      }
      dtsPath =
        packageJson?.typings ??
        packageJson?.types ??
        (packageJson?.main !== undefined
          ? changeFileExtension(packageJson.main, 'd.ts')
          : undefined) ??
        'index.d.ts';
    } else {
      dtsPath = changeFileExtension(dtsPath, 'd.ts');
    }
    const dtsSpecifier = `${pkg}@${npm.version}/${dtsPath}`;
    if (this._handledSpecifiers.has(dtsSpecifier)) {
      return;
    }
    this._handledSpecifiers.add(dtsSpecifier);
    let dtsResult;
    try {
      dtsResult = await this._fetchAndAddToOutputFiles(
        {
          pkg,
          version: npm.version,
          path: dtsPath,
        },
        referrerSpecifier
      );
    } catch (e) {
      return;
    }
    if (dtsResult.error !== undefined) {
      return;
    }
    let packageJson2: PackageJson | undefined | null = null;
    const getPackageJson2 = async (): Promise<PackageJson | undefined> => {
      if (packageJson2 === null) {
        try {
          packageJson2 = await this._cdn.fetchPackageJson({
            pkg,
            version: npm.version,
          });
        } catch {
          packageJson2 = undefined;
        }
      }
      return packageJson2;
    };
    await this._handleBareAndRelativeSpecifiers(
      dtsResult.result,
      {
        pkg,
        version: npm.version,
        path: dtsPath,
      },
      getPackageJson2
    );
  }

  private async _handleRelativeSpecifier(
    relative: string,
    referrerSpecifier: NpmFileLocation | null,
    getPackageJson: () => Promise<PackageJson | undefined>
  ): Promise<void> {
    const jsPath = resolveUrlPath(referrerSpecifier!.path, relative).slice(1); // Remove the leading '/'.
    const dtsPath = changeFileExtension(jsPath, 'd.ts');
    const dtsSpecifier = `${referrerSpecifier!.pkg}/${dtsPath}`;
    if (this._handledSpecifiers.has(dtsSpecifier)) {
      return;
    }
    this._handledSpecifiers.add(dtsSpecifier);
    let dtsResult;
    try {
      dtsResult = await this._fetchAndAddToOutputFiles(
        {
          pkg: referrerSpecifier!.pkg,
          version: referrerSpecifier!.version,
          path: dtsPath,
        },
        referrerSpecifier
      );
    } catch {
      return;
    }
    if (dtsResult.error !== undefined) {
      return;
    }
    await this._handleBareAndRelativeSpecifiers(
      dtsResult.result,
      {
        pkg: referrerSpecifier!.pkg,
        version: referrerSpecifier!.version,
        path: dtsPath,
      },
      getPackageJson
    );
  }

  private async _fetchAndAddToOutputFiles(
    location: NpmFileLocation,
    referrerSpecifier: NpmFileLocation | null
  ): Promise<Result<string, number>> {
    location = await this._cdn.canonicalize(location);
    if (referrerSpecifier !== null) {
      referrerSpecifier = await this._cdn.canonicalize(referrerSpecifier);
    }
    const specifier = `${location.pkg}@${location.version}/${location.path}`;
    let deferred = this._specifierToFetchResult.get(specifier);
    if (deferred !== undefined) {
      return deferred.promise;
    }

    this._addDependency(referrerSpecifier, location);
    deferred = new Deferred();
    this._specifierToFetchResult.set(specifier, deferred);
    let content;
    try {
      const r = await this._cdn.fetch(location);
      content = r.content;
    } catch {
      const err = {error: 404};
      deferred.resolve(err);
      return err;
    }
    deferred.resolve({result: content});
    return {result: content};
  }

  private readonly _rootDependencies: PackageDependencies = {};
  private readonly _dependencyGraph: DependencyGraph = {};

  /**
   * Record that a package depends on another package.
   */
  private async _addDependency(
    from: {pkg: string; version: string} | null,
    to: {pkg: string; version: string}
  ) {
    if (from === null) {
      this._rootDependencies[to.pkg] = to.version;
    } else {
      let fromVersions = this._dependencyGraph[from.pkg];
      if (fromVersions === undefined) {
        fromVersions = {};
        this._dependencyGraph[from.pkg] = fromVersions;
      }
      let deps = fromVersions[from.version];
      if (deps === undefined) {
        deps = {};
        fromVersions[from.version] = deps;
      }
      deps[to.pkg] = to.version;
    }
  }
}
