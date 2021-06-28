/**
 * @license
 * Copyright 2021 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {fileExtension, parseNpmStyleSpecifier} from './util.js';

import type {NpmFileLocation, PackageJson} from './util.js';

export interface CdnFile {
  content: string;
  contentType: string;
}

export class CachingCdn {
  private readonly _urlPrefix: string;
  private readonly _versionCache = new Map<string, string>();
  private readonly _fileCache = new Map<
    string,
    {url: string; file: {content: string; contentType: string}}
  >();

  constructor(urlPrefix: string) {
    this._urlPrefix = urlPrefix;
  }

  async fetch(location: NpmFileLocation): Promise<CdnFile> {
    const {file} = await this._fetch(location);
    return file;
  }

  async canonicalize(location: NpmFileLocation): Promise<NpmFileLocation> {
    let exact = isExactVersion(location.version);
    if (!exact) {
      const pv = pkgVersion(location);
      const resolved = this._versionCache.get(pv);
      if (resolved !== undefined) {
        location = {...location, version: resolved};
        exact = true;
      }
    }
    if (!exact || fileExtension(location.path) === '') {
      const {url} = await this._fetch(location);
      location = this._parseUnpkgUrl(url);
    }
    return location;
  }

  async fetchPackageJson({
    pkg,
    version,
  }: {
    pkg: string;
    version: string;
  }): Promise<PackageJson> {
    const {
      url,
      file: {content},
    } = await this._fetch({pkg, version, path: 'package.json'});
    try {
      return JSON.parse(content) as PackageJson;
    } catch {
      throw new Error(`JSON error from ${url}: ${content}`);
    }
  }

  private async _fetch(
    location: NpmFileLocation
  ): Promise<{url: string; file: CdnFile}> {
    let exact = isExactVersion(location.version);
    if (!exact) {
      const pv = pkgVersion(location);
      const resolved = this._versionCache.get(pv);
      if (resolved !== undefined) {
        location = {...location, version: resolved};
        exact = true;
      }
    }
    let pvp = pkgVersionPath(location);
    const cached = this._fileCache.get(pvp);
    if (cached !== undefined) {
      return cached;
    }
    const url = this._urlPrefix + pvp;
    const res = await fetch(url);
    const content = await res.text();
    if (res.status !== 200) {
      throw new Error(`Unpkg ${res.status} error: ${content}`);
    }
    if (!exact) {
      const canonical = this._parseUnpkgUrl(res.url);
      this._versionCache.set(pkgVersion(location), canonical.version);
      pvp = pkgVersionPath(canonical);
    }
    const result = {
      url: res.url,
      file: {
        content,
        contentType: res.headers.get('content-type') ?? 'text/plain',
      },
    };
    this._fileCache.set(pvp, result);
    return result;
  }

  private _parseUnpkgUrl(url: string): NpmFileLocation {
    if (url.startsWith(this._urlPrefix)) {
      const parsed = parseNpmStyleSpecifier(url.slice(this._urlPrefix.length));
      if (parsed !== undefined) {
        return parsed;
      }
    }
    throw new Error(`Unexpected unpkg.com URL format: ${url}`);
  }
}

const pkgVersion = ({pkg, version}: {pkg: string; version: string}) =>
  `${pkg}@${version || 'latest'}`;

const pkgVersionPath = ({pkg, version, path}: NpmFileLocation) =>
  trimTrailingSlash(`${pkgVersion({pkg, version})}/${trimLeadingSlash(path)}`);

const trimLeadingSlash = (s: string) => (s.startsWith('/') ? s.slice(1) : s);

const trimTrailingSlash = (s: string) => (s.endsWith('/') ? s.slice(0, -1) : s);

// https://semver.org/#is-there-a-suggested-regular-expression-regex-to-check-a-semver-string
const isExactVersion = (s: string) =>
  s.match(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/
  ) !== null;
