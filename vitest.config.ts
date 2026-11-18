import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['{apps,packages,tests}/**/*.{test,spec}.ts'], exclude: ['**/node_modules/**', 'tests/e2e/**'], testTimeout: 30000 } })
