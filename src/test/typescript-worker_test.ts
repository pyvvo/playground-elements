/**
 * @license
 * Copyright 2021 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {checkTransform} from './worker-test-util.js';

import type {BuildOutput, SampleFile} from '../shared/worker-api.js';
import type {CdnData} from './fake-cdn-plugin.js';

suite('typescript builder', () => {
  test('empty project', async () => {
    const files: SampleFile[] = [];
    const expected: BuildOutput[] = [];
    await checkTransform(files, expected);
  });

  test('compiles ts file to js', async () => {
    const files: SampleFile[] = [
      {
        name: 'index.ts',
        content: 'export const foo: number = 3;',
      },
    ];
    const expected: BuildOutput[] = [
      {
        kind: 'file',
        file: {
          name: 'index.js',
          content: 'export const foo = 3;\r\n',
          contentType: 'text/javascript',
        },
      },
    ];
    await checkTransform(files, expected);
  });

  test('ignores js file', async () => {
    const files: SampleFile[] = [
      {
        name: 'index.js',
        content: 'export const foo: number = 3;',
      },
    ];
    const expected: BuildOutput[] = [
      {
        kind: 'file',
        file: {
          name: 'index.js',
          content: 'export const foo: number = 3;',
        },
      },
    ];
    await checkTransform(files, expected);
  });

  test('emits syntax error', async () => {
    const files: SampleFile[] = [
      {
        name: 'index.ts',
        content: ':',
      },
    ];
    const expected: BuildOutput[] = [
      {
        diagnostic: {
          code: 1128,
          message: 'Declaration or statement expected.',
          range: {
            end: {
              character: 1,
              line: 0,
            },
            start: {
              character: 0,
              line: 0,
            },
          },
          severity: 1,
          source: 'typescript',
        },
        filename: 'index.ts',
        kind: 'diagnostic',
      },
      {
        kind: 'file',
        file: {
          name: 'index.js',
          // TODO(aomarks) This should probably return a 400 error instead of an
          // empty but valid file.
          content: '',
          contentType: 'text/javascript',
        },
      },
    ];
    await checkTransform(files, expected);
  });

  test('emits local semantic error', async () => {
    const files: SampleFile[] = [
      {
        name: 'index.ts',
        content: `
          let foo: number = 3;
          foo = "foo";
        `,
      },
    ];
    const expected: BuildOutput[] = [
      {
        diagnostic: {
          code: 2322,
          message: "Type 'string' is not assignable to type 'number'.",
          range: {
            end: {
              character: 13,
              line: 2,
            },
            start: {
              character: 10,
              line: 2,
            },
          },
          severity: 1,
          source: 'typescript',
        },
        filename: 'index.ts',
        kind: 'diagnostic',
      },
      {
        kind: 'file',
        file: {
          name: 'index.js',
          content: 'let foo = 3;\r\n' + 'foo = "foo";\r\n',
          contentType: 'text/javascript',
        },
      },
    ];
    await checkTransform(files, expected);
  });

  test('emits semantic error from bare module', async () => {
    const files: SampleFile[] = [
      {
        name: 'index.ts',
        content: `
          import {foo} from "foo";
          foo(123);
        `,
      },
    ];
    const cdn: CdnData = {
      foo: {
        versions: {
          '2.0.0': {
            files: {
              'package.json': {
                content: '{"main": "index.js"}',
              },
              'index.js': {
                content: 'export const foo = (s) => s;',
              },
              'index.d.ts': {
                content: 'export declare const foo: (s: string) => string;',
              },
            },
          },
        },
      },
    };
    const expected: BuildOutput[] = [
      {
        diagnostic: {
          code: 2345,
          message:
            "Argument of type 'number' is not assignable to parameter of type 'string'.",
          range: {
            end: {
              character: 17,
              line: 2,
            },
            start: {
              character: 14,
              line: 2,
            },
          },
          severity: 1,
          source: 'typescript',
        },
        filename: 'index.ts',
        kind: 'diagnostic',
      },
      {
        kind: 'file',
        file: {
          name: 'index.js',
          content:
            'import { foo } from "./node_modules/foo@2.0.0/index.js";\r\nfoo(123);\r\n',
          contentType: 'text/javascript',
        },
      },
      {
        kind: 'file',
        file: {
          name: 'node_modules/foo@2.0.0/index.js',
          content: 'export const foo = (s) => s;',
          contentType: 'text/javascript; charset=utf-8',
        },
      },
    ];
    await checkTransform(files, expected, {}, cdn);
  });

  test('respects package.json dependency for semantic errors', async () => {
    const files: SampleFile[] = [
      {
        name: 'index.ts',
        content: `
          import {foo} from "foo";
          foo(123);
        `,
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
        // foo takes a string in 1.0.0, and a number in 2.0.0. We should expect
        // an error because we depend on 1.0.0.
        versions: {
          '1.0.0': {
            files: {
              'index.js': {
                content: 'export const foo = (s) => s;',
              },
              'index.d.ts': {
                content: `
                  import type {t} from './type.js';
                  export declare const foo: (s: t) => t;
                `,
              },
              'type.d.ts': {
                content: `export type t = string;`,
              },
            },
          },
          '2.0.0': {
            files: {
              'index.js': {
                content: 'export const foo = (n) => n;',
              },
              'index.d.ts': {
                content: 'export declare const foo: (n: number) => number;',
              },
            },
          },
        },
      },
    };
    const expected: BuildOutput[] = [
      {
        diagnostic: {
          code: 2345,
          message:
            "Argument of type 'number' is not assignable to parameter of type 'string'.",
          range: {
            end: {
              character: 17,
              line: 2,
            },
            start: {
              character: 14,
              line: 2,
            },
          },
          severity: 1,
          source: 'typescript',
        },
        filename: 'index.ts',
        kind: 'diagnostic',
      },
      {
        kind: 'file',
        file: {
          name: 'index.js',
          content:
            'import { foo } from "./node_modules/foo@1.0.0/index.js";\r\nfoo(123);\r\n',
          contentType: 'text/javascript',
        },
      },
      {
        kind: 'file',
        file: {
          name: 'node_modules/foo@1.0.0/index.js',
          content: 'export const foo = (s) => s;',
          contentType: 'text/javascript; charset=utf-8',
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
    ];
    await checkTransform(files, expected, {}, cdn);
  });
});
