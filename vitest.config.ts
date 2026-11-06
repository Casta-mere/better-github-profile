import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only the root suite: worker/test needs the Workers pool and runs from worker/.
    include: ['test/**/*.test.ts'],
  },
});
