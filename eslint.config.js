import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

const PURE = 'src/render and src/snippets also run in the browser selector: no Node built-ins or @actions/*.';

export default defineConfig(
  { ignores: ['dist/**', 'site/dist/**', 'worker/**', 'coverage/**'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      // `const { drop, ...rest } = x` is how tests and code omit a field.
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
    },
  },
  {
    files: ['src/render/**', 'src/snippets/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'fs', message: PURE },
            { name: 'path', message: PURE },
          ],
          patterns: [{ group: ['node:*', 'fs/*', 'path/*', '@actions/*'], message: PURE }],
        },
      ],
    },
  },
);
