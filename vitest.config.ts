import { workspaceTestCache } from './test/helpers/vitest-cache.js';
import { defineConfig } from 'vitest/config';
import { decoratorLoweringPlugin } from './packages/codegen/vitest-decorator-plugin.js';

// Root vitest config for core packages only.
// Note: visual-editor and apps have their own vitest.config.ts with browser environment.
// Run `pnpm test` at the root to execute all tests across all packages via `pnpm -r run test`.
//
// `decoratorLoweringPlugin` is registered here too (not just in
// packages/codegen/vitest.config.ts) because this config's `test.include`
// glob below still resolves packages/codegen's test files when running
// `pnpm run test:coverage` from the root — without it, any codegen source
// file using this package's native TC39 decorator syntax (`@debug()` etc.)
// fails to parse under this config's own transform pipeline. See the
// plugin's own doc comment for the full rationale.

export default defineConfig({
  plugins: [decoratorLoweringPlugin()],
  test: {
    fsModuleCachePath: workspaceTestCache(import.meta.url),
    globals: true,
    environment: 'node',
    include: ['packages/**/test/**/*.test.ts', 'packages/**/src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/build/**', 'packages/visual-editor/**', 'apps/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['packages/cli/src/**/*.ts', 'packages/core/src/**/*.ts', 'packages/lsp-server/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.spec.ts', '**/test/**', '**/dist/**', '**/node_modules/**'],
      thresholds: {
        lines: 30,
        functions: 20,
        branches: 30,
        statements: 30
      }
    },
    typecheck: {
      enabled: false // Run type checking separately with tsc
    }
  }
});
