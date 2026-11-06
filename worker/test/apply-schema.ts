import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';

// Runs before each test file. Already-applied migrations are skipped, so this is safe to repeat.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
