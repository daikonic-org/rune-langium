#!/usr/bin/env node
/**
 * Combined build for Cloudflare Pages — produces a single tree at
 * `apps/docs/.vitepress/dist/` containing:
 *
 *   rune-studio/                  → public subpath (www.daikonic.dev/rune-studio/)
 *     ├── <site/*>                → static landing page from `site/`
 *     ├── docs/                   → VitePress docs (base='/rune-studio/docs/')
 *     └── studio/                 → Rune Studio SPA (base='/rune-studio/studio/')
 *
 * In ADDITION, the build writes two files at the REPO ROOT (both gitignored)
 * that CF Pages git-integration picks up automatically:
 *
 *   <repo>/functions/             → Pages Functions copied from
 *                                   apps/studio/functions/ (parse + codegen
 *                                   + _middleware only — the LSP Functions
 *                                   from spec 019 were deleted in favor of
 *                                   routing straight at apps/lsp-worker's
 *                                   own zone route; see that Worker's
 *                                   wrangler.toml). CF Pages scans
 *                                   <Root Directory>/functions/ for routes-
 *                                   based Functions; with default Root
 *                                   Directory = "/", that's the repo root.
 *                                   Placing them inside the build output
 *                                   dir does NOT work for git-integration
 *                                   deploys (only for direct `wrangler
 *                                   pages deploy` uploads).
 *   <repo>/wrangler.toml          → compat flags + the CURATED_MIRROR
 *                                   service binding /api/parse needs, plus
 *                                   optional diagnostic runtime variables.
 *                                   Wrangler config is the source of truth
 *                                   for direct Pages uploads.
 *
 * Both sub-builds run with CF_PAGES=1 so their configs pick the right base.
 * CF Pages' git integration points at `apps/docs/.vitepress/dist/` as the
 * output directory; no GitHub Actions workflow is required.
 *
 * apps/lsp-worker/ is deployed independently (`wrangler deploy`, not this
 * script) and owns its own Durable Object + Worker Route directly — CF
 * Pages never binds to it. No CF Pages dashboard configuration is required
 * for LSP.
 *
 * apps/studio/wrangler.toml is the LOCAL-DEV-only config (for `pnpm
 * dev:pages` against apps/studio/functions/); it's not used by the CF
 * Pages deploy.
 */

import { execSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyPagesAssets, validatePagesAssets } from './pages-assets.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const docsRoot = resolve(__dirname, '..');
const repoRoot = resolve(docsRoot, '..', '..');

const siteRoot = join(repoRoot, 'site');
const studioDist = join(repoRoot, 'apps', 'studio', 'dist');
const docsRawDist = join(docsRoot, '.vitepress', 'dist-docs-raw');
const combinedDist = join(docsRoot, '.vitepress', 'dist');
const subpathDist = join(combinedDist, 'rune-studio');
// CF Pages scans <Root Directory>/functions/ for routes-based Functions, where
// Root Directory defaults to "/" (the repo root). The deploy-root wrangler.toml
// also has to live at the repo root for CF Pages git-integration to apply its
// settings during deploy. Both are gitignored at the repo root because they're
// regenerated on every build.
const repoFunctions = join(repoRoot, 'functions');
const repoWranglerToml = join(repoRoot, 'wrangler.toml');

const env = {
  ...process.env,
  CF_PAGES: '1',
  // Studio nav links — baked in so they resolve under /rune-studio/ at runtime
  // regardless of window.location.origin.
  VITE_HOME_URL: '/rune-studio/',
  VITE_DOCS_URL: '/rune-studio/docs/',
  VITE_GITHUB_URL: 'https://github.com/pradeepmouli/rune-langium',
  // Hosted codegen service (feature 011-export-code-cf). Base URL is
  // same-origin so the browser never makes cross-origin calls during
  // Export Code. The Turnstile site key can be provided via env at build
  // time; falls back to Turnstile's documented "always-pass" dummy key
  // so preview builds never break for lack of a real key. Production
  // deploys MUST set TURNSTILE_SITE_KEY in the CF Pages build env.
  VITE_CODEGEN_URL: process.env.VITE_CODEGEN_URL ?? '/rune-studio',
  VITE_TURNSTILE_SITE_KEY:
    process.env.VITE_TURNSTILE_SITE_KEY ?? process.env.TURNSTILE_SITE_KEY ?? '1x00000000000000000000AA'
};

function run(label, command, cwd) {
  console.log(`\n[build-combined] ${label}`);
  console.log(`[build-combined] $ ${command}  (cwd: ${cwd})`);
  execSync(command, { cwd, env, stdio: 'inherit' });
}

function copyDir(from, to, label) {
  if (!existsSync(from)) {
    throw new Error(`[build-combined] missing source: ${from}`);
  }
  // Ensure only the parent of `to` exists; cpSync creates `to` itself and
  // copies `from`'s contents into it. Pre-creating `to` can cause some Node
  // versions to nest the source under `to/<basename(from)>`.
  copyPagesAssets(from, to);
  console.log(`[build-combined] copied ${label}: ${from} → ${to}`);
}

rmSync(combinedDist, { recursive: true, force: true });
rmSync(docsRawDist, { recursive: true, force: true });

