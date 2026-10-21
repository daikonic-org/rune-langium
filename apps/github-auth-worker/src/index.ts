// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { corsJsonResponse as json } from '@rune-langium/worker-core/http';
// Workers Builds auto-deploy smoke test (2026-08-21) — no functional change.

/**
 * GitHub OAuth Device-Flow mediator. Stateless — never persists tokens.
 *
 * Routes:
 *   POST /rune-studio/api/github-auth/device-init  → GitHub /login/device/code
 *   POST /rune-studio/api/github-auth/device-poll  → GitHub /login/oauth/access_token
 *
 * Origin allowlist on every request. Logs go to console as JSON; the
 * device_code and access_token are NEVER logged. Soft per-device-code
 * rate-limit (one poll per ~5s) protects against client bugs that ignore
 * the upstream `interval` field.
 *
 * Failure handling for upstream:
 *   - Network error / 5xx                 → 503 github_unavailable
 *   - 4xx with structured `error`         → 502 github_misconfigured
 *   - HTML / non-JSON / empty             → 503 github_unavailable + log
 *   - access_denied                       → 403 access_denied (terminal)
 *   - expired_token                       → 410 expired_token (terminal)
 *   - authorization_pending / slow_down   → 202 (poll again)
 *   - any other oauth error               → 400 invalid_device_code
 */

import { handleGitProxy } from './git-proxy.js';

export interface Env {
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET?: string;
  ALLOWED_ORIGIN: string;
}

const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const POLL_MIN_INTERVAL_MS = 5_000;

// Soft per-device-code throttle held in-process per isolate. CF runs many
// isolates so this is a per-isolate guard against a misbehaving client,
// not a precise quota.
const lastPollAt = new Map<string, number>();
const MAX_TRACKED_CODES = 10_000;

function evictExpiredPolls(now: number): void {
  if (lastPollAt.size < 1024) return;
  for (const [k, ts] of lastPollAt) {
    if (now - ts > 600_000) lastPollAt.delete(k);
  }
}

export function _resetPollLimitForTesting(): void {
  lastPollAt.clear();
}

function originOk(req: Request, allowed: string): boolean {
  const o = req.headers.get('Origin');
  return o === allowed;
}

interface UpstreamReadResult {
  ok: true;
  data: Record<string, unknown>;
}
interface UpstreamReadFailure {
  ok: false;
  /** HTTP-style category for the studio client to render against. */
  reason: 'github_unavailable' | 'github_misconfigured';
  status: number;
  contentType: string;
  preview: string;
}

/**
 * Read an upstream GitHub response into a structured object, or classify
 * the failure. GitHub returns HTML rate-limit pages, captcha interstitials,
 * and various 4xx/5xx shapes; the body parse needs to handle all of them.
 */
async function readUpstream(upstream: Response): Promise<UpstreamReadResult | UpstreamReadFailure> {
  const status = upstream.status;
  const contentType = upstream.headers.get('Content-Type') ?? '';
  // 5xx is always retryable.
  if (status >= 500) {
    return {
      ok: false,
      reason: 'github_unavailable',
      status,
      contentType,
      preview: ''
    };
  }
  // 4xx: try to surface GitHub's structured error if possible, else mark
  // misconfigured. A 401/403 commonly means a bad client_id.
  // 200: parse JSON.
  let raw: string;
  try {
    raw = await upstream.text();
  } catch (err) {
    return {
      ok: false,
      reason: 'github_unavailable',
      status,
      contentType,
      preview: errMessage(err).slice(0, 256)
    };
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      reason: status >= 400 ? 'github_misconfigured' : 'github_unavailable',
      status,
      contentType,
      preview: raw.slice(0, 256)
    };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return {
      ok: false,
      reason: 'github_unavailable',
      status,
      contentType,
      preview: raw.slice(0, 256)
    };
  }
  if (status >= 400) {
    return {
      ok: false,
      reason: 'github_misconfigured',
      status,
      contentType,
      preview: raw.slice(0, 256)
    };
  }
  return { ok: true, data: data as Record<string, unknown> };
}

