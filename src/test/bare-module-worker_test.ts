/**
 * @license
 * Copyright 2021 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {checkTransform} from './worker-test-util.js';

import type {
  BuildOutput,
  ModuleImportMap,
  SampleFile,
} from '../shared/worker-api.js';
import type {CdnData} from './fake-cdn-plugin.js';

suite('bare module builder', () => {
  test('empty project', async () => {
    const files: SampleFile[] = [];
    const cdn: CdnData = {};
    const expected: BuildOutput[] = [];
    await checkTransform(files, expected, {}, cdn);
  });

  test('bare module transform', async () => {
    const files: SampleFile[] = [
      {
        name: 'index.js',
        content: 'import "foo/index.js";',
      },
    ];
    const cdn: CdnData = {
      foo: {
        versions: {
          '1.0.0': {
            files: {
              'index.js': {
                content: 'foo1',
              },
            },
          },
        },
      },
    };
    const expected: BuildOutput[] = [
      {
        kind: 'file',
        file: {
          name: 'index.js',
          content: 'import "./node_modules/foo@1.0.0/index.js";',
        },
      },
      {
        kind: 'file',
        file: {
          name: 'node_modules/foo@1.0.0/index.js',
          content: 'foo1',
          contentType: 'text/javascript; charset=utf-8',
        },
      },
    ];
    await checkTransform(files, expected, {}, cdn);
  });

  test('bare module transform with subpath', async () => {
    const files: SampleFile[] = [
      {
        name: 'some/sub/dir/index.js',
        content: 'import "foo/index.js";',
      },
    ];
    const cdn: CdnData = {
      foo: {
        versions: {
          '1.0.0': {
            files: {
              'index.js': {
                content: 'foo1',
              },
            },
          },
        },
      },
    };
    const expected: BuildOutput[] = [
      {
        kind: 'file',
        file: {
          name: 'some/sub/dir/index.js',
          content: 'import "../../../node_modules/foo@1.0.0/index.js";',
        },
      },
      {
        kind: 'file',
        file: {
          name: 'node_modules/foo@1.0.0/index.js',
          content: 'foo1',
          contentType: 'text/javascript; charset=utf-8',
        },
      },
    ];
    await checkTransform(files, expected, {}, cdn);
  });

  test('import loop', async () => {
    const files: SampleFile[] = [
      {
        name: 'index.js',
        content: 'import "foo/index.js";',
      },
    ];
    const cdn: CdnData = {
      foo: {
        versions: {
          '1.0.0': {
            files: {
              'index.js': {
                content: 'import "./other.js";',
              },
              'other.js': {
                content: 'import "./index.js";',
              },
            },
          },
        },
      },
    };
    const expected: BuildOutput[] = [
      {
        kind: 'file',
        file: {
          name: 'index.js',
          content: 'import "./node_modules/foo@1.0.0/index.js";',
        },
      },
      {
        kind: 'file',
        file: {
          name: 'node_modules/foo@1.0.0/index.js',
          content: 'import "./other.js";',
          contentType: 'text/javascript; charset=utf-8',
        },
      },
      {
        kind: 'file',
        file: {
          name: 'node_modules/foo@1.0.0/other.js',
          content: 'import "./index.js";',
          contentType: 'text/javascript; charset=utf-8',
        },
      },
    ];
    await checkTransform(files, expected, {}, cdn);
  });

  test('no extension JS import', async () => {
    const files: SampleFile[] = [
      {
        name: 'index.js',
        content: 'import "foo/bar";',
      },
    ];
    const cdn: CdnData = {
      foo: {
        versions: {
          '1.0.0': {
            files: {
              'bar.js': {
                content: 'bar;',
              },
            },
          },
        },
      },
    };
    const expected: BuildOutput[] = [
      {
        kind: 'file',
        file: {
          name: 'index.js',
          content: 'import "./node_modules/foo@1.0.0/bar.js";',
        },
      },
      {
        kind: 'file',
        file: {
          name: 'node_modules/foo@1.0.0/bar.js',
          contentType: 'text/javascript; charset=utf-8',
          content: 'bar;',
        },
      },
    ];
    await checkTransform(files, expected, {}, cdn);
  });

  test('bare module transform with namespace', async () => {
    const files: SampleFile[] = [
      {
        name: 'index.js',
        content: 'import "@foo/bar/index.js";',
      },
    ];
    const cdn: CdnData = {
      '@foo/bar': {
        versions: {
          '1.0.0': {
            files: {
              'index.js': {
                content: 'foo1',
              },
            },
          },
        },
      },
    };
    const expected: BuildOutput[] = [
      {
        kind: 'file',
        file: {
          name: 'index.js',
          content: 'import "./node_modules/@foo/bar@1.0.0/index.js";',
        },
      },
      {
        kind: 'file',
        file: {
          name: 'node_modules/@foo/bar@1.0.0/index.js',
          content: 'foo1',
          contentType: 'text/javascript; charset=utf-8',
        },
      },
    ];
    await checkTransform(files, expected, {}, cdn);
  });

  test('bare module transform, resolve main', async () => {
    const files: SampleFile[] = [
      {
        name: 'index.js',
        content: 'import "foo";',
      },
    ];
    const cdn: CdnData = {
      foo: {
        versions: {
          '1.0.0': {
            files: {
              'lib/main.js': {
                content: 'foo1',
              },
              'package.json': {
                content: `{
                  "main": "lib/main.js"
                }`,
              },
            },
          },
        },
      },
    };
    const expected: BuildOutput[] = [
      {
        kind: 'file',
        file: {
          name: 'index.js',
          content: 'import "./node_modules/foo@1.0.0/lib/main.js";',
        },
      },
      {
        kind: 'file',
        file: {
          name: 'node_modules/foo@1.0.0/lib/main.js',
          content: 'foo1',
          contentType: 'text/javascript; charset=utf-8',
        },
      },
    ];
    await checkTransform(files, expected, {}, cdn);
  });

  test('bare module transform nested import', async () => {
    const files: SampleFile[] = [
      {
        name: 'index.js',
        content: 'import "foo/other.js";',
      },
    ];
    const cdn: CdnData = {
      foo: {
        versions: {
          '1.0.0': {
            files: {
              'index.js': {
                content: 'foo1',
              },
              'other.js': {
                content: 'import "./index.js";',
              },
            },
          },
        },
      },
    };
    const expected: BuildOutput[] = [
      {
        kind: 'file',
        file: {
          name: 'index.js',
          content: 'import "./node_modules/foo@1.0.0/other.js";',
        },
      },
      {
        kind: 'file',
        file: {
          name: 'node_modules/foo@1.0.0/other.js',
          content: 'import "./index.js";',
          contentType: 'text/javascript; charset=utf-8',
        },
      },
      {
        kind: 'file',
        file: {
          name: 'node_modules/foo@1.0.0/index.js',
          content: 'foo1',
          contentType: 'text/javascript; charset=utf-8',
        },
      },
    ];
    await checkTransform(files, expected, {}, cdn);
  });

  test('bare module transform nested import 2', async () => {
    const files: SampleFile[] = [
      {
        name: 'index.js',
        content: 'import "foo/other2.js";',
      },
    ];
    const cdn: CdnData = {
      foo: {
        versions: {
          '1.0.0': {
            files: {
              'index.js': {
                content: 'console.log("hello");',
              },
              'other1.js': {
                content: 'import "./index.js";',
              },
              'other2.js': {
                content: 'import "./other1.js";',
              },
            },
          },
        },
      },
    };
    const expected: BuildOutput[] = [
      {
        kind: 'file',
        file: {
          name: 'index.js',
          content: 'import "./node_modules/foo@1.0.0/other2.js";',
        },
      },
      {
        kind: 'file',
        file: {
          name: 'node_modules/foo@1.0.0/other2.js',
          content: 'import "./other1.js";',
          contentType: 'text/javascript; charset=utf-8',
        },
      },
      {
        kind: 'file',
        file: {
          name: 'node_modules/foo@1.0.0/other1.js',
          content: 'import "./index.js";',
          contentType: 'text/javascript; charset=utf-8',
        },
      },
      {
        kind: 'file',
        file: {
          name: 'node_modules/foo@1.0.0/index.js',
          content: 'console.log("hello");',
          contentType: 'text/javascript; charset=utf-8',
        },
      },
    ];
    await checkTransform(files, expected, {}, cdn);
  });

  test('non-existent package', async () => {
    const files: SampleFile[] = [
      {
        name: 'index.js',
        content: 'import "non-existent/index.js";',
      },
    ];
    const cdn: CdnData = {};
    const expected: BuildOutput[] = [
      {
        kind: 'file',
        file: {
          name: 'index.js',
          content: 'import "non-existent/index.js";',
        },
      },
      {
        diagnostic: {
          message:
            'Could not resolve module "non-existent/index.js": Unpkg 404 error: Not Found',
          range: {
            end: {
              character: 29,
              line: 0,
            },
            start: {
              character: 8,
              line: 0,
            },
          },
        },
        filename: 'index.js',
        kind: 'diagnostic',
      },
    ];
    await checkTransform(files, expected, {}, cdn);
  });

  test('bare module transform, version in project file', async () => {
    const files: SampleFile[] = [
      {
        name: 'index.js',
        content: 'import "foo";',
      },
      {
        name: 'package.json',
        content: `
          {
            "dependencies": {
              "foo": "^1.0.0"
            }
          }
        `,
      },
    ];
    const cdn: CdnData = {
      foo: {
        versions: {
          '1.0.0': {
            files: {
              'index.js': {
                content: 'foo1',
              },
            },
          },
          '2.0.0': {
            files: {
              'index.js': {
                content: 'foo2',
              },
            },
          },
        },
      },
    };
    const expected: BuildOutput[] = [
      {
        kind: 'file',
        file: {
          name: 'index.js',
          content: 'import "./node_modules/foo@1.0.0/index.js";',
        },
      },
      {
        kind: 'file',
        file: {
          name: 'node_modules/foo@1.0.0/index.js',
          content: 'foo1',
          contentType: 'text/javascript; charset=utf-8',
        },
      },
      {
        kind: 'file',
        file: {
          name: 'package.json',
          content: `
          {
            "dependencies": {
              "foo": "^1.0.0"
            }
          }
        `,
        },
      },
    ];
    await checkTransform(files, expected, {}, cdn);
  });

  test('invalid local package.json', async () => {
    const files: SampleFile[] = [
      {
        name: 'index.js',
        content: 'import "foo";',
      },
      {
        name: 'package.json',
        content: `INVALID JSON`,
      },
    ];
    const cdn: CdnData = {
      foo: {
        versions: {
          '1.0.0': {
            files: {
              'index.js': {
                content: 'foo1',
              },
            },
          },
          '2.0.0': {
            files: {
              'index.js': {
                content: 'foo2',
              },
            },
          },
        },
      },
    };
    const expected: BuildOutput[] = [
      {
        kind: 'file',
        file: {
          name: 'index.js',
          content: 'import "./node_modules/foo@2.0.0/index.js";',
        },
      },
      {
        kind: 'file',
        file: {
          name: 'node_modules/foo@2.0.0/index.js',
          content: 'foo2',
          contentType: 'text/javascript; charset=utf-8',
        },
      },
      {
        kind: 'file',
        file: {
          name: 'package.json',
          content: `INVALID JSON`,
        },
      },
    ];
    await checkTransform(files, expected, {}, cdn);
  });

  test('bare module transform, version in dependency', async () => {
    const files: SampleFile[] = [
      {
        name: 'index.js',
        content: 'import "foo/import-bar.js";',
      },
    ];
    const cdn: CdnData = {
      foo: {
        versions: {
          '1.0.0': {
            files: {
              'import-bar.js': {
                content: 'import "bar";',
              },
              'package.json': {
                content: `{
                  "dependencies": {
                    "bar": "^1.0.0"
                  }
                }`,
              },
            },
          },
        },
      },
      bar: {
        versions: {
          '2.0.0': {
            files: {
              'index.js': {
                content: 'bar2',
              },
            },
          },
          '1.0.0': {
            files: {
              'index.js': {
                content: 'bar1',
              },
            },
          },
        },
      },
    };
    const expected: BuildOutput[] = [
      {
        kind: 'file',
        file: {
          name: 'index.js',
          content: 'import "./node_modules/foo@1.0.0/import-bar.js";',
        },
      },
      {
        kind: 'file',
        file: {
          name: 'node_modules/foo@1.0.0/import-bar.js',
          content: 'import "../bar@1.0.0/index.js";',
          contentType: 'text/javascript; charset=utf-8',
        },
      },
      {
        kind: 'file',
        file: {
          name: 'node_modules/bar@1.0.0/index.js',
          content: 'bar1',
          contentType: 'text/javascript; charset=utf-8',
        },
      },
    ];
    await checkTransform(files, expected, {}, cdn);
  });

  test('bare module transform, version in dependency 2', async () => {
    const files: SampleFile[] = [
      {
        name: 'index.js',
        content: 'import "foo/import-bar.js";',
      },
    ];
    const cdn: CdnData = {
      foo: {
        versions: {
          '1.0.0': {
            files: {
              'import-bar.js': {
                content: 'import "bar";',
              },
              'package.json': {
                content: `{
                  "dependencies": {
                    "bar": "^1.0.0"
                  }
                }`,
              },
            },
          },
        },
      },
      bar: {
        versions: {
          '2.0.0': {
            files: {
              'index.js': {
                content: 'bar2',
              },
            },
          },
          '1.0.0': {
            files: {
              'index.js': {
                content: 'import "./another.js";',
              },
              'another.js': {
                content: 'bar1',
              },
            },
          },
        },
      },
    };
    const expected: BuildOutput[] = [
      {
        kind: 'file',
        file: {
          name: 'index.js',
          content: 'import "./node_modules/foo@1.0.0/import-bar.js";',
        },
      },
      {
        kind: 'file',
        file: {
          name: 'node_modules/foo@1.0.0/import-bar.js',
          content: 'import "../bar@1.0.0/index.js";',
          contentType: 'text/javascript; charset=utf-8',
        },
      },
      {
        kind: 'file',
        file: {
          name: 'node_modules/bar@1.0.0/index.js',
          content: 'import "./another.js";',
          contentType: 'text/javascript; charset=utf-8',
        },
      },
      {
        kind: 'file',
        file: {
          name: 'node_modules/bar@1.0.0/another.js',
          content: 'bar1',
          contentType: 'text/javascript; charset=utf-8',
        },
      },
    ];
    await checkTransform(files, expected, {}, cdn);
  });

  test('missing dependency package.json', async () => {
    const files: SampleFile[] = [
      {
        name: 'index.js',
        content: 'import "foo/import-bar.js";',
      },
    ];
    const cdn: CdnData = {
      foo: {
        versions: {
          '1.0.0': {
            files: {
              'import-bar.js': {
                content: 'import "bar";',
              },
            },
          },
        },
      },
      bar: {
        versions: {
          '1.0.0': {
            files: {
              'index.js': {
                content: 'bar1',
              },
            },
          },
        },
      },
    };
    const expected: BuildOutput[] = [
      {
        kind: 'file',
        file: {
          name: 'index.js',
          content: 'import "./node_modules/foo@1.0.0/import-bar.js";',
        },
      },
      {
        kind: 'file',
        file: {
          name: 'node_modules/foo@1.0.0/import-bar.js',
          content: 'import "../bar@1.0.0/index.js";',
          contentType: 'text/javascript; charset=utf-8',
        },
      },
      {
        kind: 'file',
        file: {
          name: 'node_modules/bar@1.0.0/index.js',
          content: 'bar1',
          contentType: 'text/javascript; charset=utf-8',
        },
      },
    ];
    await checkTransform(files, expected, {}, cdn);
  });

  test('invalid dependency package.json', async () => {
    const files: SampleFile[] = [
      {
        name: 'index.js',
        content: 'import "foo/import-bar.js";',
      },
    ];
    const cdn: CdnData = {
      foo: {
        versions: {
          '1.0.0': {
            files: {
              'import-bar.js': {
                content: 'import "bar";',
              },
              'package.json': {
                content: `INVALID JSON`,
              },
            },
          },
        },
      },
      bar: {
        versions: {
          '1.0.0': {
            files: {
              'index.js': {
                content: 'bar1',
              },
            },
          },
        },
      },
    };
    const expected: BuildOutput[] = [
      {
        kind: 'file',
        file: {
          name: 'index.js',
          content: 'import "./node_modules/foo@1.0.0/import-bar.js";',
        },
      },
      {
        kind: 'file',
        file: {
          name: 'node_modules/foo@1.0.0/import-bar.js',
          content: 'import "../bar@1.0.0/index.js";',
          contentType: 'text/javascript; charset=utf-8',
        },
      },
      {
        kind: 'file',
        file: {
          name: 'node_modules/bar@1.0.0/index.js',
          content: 'bar1',
          contentType: 'text/javascript; charset=utf-8',
        },
      },
    ];
    await checkTransform(files, expected, {}, cdn);
  });

  test('dependency package.json missing xxx', async () => {
    const files: SampleFile[] = [
      {
        name: 'index.js',
        content: 'import "foo/import-bar.js";',
      },
    ];
    const cdn: CdnData = {
      foo: {
        versions: {
          '1.0.0': {
            files: {
              'import-bar.js': {
                content: 'import "bar";',
              },
              'package.json': {
                content: `
                {
                  "dependencies": {
                    "not-foo": "^2.0.0"
                  }
                }
              `,
              },
            },
          },
        },
      },
      bar: {
        versions: {
          '1.0.0': {
            files: {
              'index.js': {
                content: 'bar1',
              },
            },
          },
        },
      },
    };
    const expected: BuildOutput[] = [
      {
        kind: 'file',
        file: {
          name: 'index.js',
          content: 'import "./node_modules/foo@1.0.0/import-bar.js";',
        },
      },
      {
        kind: 'file',
        file: {
          name: 'node_modules/foo@1.0.0/import-bar.js',
          content: 'import "../bar@1.0.0/index.js";',
          contentType: 'text/javascript; charset=utf-8',
        },
      },
      {
        kind: 'file',
        file: {
          name: 'node_modules/bar@1.0.0/index.js',
          content: 'bar1',
          contentType: 'text/javascript; charset=utf-8',
        },
      },
    ];
    await checkTransform(files, expected, {}, cdn);
  });

  test('relative import with no extension', async () => {
    const files: SampleFile[] = [
      {
        name: 'index.js',
        content: 'import "foo";',
      },
    ];
    const cdn: CdnData = {
      foo: {
        versions: {
          '1.0.0': {
            files: {
              'index.js': {
                content: 'import "./bar";',
              },
              'bar.js': {
                content: 'bar',
              },
            },
          },
        },
      },
    };
    const expected: BuildOutput[] = [
      {
        kind: 'file',
        file: {
          name: 'index.js',
          content: 'import "./node_modules/foo@1.0.0/index.js";',
        },
      },
      {
        kind: 'file',
        file: {
          name: 'node_modules/foo@1.0.0/index.js',
          content: 'import "./bar.js";',
          contentType: 'text/javascript; charset=utf-8',
        },
      },
      {
        kind: 'file',
        file: {
          name: 'node_modules/foo@1.0.0/bar.js',
          content: 'bar',
          contentType: 'text/javascript; charset=utf-8',
        },
      },
    ];
    await checkTransform(files, expected, {}, cdn);
  });

  test('relative import with no extension, not latest version', async () => {
    const files: SampleFile[] = [
      {
        name: 'index.js',
        content: 'import "foo";',
      },
      {
        name: 'package.json',
        content: `{
          "dependencies": {
            "foo": "^1.0.0"
          }
        }`,
      },
    ];
    const cdn: CdnData = {
      foo: {
        versions: {
          '1.0.0': {
            files: {
              'index.js': {
                content: 'import "./bar";',
              },
              'bar.js': {
                content: 'bar1',
              },
            },
          },
          '2.0.0': {
            files: {
              'index.js': {
                content: 'import "./bar";',
              },
              'bar.js': {
                content: 'bar2',
              },
            },
          },
        },
      },
    };
    const expected: BuildOutput[] = [
      {
        kind: 'file',
        file: {
          name: 'index.js',
          content: 'import "./node_modules/foo@1.0.0/index.js";',
        },
      },
      {
        kind: 'file',
        file: {
          name: 'package.json',
          content: `{
          "dependencies": {
            "foo": "^1.0.0"
          }
        }`,
        },
      },
      {
        kind: 'file',
        file: {
          name: 'node_modules/foo@1.0.0/index.js',
          content: 'import "./bar.js";',
          contentType: 'text/javascript; charset=utf-8',
        },
      },
      {
        kind: 'file',
        file: {
          name: 'node_modules/foo@1.0.0/bar.js',
          content: 'bar1',
          contentType: 'text/javascript; charset=utf-8',
        },
      },
    ];
    await checkTransform(files, expected, {}, cdn);
  });

  test('use import map', async () => {
    const files: SampleFile[] = [
      {
        name: 'index.js',
        content: 'import "foo";',
      },
    ];
    const importMap: ModuleImportMap = {
      imports: {
        foo: 'http://example.com/foo',
      },
    };
    const cdn: CdnData = {
      foo: {
        versions: {
          '1.0.0': {
            files: {
              'index.js': {
                content: 'foo',
              },
            },
          },
        },
      },
    };
    const expected: BuildOutput[] = [
      {
        kind: 'file',
        file: {
          name: 'index.js',
          content: 'import "http://example.com/foo";',
        },
      },
    ];
    await checkTransform(files, expected, importMap, cdn);
  });
});
