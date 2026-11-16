import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Co-located tests (e.g. src/project.test.ts) run too, not only those under __tests__/.
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
