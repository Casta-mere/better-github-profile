import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The page imports ../src/render and ../src/snippets, which sit outside the Vite root (site/).
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  base: '/better-github-profile/',
  server: { fs: { allow: [repoRoot] } },
  build: { outDir: 'dist', emptyOutDir: true },
});
