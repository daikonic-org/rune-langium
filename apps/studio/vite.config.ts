// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import z2fVite from '@zod-to-form/vite';
import studioFormConfig from './z2f.config.js';
import { fileURLToPath } from 'url';

/**
 * Force the build process to terminate once the bundle is written.
 *
 * rolldown-vite (the Vite 8 preview this studio runs on) intermittently
 * leaves an esbuild service process alive after a *successful* `vite build`,
 * so Node's event loop never drains and the process hangs forever. Under
 * `pnpm -r run build` this manifested as studio being the one package that
 * built (`✓ built in N s`) but never returned control to pnpm — running CI's
 * Build step to its 15-minute timeout (previously a 6-hour job ceiling). The
 * orphaned `esbuild` PID is killed at job cleanup, confirming the dangling
 * handle.
 *
 * `closeBundle` fires only after every chunk + sourcemap has been flushed to
 * `dist/`, so exiting here cannot truncate output. Restricted to
 * `apply: 'build'` and guarded against `--watch`, so dev/watch is untouched.
 * Deferred a tick so Vite's reporter summary flushes first.
 *
 * Crucially this must NOT mask a failed build: rolldown calls `closeBundle`
 * even on error (with an error argument), so we bail when one is present, and
 * we exit with the current `process.exitCode` rather than a hardcoded 0 so any
 * non-zero status set elsewhere still fails CI. On error we deliberately don't
 * force-exit — if the failed build then hangs, CI times out red, which is the
 * correct outcome (never a false green).
 */
function forceExitAfterBuild(): Plugin {
  let isWatch = false;
  return {
    name: 'studio:force-exit-after-build',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      isWatch = Boolean(config.build.watch);
    },
    closeBundle(error?: unknown) {
      if (isWatch || error) return;
      setTimeout(() => process.exit(process.exitCode ?? 0), 0);
    }
  };
}

export default defineConfig(() => {
  // `@rune-langium/visual-editor` resolves to its `src/` for BOTH `vite dev`
  // and `vite build` via the package's `exports` map (which points at source,
  // mirroring `@rune-langium/design-system`). So source edits HMR directly and
  // production bundles compile from source — no built `dist/` required, and no
  // serve-only alias to keep in sync. A previous dev-only `resolve.alias`
  // entry duplicated this resolution; the exports map is now the single source
  // of truth (it also handles subpath imports like `…/styles.css` correctly,
  // which a bare-prefix string alias could not).
  return {
    base: process.env.VITE_BASE_URL || (process.env.CF_PAGES === '1' ? '/rune-studio/studio/' : '/'),
    // Generate TSX before React transforms it; use the same config as CLI/discovery.
    plugins: [z2fVite({ configOverride: studioFormConfig }), tailwindcss(), react(), forceExitAfterBuild()],
    optimizeDeps: {
      // Worker-only dynamic imports must be discovered before a dev session starts.
      include: [
        'buffer',
        'prettier/standalone',
        'prettier/plugins/typescript',
        'prettier/plugins/estree',
        '@wasm-fmt/ruff_fmt/vite'
      ],
      exclude: ['@wasm-fmt/ruff_fmt/node']
    },
    // langium-zod's `dist/index.js` re-exports its CLI (`generate` from `cli.js`)
    // which runs `process.argv.slice(2)` at module-init. When vite optimises
    // the package the top-level CLI bytes execute in the browser and crash the
    // page with `process is not defined`. We're not running the CLI in-browser;
    // the smallest fix is to expose a no-op `process` shim so the CLI's
    // top-level guards short-circuit. This affects neither prod bundling nor
    // any code that actually wants Node's process at runtime.
    define: {
      'process.argv': '[]',
      'process.platform': '"browser"',
      'process.env': '{}',
      'process.exit': '(()=>{})',
      'process.cwd': '(()=>"/")',
      process: '({argv:[],platform:"browser",env:{},exit:()=>{},cwd:()=>"/"})'
    },
    resolve: {
      alias: [{ find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) }],
      dedupe: ['react', 'react-dom', '@xyflow/react']
    },
    server: {
      // Default 5173 (Vite convention, uncontested on macOS where AirPlay owns
      // :5000). `scripts/check-env.mjs` can pick a free fallback and export
      // STUDIO_DEV_PORT for both this config and playwright.config.ts.
      port: Number(process.env.STUDIO_DEV_PORT) || 5173,
      host: '0.0.0.0',
      allowedHosts: true,
      // Replit dev: vite serves on :5000 directly; forward /api to the
      // wrangler pages dev server (:8788) which hosts the Pages Functions.
      proxy: {
        '/api': {
          target: 'http://localhost:8788',
          changeOrigin: false,
          ws: true
        }
      }
    },
    build: {
      target: 'es2020',
      outDir: 'dist',
      // e2e-batch fix #9: enable hidden sourcemaps for prod debuggability.
      // 'hidden' generates .map files but doesn't add the //# sourceMappingURL
      // comment in the bundle, so they aren't auto-fetched by browsers but ARE
      // available for symbolicating crash reports + opening via DevTools "Load
      // sourcemap" workflow. Previously prod TypeErrors (e.g. `at Dg
      // (index-_w0h5L6_.js:11247)`) were undebuggable.
      sourcemap: 'hidden'
    },
    worker: {
      format: 'es'
    }
  };
});
