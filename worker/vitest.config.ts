import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

const workerDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(async () => {
  // Tests start from the same table the owner creates in production: schema.sql is the only "migration".
  const migrations = await readD1Migrations({
    projectPath: workerDir,
    migrationsDir: '.',
    migrationsPattern: 'schema.sql',
  });

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.toml' },
        miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
      }),
    ],
    test: {
      setupFiles: ['./test/apply-schema.ts'],
    },
  };
});