function logUpstreamFailure(stage: 'init' | 'poll', f: UpstreamReadFailure): void {
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      ts: Date.now(),
      level: 'error',
      stage,
      kind: f.reason,
      upstream_status: f.status,
      content_type: f.contentType,
      preview: f.preview
    })
  );
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const allowed = env.ALLOWED_ORIGIN;
    const url = new URL(req.url);

    // Git smart-HTTP proxy: browsers omit the Origin header on same-origin
    // GET/HEAD requests (e.g. /info/refs discovery), so we apply a relaxed
    // rule here — absent Origin is allowed (same-origin), but a present
    // Origin that differs from the allowed origin is blocked.
    if (url.pathname.includes('/git/')) {
      const o = req.headers.get('Origin');
      if (o !== null && o !== allowed) return new Response('forbidden', { status: 403 });
      return handleGitProxy(req, env, allowed);
    }

    // Device-flow endpoints: strict same-origin check (browsers always send
    // Origin on cross-origin POST, and these are always cross-origin POSTs
    // from the studio SPA to the auth worker).
    if (!originOk(req, allowed)) {
      return new Response('forbidden', { status: 403 });
    }
    if (req.method !== 'POST') {
      return json(405, { error: 'method_not_allowed' }, allowed);
    }
    if (url.pathname.endsWith('/device-init')) return handleInit(env, allowed);
    if (url.pathname.endsWith('/device-poll')) return handlePoll(req, env, allowed);
    return json(404, { error: 'not_found' }, allowed);
  }
};

async function handleInit(env: Env, allowed: string): Promise<Response> {
  let upstream: Response;
  try {
    upstream = await fetch(DEVICE_CODE_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        client_id: env.GITHUB_CLIENT_ID,
        scope: 'repo'
      })
    });
  } catch {
    return json(503, { error: 'github_unavailable' }, allowed);
  }
  const read = await readUpstream(upstream);
  if (!read.ok) {
    logUpstreamFailure('init', read);
    return json(read.reason === 'github_misconfigured' ? 502 : 503, { error: read.reason }, allowed);
  }
  const body = read.data;
  return json(
    200,
    {
      device_code: body['device_code'],
      user_code: body['user_code'],
      verification_uri: body['verification_uri'],
      expires_in: body['expires_in'],
      interval: body['interval']
    },
    allowed
  );
}

async function handlePoll(req: Request, env: Env, allowed: string): Promise<Response> {
  const now = Date.now();
  let body: { device_code?: string };
  try {
    body = (await req.json()) as { device_code?: string };
  } catch {
    return json(400, { error: 'bad_json' }, allowed);
  }
  if (!body.device_code || typeof body.device_code !== 'string') {
    return json(400, { error: 'invalid_device_code' }, allowed);
  }

  // Per-device-code rate-limit: minimum 5s between polls.
  evictExpiredPolls(now);
  const last = lastPollAt.get(body.device_code);
  if (last !== undefined && now - last < POLL_MIN_INTERVAL_MS) {
    const retryAfterS = Math.max(1, Math.ceil((POLL_MIN_INTERVAL_MS - (now - last)) / 1000));
    return json(429, { error: 'slow_down', retry_after_s: retryAfterS }, allowed);
  }
  if (lastPollAt.size >= MAX_TRACKED_CODES) {
    // Fall back to a soft cap — drop the oldest entry. Map iteration
    // order is insertion-order, so the first key is the oldest.
    const oldestKey = lastPollAt.keys().next().value;
    if (oldestKey !== undefined) lastPollAt.delete(oldestKey);
  }
  lastPollAt.set(body.device_code, now);

  let upstream: Response;
  try {
    upstream = await fetch(ACCESS_TOKEN_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        client_id: env.GITHUB_CLIENT_ID,
        device_code: body.device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
      })
    });
  } catch {
    return json(503, { error: 'github_unavailable' }, allowed);
  }
  const read = await readUpstream(upstream);
  if (!read.ok) {
    logUpstreamFailure('poll', read);
    return json(read.reason === 'github_misconfigured' ? 502 : 503, { error: read.reason }, allowed);
  }
  const data = read.data;
  if (typeof data['access_token'] === 'string') {
    return json(
      200,
      {
        access_token: data['access_token'],
        scope: data['scope'] ?? '',
        token_type: data['token_type'] ?? 'bearer'
      },
      allowed
    );
  }
  switch (data['error']) {
    case 'authorization_pending':
      return json(202, { status: 'authorization_pending' }, allowed);
    case 'slow_down':
      return json(202, { status: 'slow_down' }, allowed);
    case 'expired_token':
      return json(410, { error: 'expired_token', message: 'device code expired' }, allowed);
    case 'access_denied':
      // Terminal: user clicked Cancel. Distinct from 4xx misconfig and
      // from "wrong code" so the studio UI can render the right copy.
      return json(403, { error: 'access_denied' }, allowed);
    default:
      return json(400, { error: 'invalid_device_code' }, allowed);
  }
}
