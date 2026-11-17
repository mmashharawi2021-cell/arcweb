import { defineConfig } from 'vitest/config'
import { readFileSync } from 'node:fs'

const appVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version as string

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  // Co-located tests (e.g. src/project.test.ts) run too, not only those under __tests__/.
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
