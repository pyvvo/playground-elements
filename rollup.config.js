import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import litcss from 'rollup-plugin-lit-css';
import {terser} from 'rollup-plugin-terser';
import summary from 'rollup-plugin-summary';

export function simpleReplace(replacements) {
  return {
    name: 'simple-replace',
    renderChunk(code) {
      for (const [from, to] of replacements) {
        code = code.replace(from, to);
      }
      return {code};
    },
  };
}

// TODO(aomarks) Support more themes.
const themeNames = ['monokai.css'];

export default [
  {
    input: 'src/_codemirror/codemirror-bundle.js',
    output: {
      file: '_codemirror/codemirror-bundle.js',
      format: 'esm',
      // CodeMirror doesn't include any @license or @preserve annotations on the
      // copyright headers, so terser doesn't know which comments need to be
      // preserved. Add it back with the annotation.
      banner: `/* @license CodeMirror, copyright (c) by Marijn Haverbeke and others
Distributed under an MIT license: https://codemirror.net/LICENSE */
`,
    },
    // TODO(aomarks) If we created and exported some module-scoped object as our
    // context, then we should be able to make a properly isolated ES module
    // here which doesn't set `window.CodeMirror`. However, there seems to be
    // some code in the `google_modes` files use a hard-coded `CodeMirror`
    // global instead of using the "global" variable that is passed into the
    // factory, so some extra patching/search-replacing would be required.
    context: 'window',
    plugins: [
      resolve(),
      simpleReplace([
        // Every CodeMirror file includes UMD-style tests to check for CommonJS
        // or AMD. Re-write these expressions directly to `false` so that we
        // always run in global mode, and terser will dead-code remove the other
        // branches.
        [/typeof exports ?===? ?['"`]object['"`]/g, 'false'],
        [/typeof define ?===? ?['"`]function['"`]/g, 'false'],
      ]),
      terser({
        warnings: true,
        ecma: 2017,
        compress: {
          unsafe: true,
          passes: 2,
        },
        output: {
          // "some" preserves @license and @preserve comments
          comments: 'some',
          inline_script: false,
        },
        mangle: {
          properties: false,
        },
      }),
      summary(),
    ],
  },
  {
    input: 'node_modules/codemirror/lib/codemirror.css',
    output: {
      file: '_codemirror/codemirror-styles.js',
      format: 'esm',
    },
    external: ['lit-element'],
    plugins: [litcss({uglify: true})],
  },
  ...themeNames.map((file) => {
    return {
      input: `node_modules/codemirror/theme/${file}`,
      output: {
        file: `_codemirror/themes/${file}.js`,
        format: 'esm',
      },
      external: ['lit-element'],
      plugins: [litcss({uglify: true})],
    };
  }),
  {
    input: 'service-worker/service-worker.js',
    output: {
      file: 'service-worker.js',
      format: 'iife',
      exports: 'none',
    },
    plugins: [resolve()],
  },
  {
    input: 'typescript-worker/typescript-worker.js',
    output: {
      file: 'typescript-worker.js',
      format: 'iife',
      exports: 'none',
    },
    plugins: [
      commonjs({
        ignore: (id) => true,
      }),
      resolve(),
    ],
  },
];
