// Replaced at bundle time by esbuild's `define` with package.json's version (see esbuild.mjs).
declare const __BGP_VERSION__: string | undefined;

/** The Action's version, as sent in the usage ping. `dev` when not bundled. */
export const VERSION: string = typeof __BGP_VERSION__ === 'string' ? __BGP_VERSION__ : 'dev';
