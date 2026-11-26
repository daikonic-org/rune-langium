// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

// Workers Builds auto-deploy smoke test (2026-08-21) — no functional change.

/**
 * Curated-mirror Worker entry.
 *
 * Two responsibilities:
 *  - `scheduled`: nightly Cron Trigger; fetches each curated source from
 *    GitHub's codeload archive endpoint and uploads to R2 via `publisher`.
 *  - `fetch`:     same-origin read route at `/curated/<id>/...` serving
 *    manifests + archives back to Studio (handler in `./http.ts`).
 */

import type { ScheduledController, ExecutionContext } from '@cloudflare/workers-types';
import { handleCuratedRead } from './http.js';
import { publishCuratedMirrors, type CuratedSource } from './publisher.js';
import { logger } from './log.js';

export interface Env {
  /** R2 bucket binding — matches wrangler.toml [[r2_buckets]].binding. */
  rune_curated_mirror: R2Bucket;
  CURATED_SOURCES: string;
  ALLOWED_ORIGIN: string;
  /** Enabled by the local Studio launcher to read published reference objects on a local R2 miss. */
  DEV_READ_PUBLISHED_REFERENCES?: string;
  /** Flat env var set via `[vars]` in wrangler.toml. Preferred form. */
  RETENTION_ARCHIVES_PER_MODEL?: string;
  /** Nested fallback form (read by `readRetention` for ops convenience). */
  RETENTION?: { ARCHIVES_PER_MODEL?: string };
}

const DEFAULT_RETENTION = 14;

function readRetention(env: Env): number {
  const raw = env.RETENTION_ARCHIVES_PER_MODEL ?? env.RETENTION?.ARCHIVES_PER_MODEL;
  const n = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_RETENTION;
}

function parseSources(env: Env): CuratedSource[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(env.CURATED_SOURCES);
  } catch (err) {
    // Hard-fail: a Worker that runs the cron with zero sources is
    // operationally indistinguishable from one whose cron is silently
    // disabled. Throwing makes the misconfig loud in CF observability.
    logger.error(
      { err: errMessage(err), raw_preview: String(env.CURATED_SOURCES).slice(0, 256) },
      'curated-mirror.parse-sources.failed'
    );
    throw new Error(`CURATED_SOURCES is not valid JSON: ${errMessage(err)}`);
  }
  if (!Array.isArray(parsed)) {
    logger.error({}, 'curated-mirror.parse-sources.not_array');
    throw new Error('CURATED_SOURCES must be a JSON array');
  }
  return parsed as CuratedSource[];
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default {
  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    const sources = parseSources(env);
    await publishCuratedMirrors({
      sources,
      bucket: env.rune_curated_mirror,
      retention: readRetention(env)
    });
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    return handleCuratedRead(req, env);
  }
};
