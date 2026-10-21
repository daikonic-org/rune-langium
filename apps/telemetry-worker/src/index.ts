// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { jsonResponse } from '@rune-langium/worker-core/http';
// Workers Builds auto-deploy smoke test (2026-08-21) — no functional change.

/**
 * Telemetry ingest Worker.
 *
 * Surface (per `contracts/telemetry-event.md`):
 *   POST    /rune-studio/api/telemetry/v1/event
 *   OPTIONS /rune-studio/api/telemetry/v1/event   (CORS preflight)
 *
 * Pipeline:
 *   1. Method/route guard.
 *   2. Origin allowlist + CORS preflight against env.ALLOWED_ORIGIN.
 *   3. Per-IP rate-limit: 10 events/minute, scoped to a 60s window. Held
 *      in-process per isolate. CF runs many isolates so this is a soft
 *      throttle, not a precise quota — that's fine for opt-out telemetry.
 *      The map is bounded: stale windows are evicted on every check.
 *   4. JSON parse → Zod schema (.strict()) → reject 400 on schema violation.
 *   5. Hash the IP with a daily-rotating deterministic salt (see
 *      `getDailySalt` below — no DO, no network round-trip).
 *   6. Log a structured line per event via Cloudflare Workers Logs (one line
 *      per `op_spans` batch entry) — no raw IP, no request body. Aggregation
 *      and digests are computed by querying Workers Observability directly
 *      (`apps/studio/scripts/telemetry-digest.mjs`), not by this Worker.
 */

import { z } from 'zod';
import { CuratedModelIdSchema, ErrorCategorySchema } from '@rune-langium/curated-schema';
import { isOriginAllowed } from '@rune-langium/worker-core/origin';
import { logRequest, logSpan } from './log.js';

export interface Env {
  /**
   * Comma-separated allowlist of origins permitted to POST events.
   * Wildcard `*` means any origin (only sensible in local dev).
   */
  ALLOWED_ORIGIN: string;
  /** HMAC key material for the daily-rotating IP-hash salt. Set via `wrangler secret put`. */
  IP_SALT_SECRET: string;
}

// ---------- Schema ----------

// Use the canonical enums from @rune-langium/curated-schema rather than
// redeclaring — drift here would silently 400 legitimate Studio events
// (e.g. `errorCategory: 'cancelled'`).
const StudioVersion = z.string().max(32);
const UaClass = z.string().max(64);

const TelemetryEventBody = z.discriminatedUnion('event', [
  z
    .object({
      event: z.literal('curated_load_attempt'),
      modelId: CuratedModelIdSchema,
      studio_version: StudioVersion,
      ua_class: UaClass
    })
    .strict(),
  z
    .object({
      event: z.literal('curated_load_success'),
      modelId: CuratedModelIdSchema,
      durationMs: z.number().int().nonnegative().max(600_000),
      studio_version: StudioVersion,
      ua_class: UaClass
    })
    .strict(),
  z
    .object({
      event: z.literal('curated_load_failure'),
      modelId: CuratedModelIdSchema,
      errorCategory: ErrorCategorySchema,
      studio_version: StudioVersion,
      ua_class: UaClass
    })
    .strict(),
  z
    .object({
      event: z.enum([
        'workspace_open_success',
        'workspace_open_failure',
        'workspace_restore_success',
        'workspace_restore_failure'
      ]),
      studio_version: StudioVersion,
      ua_class: UaClass
    })
    .strict(),
  z
    .object({
      event: z.literal('lsp_session_opened'),
      studio_version: StudioVersion,
      ua_class: UaClass
    })
    .strict(),
  z
    .object({
      event: z.literal('lsp_session_failed'),
      errorCategory: z.enum(['origin_blocked', 'token_expired', 'nonce_replay', 'upstream_unhealthy', 'unknown']),
      studio_version: StudioVersion,
      ua_class: UaClass
    })
    .strict(),
  z
    .object({
      event: z.literal('op_spans'),
      spans: z
        .array(
          z.object({
            op: z.string().max(64),
            subject: z.string().max(200).optional(),
            durationMs: z.number().int().nonnegative().max(600_000).optional(),
            level: z.enum(['info', 'warn', 'error']),
            signature: z.string().max(200).optional(),
            opId: z.number().int().optional()
          })
        )
        .min(1)
        .max(50),
      studio_version: StudioVersion,
      ua_class: UaClass
    })
    .strict()
]);

