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
  fileExtension,
  changeFileExtension,
  classifySpecifier,
  relativeUrlPath,
  NpmFileLocation,
} from './util.js';

import type {Result} from '../shared/util.js';
import type {CachingCdn} from './cdn.js';
import type {PackageJson} from './util.js';

/**
 * Fetches typings for TypeScript imports and their transitive dependencies, and
 * for standard libraries.
 */
export class TypesFetcher {
  private readonly _cdn: CachingCdn;
  // TODO(aomarks) private
  protected readonly _moduleResolver: ModuleResolver;
  private readonly _entrypointTasks: Promise<void>[] = [];
  private readonly _handledSpecifiers = new Set<string>();
  private readonly _specifierToFetchResult = new Map<
    string,
    Deferred<Result<string, number>>
  >();

  constructor(cdn: CachingCdn, moduleResolver: ModuleResolver) {
    this._cdn = cdn;
    this._moduleResolver = moduleResolver;
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
          this._handleBareSpecifier(specifier, getPackageJson)
        );
      }
    }
    for (const {fileName: lib} of fileInfo.libReferenceDirectives) {
      this._entrypointTasks.push(this._addLibTypings(lib, getPackageJson));
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
    this._entrypointTasks.push(this._addLibTypings(lib, getPackageJson));
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
    const files = new Map();
    for (const [specifier, deferred] of this._specifierToFetchResult) {
      const fetched = await deferred.promise;
      if (fetched.error === undefined) {
        // Note that if the user writes an import for a package that doesn't
        // exist, we'll omit it here (since it will have error 404), so
        // TypeScript will fail to find a typings file, and will generate a
        // diagnostic on the bad import. So we don't actually need to do
        // anything special with errors (though we could potentially surface
        // more information).
        files.set(specifier, fetched.result);
      }
    }
    return files;
  }

  private async _addLibTypings(
    lib: string,
    getPackageJson: () => Promise<PackageJson | undefined>
  ): Promise<void> {
    await this._handleBareSpecifier(
      `typescript/lib/lib.${lib.toLowerCase()}.js`,
      getPackageJson
    );
  }

  private async _handleBareAndRelativeSpecifiers(
    sourceText: string,
    referrerSpecifier: NpmFileLocation,
    getPackageJson: () => Promise<PackageJson | undefined>
  ): Promise<void> {
    const fileInfo = ts.preProcessFile(sourceText, undefined, true);
    const promises = [];
    for (const {fileName: specifier} of fileInfo.importedFiles) {
      const kind = classifySpecifier(specifier);
      if (kind === 'bare') {
        promises.push(this._handleBareSpecifier(specifier, getPackageJson));
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
    getPackageJson: () => Promise<PackageJson | undefined>
  ): Promise<void> {
    if (this._handledSpecifiers.has(bare)) {
      return;
    }
    this._handledSpecifiers.add(bare);
    const npm = parseNpmStyleSpecifier(bare);
    if (npm === undefined) {
      return;
    }
    if (!npm.version) {
      npm.version =
        (await getPackageJson())?.dependencies?.[npm.pkg] ?? 'latest';
    }
    const pkg = npm.pkg;
    // If there's no path, we need to discover the main module.
    let dtsPath = npm.path;
    let packageJson: PackageJson | undefined = undefined;
    if (dtsPath === '') {
      try {
        console.log(0);
        const res = await this._fetchAsset({
          pkg,
          version: npm.version,
          path: 'package.json',
        });
        if (res.error === undefined) {
          packageJson = JSON.parse(res.result) as PackageJson;
        }
      } catch {
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
      console.log(1);
      dtsResult = await this._fetchAsset({
        pkg,
        version: npm.version,
        path: dtsPath,
      });
    } catch {
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
    referrerSpecifier: NpmFileLocation,
    getPackageJson: () => Promise<PackageJson | undefined>
  ): Promise<void> {
    const ext = fileExtension(relative);
    if (ext === '') {
      // No extension is presumed js.
      relative += '.js';
    } else if (ext !== 'js') {
      // Unhandled kind of import.
      return;
    }
    const jsPath = relativeUrlPath(referrerSpecifier.path, relative).slice(1); // Remove the leading '/'.
    const dtsPath = changeFileExtension(jsPath, 'd.ts');
    console.log({jsPath, dtsPath});
    const dtsSpecifier = `${referrerSpecifier.pkg}/${dtsPath}`;
    if (this._handledSpecifiers.has(dtsSpecifier)) {
      return;
    }
    this._handledSpecifiers.add(dtsSpecifier);
    let dtsResult;
    try {
      console.log(2);
      dtsResult = await this._fetchAsset({
        pkg: referrerSpecifier.pkg,
        version: referrerSpecifier.version,
        path: dtsPath,
      });
    } catch {
      return;
    }
    if (dtsResult.error !== undefined) {
      return;
    }
    await this._handleBareAndRelativeSpecifiers(
      dtsResult.result,
      {
        pkg: referrerSpecifier.pkg,
        version: referrerSpecifier.version,
        path: dtsPath,
      },
      getPackageJson
    );
  }

  private async _fetchAsset(
    location: NpmFileLocation
  ): Promise<Result<string, number>> {
    const specifier = `${location.pkg}@${location.version}/${location.path}`;
    let deferred = this._specifierToFetchResult.get(specifier);
    if (deferred !== undefined) {
      return deferred.promise;
    }
    deferred = new Deferred();
    this._specifierToFetchResult.set(specifier, deferred);
    let content;
    try {
      console.log('dts fetch', location);
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
}
