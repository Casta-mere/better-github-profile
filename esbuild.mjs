// Bundles the Action into dist/index.js, which is committed: `runs.main` points at it.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/action/main.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  // Required: @actions/core is ESM, but its CommonJS dependencies (tunnel, undici) require
  // Node built-ins at runtime. Without a real `require` the bundle dies on load with
  // `Dynamic require of "net" is not supported`.
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  logLevel: 'info',
});