type TelemetryEvent = z.infer<typeof TelemetryEventBody>;

// ---------- In-memory per-IP rate limit (10/min, with eviction) ----------

const RATE_LIMIT = 10;
const WINDOW_MS = 60_000;
const _MAX_TRACKED_IPS = 50_000;

interface RateWindow {
  windowStart: number;
  count: number;
}

// Module-level so it survives within an isolate; CF runs many isolates so
// this is intentionally a soft per-isolate throttle, not a global quota.
const ipWindows = new Map<string, RateWindow>();

function checkRateLimit(ip: string, now: number): { allowed: boolean; retryAfterS: number } {
  evictExpired(now);
  const w = ipWindows.get(ip);
  if (!w || now - w.windowStart >= WINDOW_MS) {
    ipWindows.set(ip, { windowStart: now, count: 1 });
    return { allowed: true, retryAfterS: 0 };
  }
  if (w.count >= RATE_LIMIT) {
    const retryAfterS = Math.max(1, Math.ceil((w.windowStart + WINDOW_MS - now) / 1000));
    return { allowed: false, retryAfterS };
  }
  w.count += 1;
  return { allowed: true, retryAfterS: 0 };
}

function evictExpired(now: number): void {
  // Cheap path: only sweep when the Map is large. In normal traffic it's
  // bounded by 60s of unique IPs and never reaches the sweep threshold.
  if (ipWindows.size < 1024) return;
  for (const [ip, w] of ipWindows) {
    if (now - w.windowStart >= WINDOW_MS) ipWindows.delete(ip);
  }
}

export function _resetRateLimitForTesting(): void {
  ipWindows.clear();
}

// ---------- IP hashing (daily-rotating salt, deterministic per-isolate) ----------
//
// The salt rotates per UTC day. Rather than round-tripping a DO to share
// one random salt across isolates (the previous design), it's derived as
// HMAC-SHA256(env.IP_SALT_SECRET, day) — every isolate computes the same
// value independently, with no storage, no cross-isolate coordination, and
// no failure mode (a DO-unreachable fallback used to silently degrade
// cross-isolate dedup for that request). The day-scoping still means an
// IP hash from one day can't be correlated with the same IP's hash on
// another day. Cached per-isolate purely to avoid recomputing the HMAC on
// every request within the same day.

let cachedSalt: { day: string; salt: string } | null = null;

function utcDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

async function getDailySalt(env: Env, now: Date): Promise<string> {
  const day = utcDay(now);
  if (cachedSalt && cachedSalt.day === day) return cachedSalt.salt;

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.IP_SALT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', keyMaterial, new TextEncoder().encode(day));
  const salt = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  cachedSalt = { day, salt };
  return salt;
}

