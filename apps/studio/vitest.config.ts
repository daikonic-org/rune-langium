// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}', 'functions/test/**/*.test.ts'],
    exclude: ['test/e2e/**', 'test/prod-ux/report/**'],
    setupFiles: ['./test/setup.ts'],
    server: {
      deps: {
        // @rune-langium/codegen is pnpm-workspace-symlinked, so Vite resolves
        // it to its real (non-node_modules) path and runs its *built* dist
        // JS through the SSR transform's import-analysis pass instead of
        // externalizing it. Rolldown's import-analysis parser mis-detects
        // the `import(input, targetTypeFqn) { ... }` method shorthand in
        // dist/src/instances/json-codec.js (ImportCodec#import) as a dynamic
        // `import()` call and fails to parse it. Forcing this package
        // external restores Node's native loader for it, sidestepping the
        // parser bug; it has no effect on the actual code under test.
        //
        // NOTE: the package-name pattern is anchored with `(\/|$)` so it
        // matches `@rune-langium/codegen` and its subpaths (e.g.
        // `@rune-langium/codegen/instances`) but NOT the sibling package
        // `@rune-langium/codegen-legacy`, which apps/studio also imports
        // value-level (see src/services/codegen-service.ts) and must keep
        // going through the normal SSR transform.
        // Project graph construction and native codegen must share core's
        // generation-local identity registry, rather than loading core once
        // through Vite and a second time through Node's codegen dependency.
        external: [
          /@rune-langium\/codegen(\/|$)/,
          /packages\/codegen\/dist/,
          /@rune-langium\/project-runtime(\/|$)/,
          /packages\/project-runtime\/dist/
        ]
      }
    }
  }
});
