// Bundles the Action into dist/index.js, which is committed: `runs.main` points at it.
import { build } from 'esbuild';
import pkg from './package.json' with { type: 'json' };

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
  // The version sent in the usage ping (src/action/version.ts).
  define: { __BGP_VERSION__: JSON.stringify(pkg.version) },
  logLevel: 'info',
});
