/**
 * @license
 * Copyright 2021 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {TypesFetcher} from '../typescript-worker/types-fetcher.js';
import {CachingCdn} from '../typescript-worker/caching-cdn.js';
import {ModuleResolver} from '../typescript-worker/module-resolver.js';
import {configureFakeCdn} from './worker-test-util.js';
import {assert} from '@esm-bundle/chai';

import type {ModuleImportMap} from '../shared/worker-api.js';
import type {CdnData} from './fake-cdn-plugin.js';
import type {PackageJson} from '../typescript-worker/util.js';

const checkTypesFetcher = async (
  sourceTexts: string[],
  packageJson: PackageJson,
  expected: Map<string, string>,
  cdnData: CdnData = {},
  importMap: ModuleImportMap = {}
) => {
  const {cdnBaseUrl, deleteCdnData} = await configureFakeCdn(cdnData);
  try {
    const cdn = new CachingCdn(cdnBaseUrl);
    const importMapResolver = new ModuleResolver(importMap);
    const typesFetcher = new TypesFetcher(cdn, importMapResolver);
    for (const sourceText of sourceTexts) {
      typesFetcher.addBareModuleTypings(sourceText, async () => packageJson);
    }
    const results = await typesFetcher.getFiles();
    // Note assert.deepEqual does compare Maps correctly, but it always displays
    // "{}" as the difference in the error message, hence this conversion :(
    assert.deepEqual(
      [...results].sort(([[keyA], [keyB]]) => keyA.localeCompare(keyB)),
      [...expected].sort(([[keyA], [keyB]]) => keyA.localeCompare(keyB))
    );
  } finally {
    await deleteCdnData();
  }
};

suite('types fetcher', () => {
  test('no sources', async () => {
    const sourceTexts: string[] = [];
    const packageJson: PackageJson = {};
    const cdn: CdnData = {};
    const expected = new Map();
    await checkTypesFetcher(sourceTexts, packageJson, expected, cdn);
  });

  test('no imports', async () => {
    const sourceTexts: string[] = [`export const foo = "foo";`];
    const packageJson: PackageJson = {};
    const cdn: CdnData = {};
    const expected = new Map();
    await checkTypesFetcher(sourceTexts, packageJson, expected, cdn);
  });

  test('simple import', async () => {
    const sourceTexts: string[] = [`import {foo} from 'foo';`];
    const packageJson: PackageJson = {};
    const cdn: CdnData = {
      foo: {
        versions: {
          '1.0.0': {
            files: {
              'index.d.ts': {
                content: `declare export const foo: string;`,
              },
            },
          },
        },
      },
    };
    const expected = new Map([
      ['foo/package.json', '{}'],
      ['foo/index.d.ts', 'declare export const foo: string;'],
    ]);
    await checkTypesFetcher(sourceTexts, packageJson, expected, cdn);
  });

  test('chain of 3 imports', async () => {
    const sourceTexts: string[] = [`import {foo} from 'foo';`];
    const packageJson: PackageJson = {};
    const cdn: CdnData = {
      foo: {
        versions: {
          '1.0.0': {
            files: {
              'index.d.ts': {
                content: `export * from 'bar';`,
              },
            },
          },
        },
      },
      bar: {
        versions: {
          '1.0.0': {
            files: {
              'index.d.ts': {
                content: `export * from 'baz';`,
              },
            },
          },
        },
      },
      baz: {
        versions: {
          '1.0.0': {
            files: {
              'index.d.ts': {
                content: `declare export const foo: string;`,
              },
            },
          },
        },
      },
    };
    const expected = new Map([
      ['foo/package.json', '{}'],
      ['foo/index.d.ts', `export * from 'bar';`],
      ['bar/package.json', '{}'],
      ['bar/index.d.ts', `export * from 'baz';`],
      ['baz/package.json', '{}'],
      ['baz/index.d.ts', `declare export const foo: string;`],
    ]);
    await checkTypesFetcher(sourceTexts, packageJson, expected, cdn);
  });

  test('conflicting versions', async () => {
    const sourceTexts: string[] = [
      `
      import 'foo';
      import 'bar';
      `,
    ];
    const packageJson: PackageJson = {
      dependencies: {
        bar: '^1.0.0',
      },
    };
    const cdn: CdnData = {
      foo: {
        versions: {
          '1.2.3': {
            files: {
              'index.d.ts': {
                content: `declare export * from 'bar';`,
              },
              'package.json': {
                content: JSON.stringify({
                  dependencies: {
                    bar: '^2.0.0',
                  },
                }),
              },
            },
          },
        },
      },
      bar: {
        versions: {
          '1.2.3': {
            files: {
              'index.d.ts': {
                content: `declare export const bar: 1;`,
              },
            },
          },
          '2.3.4': {
            files: {
              'index.d.ts': {
                content: `declare export const bar: 2;`,
              },
            },
          },
        },
      },
    };
    const expected = new Map([
      [
        'foo/package.json',
        JSON.stringify({
          dependencies: {
            bar: '^2.0.0',
          },
        }),
      ],
      ['foo/index.d.ts', `declare export * from 'bar';`],
      ['foo/node_modules/bar/package.json', '{}'],
      ['foo/node_modules/bar/index.d.ts', `declare export const bar: 2;`],
      ['bar/package.json', '{}'],
      ['bar/index.d.ts', `declare export const bar: 1;`],
    ]);
    await checkTypesFetcher(sourceTexts, packageJson, expected, cdn);
  });
});