// Spec 019 Phase 1: the Pages Functions copied to <repo>/functions/ import
// workspace packages through their package.json exports. Studio and its
// Functions also import @rune-langium/instrumentation-core this way. Build
// both packages before bundling so a fresh CF checkout uses current dist/
// output rather than relying on files left by a previous local build.
//
// Building only the workspace packages the functions actually touch keeps
// the build short. Functions reference @rune-langium/core; that pulls
// langium-zod (already shipping built JS via npm) transitively but doesn't
// touch other workspace pkgs at runtime.
run(
  'Building @rune-langium/instrumentation-core (shared by Studio and Pages Functions)',
  'pnpm --filter @rune-langium/instrumentation-core run build',
  repoRoot
);
run(
  'Building @rune-langium/core (workspace dep imported by Pages Functions)',
  'pnpm --filter @rune-langium/core run build',
  repoRoot
);

run('Generating typedoc API markdown', 'pnpm run docs:api', docsRoot);
run(
  'Building VitePress docs (base=/rune-studio/docs/)',
  'pnpm exec vitepress build --outDir ./.vitepress/dist-docs-raw',
  docsRoot
);

run('Building Rune Studio (base=/rune-studio/studio/)', 'pnpm --filter @rune-langium/studio build', repoRoot);

// `copyDir` creates `subpathDist` itself (so its contents are not nested).
copyDir(siteRoot, subpathDist, 'site → /rune-studio/');
copyDir(docsRawDist, join(subpathDist, 'docs'), 'vitepress → /rune-studio/docs/');
copyDir(studioDist, join(subpathDist, 'studio'), 'studio → /rune-studio/studio/');

const largestAsset = validatePagesAssets(combinedDist);
if (largestAsset) {
  console.log(`[build-combined] Pages assets verified; largest: ${largestAsset.path} (${largestAsset.size} bytes)`);
}

// SPA deep-link fallback is handled by the Pages Function at
// apps/studio/functions/rune-studio/studio/[[catchall]].ts (see that file for
// rationale). A _redirects rule for this case triggered CF Pages' infinite-loop
// detection and was silently ignored, so no _redirects file is written here.

// Spec 019 Phase 1: pre-bundle Pages Functions to the REPO ROOT where CF Pages
// git-integration scans for them. Plain copy of .ts source doesn't work
// because CF's bundler walks node_modules from <repo>/functions/, but with
// pnpm workspaces the function deps (langium, zod, pako, pino, etc.) live
// in apps/studio/node_modules/, not at the repo root. Pre-bundling here
// inlines all those imports so CF Pages just deploys the .js files as-is.
//
// The source tree at apps/studio/functions/ remains the canonical authoring
// location (used by `pnpm dev:pages` for local development).
run(
  'Pre-bundling studio Pages Functions → <repo>/functions/ (CF Pages discovery)',
  `pnpm --filter @rune-langium/studio exec node scripts/bundle-functions.mjs ${JSON.stringify(repoFunctions)}`,
  repoRoot
);

// Generate <repo>/wrangler.toml so CF Pages picks up the compat flag and the
// CURATED_MIRROR service binding declaratively without requiring dashboard
// clicks for those fields.
//
// `name` MUST match the CF Pages dashboard project name — CF Pages refuses to
// read a wrangler.toml that doesn't carry one ("Missing top-level field
// 'name'"). Hardcoded to "daikonic-dev" since that's the project this repo
// deploys to; override via `CF_PAGES_PROJECT_NAME` if a fork uses a different
// project name.
//
// Wrangler config is the source of truth for direct Pages uploads. Copy only
// the opt-in, non-secret diagnostic settings from the build environment so a
// deployed Function sees the same configuration used during the build. Secrets
// remain in Cloudflare's environment and are never written to this file.
//
// No LSP_SESSION Durable Object binding or ALLOWED_ORIGIN var here — the
// LSP Pages Functions that consumed them were deleted (Studio now routes
// straight at apps/lsp-worker's own zone route), and nothing left under
// apps/studio/functions/ reads either.
const projectName = process.env.CF_PAGES_PROJECT_NAME ?? 'daikonic-dev';
const instrumentationVars = [
  'INSTRUMENTATION_ENABLED',
  'INSTRUMENTATION_LEVEL',
  'INSTRUMENTATION_OPS',
  'INSTRUMENTATION_TIMING_ONLY'
].filter((name) => process.env[name] !== undefined);
const instrumentationVarsToml = instrumentationVars.length
  ? `\n[vars]\n${instrumentationVars.map((name) => `${name} = ${JSON.stringify(process.env[name])}`).join('\n')}\n`
  : '';
const wranglerToml = `# Auto-generated by apps/docs/scripts/build-combined.mjs — do not edit.
# CF Pages project config (compat flag + service bindings).
# Edit the source script if you need to change this.

name = "${projectName}"
compatibility_date = "2025-09-23"
compatibility_flags = ["nodejs_compat"]
pages_build_output_dir = "apps/docs/.vitepress/dist"

# Curated mirror service binding — /api/parse uses this to reach the
# curated-mirror Worker without going through the daikonic.dev zone.
# A same-zone HTTP subrequest from a Pages Function gets routed back to
# the Pages project's static assets (cf-worker header + zone loop
# prevention) instead of the curated-mirror Worker, which returns 404 to
# the function and surfaces as a 502 to the client. The service binding
# is a direct Worker-to-Worker in-process call that bypasses zone routing.
[[services]]
binding = "CURATED_MIRROR"
service = "rune-curated-mirror-worker"
${instrumentationVarsToml}`;
writeFileSync(repoWranglerToml, wranglerToml);
console.log(
  `[build-combined] Wrote <repo>/wrangler.toml (compat + pages_build_output_dir + service bindings${instrumentationVars.length ? ' + diagnostic vars' : ''})`
);

rmSync(docsRawDist, { recursive: true, force: true });

console.log('\n[build-combined] Done. CF Pages output dir: apps/docs/.vitepress/dist');