async function hashIp(ip: string, salt: string): Promise<string> {
  const enc = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function _resetSaltCacheForTesting(): void {
  cachedSalt = null;
}

// ---------- CORS ----------

function corsHeaders(origin: string | null, allowed: string): Record<string, string> {
  if (!origin || !isOriginAllowed(origin, allowed)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600'
  };
}

// ---------- Helpers ----------

function emptyResponse(status: number, extraHeaders: Record<string, string> = {}): Response {
  return new Response(null, { status, headers: extraHeaders });
}

function getErrorCategory(event: TelemetryEvent): string | null {
  if (event.event === 'curated_load_failure') return event.errorCategory;
  if (event.event === 'lsp_session_failed') return event.errorCategory;
  return null;
}

// ---------- Worker entry ----------

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const startedAt = Date.now();
    const ip = req.headers.get('cf-connecting-ip') ?? '0.0.0.0';
    const origin = req.headers.get('Origin');

    // CORS preflight
    if (req.method === 'OPTIONS' && url.pathname.endsWith('/v1/event')) {
      const headers = corsHeaders(origin, env.ALLOWED_ORIGIN);
      // Empty headers => origin not allowed; still return 204 so the
      // browser logs a clear CORS rejection rather than a network error.
      return emptyResponse(204, headers);
    }

    // POST /v1/event
    if (url.pathname.endsWith('/v1/event')) {
      if (req.method !== 'POST') return jsonResponse(405, { error: 'method_not_allowed' });

      const cors = corsHeaders(origin, env.ALLOWED_ORIGIN);
      // For cross-origin requests from a non-allowlisted origin, fail
      // fast — the browser will block the response read regardless, but
      // returning 403 makes the rejection explicit in server logs.
      if (origin && !isOriginAllowed(origin, env.ALLOWED_ORIGIN)) {
        const salt = await getDailySalt(env, new Date(startedAt));
        const ipHash = await hashIp(ip, salt);
        logRequest({
          ipHash,
          event: 'rejected',
          status: 403,
          durationMs: Date.now() - startedAt,
          outcome: 'rejected',
          errorCategory: 'origin_not_allowed'
        });
        return jsonResponse(403, { error: 'origin_not_allowed' });
      }

      // Rate-limit
      const rl = checkRateLimit(ip, startedAt);
      if (!rl.allowed) {
        const salt = await getDailySalt(env, new Date(startedAt));
        const ipHash = await hashIp(ip, salt);
        logRequest({
          ipHash,
          event: 'rate_limited',
          status: 429,
          durationMs: Date.now() - startedAt,
          outcome: 'rate_limited'
        });
        return jsonResponse(429, { error: 'rate_limited', retry_after_s: rl.retryAfterS }, cors);
      }

      // Parse + validate
      let raw: unknown;
      try {
        raw = await req.json();
      } catch {
        const salt = await getDailySalt(env, new Date(startedAt));
        const ipHash = await hashIp(ip, salt);
        logRequest({
          ipHash,
          event: 'rejected',
          status: 400,
          durationMs: Date.now() - startedAt,
          outcome: 'rejected',
          errorCategory: 'malformed_json'
        });
        return jsonResponse(400, { error: 'schema_violation', details: 'malformed_json' }, cors);
      }
      const parsed = TelemetryEventBody.safeParse(raw);
      if (!parsed.success) {
        const salt = await getDailySalt(env, new Date(startedAt));
        const ipHash = await hashIp(ip, salt);
        logRequest({
          ipHash,
          event: 'rejected',
          status: 400,
          durationMs: Date.now() - startedAt,
          outcome: 'rejected',
          errorCategory: 'schema_violation'
        });
        return jsonResponse(400, { error: 'schema_violation', details: parsed.error.issues }, cors);
      }
      const event = parsed.data;

      const salt = await getDailySalt(env, new Date(startedAt));
      const ipHash = await hashIp(ip, salt);

      // One structured log line per span rather than a nested array on the
      // request line — Workers Observability groups/percentiles on
      // top-level fields (`op`, `level`, `duration_ms`), not on values
      // nested inside an array field.
      if (event.event === 'op_spans') {
        for (const span of event.spans) {
          logSpan({
            ipHash,
            op: span.op,
            level: span.level,
            durationMs: span.durationMs,
            signature: span.signature,
            subject:
              span.op === 'modelLoad' && span.subject && CuratedModelIdSchema.safeParse(span.subject).success
                ? span.subject
                : undefined,
            opId: span.opId,
            studioVersion: event.studio_version,
            uaClass: event.ua_class
          });
        }
      }

      logRequest({
        ipHash,
        event: event.event,
        status: 204,
        durationMs: Date.now() - startedAt,
        outcome: 'accepted',
        errorCategory: getErrorCategory(event),
        studioVersion: event.studio_version,
        uaClass: event.ua_class
      });
      return emptyResponse(204, cors);
    }

    return jsonResponse(404, { error: 'not_found' });
  }
};
