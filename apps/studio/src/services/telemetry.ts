// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * Anonymised telemetry client. Wire format: contracts/telemetry-event.md.
 *
 * Privacy invariants enforced here:
 *  - Disabled when running against localhost (dev or e2e).
 *  - Disabled when the user has set telemetry-enabled=false.
 *  - Schema is a closed discriminated union — anything that doesn't fit
 *    is rejected with a thrown error before any fetch is made.
 *  - Fetch failures are swallowed; telemetry MUST NEVER block the user.
 */

import { z } from 'zod';
import { CuratedModelIdSchema, ErrorCategorySchema } from '@rune-langium/curated-schema';
import { withInstrumentation, Capture } from './instrumentation/core.js';
import { withAbortTimeout } from './with-abort-timeout.js';

/**
 * Shared duration ceiling for every `durationMs` field in the wire schema
 * below. Also imported by telemetry-shipper.ts's `toSpan()`, which must
 * clamp to this same value before shipping — an instrumented call with no
 * abort timeout (e.g. transport-provider.ts's mintSessionToken fetch) can
 * in principle stay pending well past this, and `client.emit()`'s schema
 * validation rejecting one out-of-range span silently drops the WHOLE
 * batch (see flush()'s swallowed-rejection comment), not just that span.
 */
export const MAX_SPAN_DURATION_MS = 600_000;

const TelemetryEventSchema = z.discriminatedUnion('event', [
  z
    .object({
      event: z.literal('curated_load_attempt'),
      modelId: CuratedModelIdSchema
    })
    .strict(),
  z
    .object({
      event: z.literal('curated_load_success'),
      modelId: CuratedModelIdSchema,
      durationMs: z.number().int().nonnegative().max(MAX_SPAN_DURATION_MS)
    })
    .strict(),
  z
    .object({
      event: z.literal('curated_load_failure'),
      modelId: CuratedModelIdSchema,
      errorCategory: ErrorCategorySchema
    })
    .strict(),
  z
    .object({
      event: z.enum([
        'workspace_open_success',
        'workspace_open_failure',
        'workspace_restore_success',
        'workspace_restore_failure'
      ])
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
            durationMs: z.number().int().nonnegative().max(MAX_SPAN_DURATION_MS).optional(),
            level: z.enum(['info', 'warn', 'error']),
            signature: z.string().max(200).optional(),
            opId: z.number().int().optional()
          })
        )
        .min(1)
        .max(50)
    })
    .strict()
]);

export type TelemetryEvent = z.infer<typeof TelemetryEventSchema>;

export interface TelemetryClientOptions {
  endpoint: string;
  enabled: boolean;
  studioVersion: string;
  uaClass: string;
  /** Live consent gate, checked again before delayed delivery. */
  isEnabled?: () => boolean;
}

export interface TelemetryClient {
  emit(event: TelemetryEvent): Promise<void>;
  clearPending?(): void;
  dispose?(): void;
}

const LOCALHOST_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0']);

function isLocalhost(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return LOCALHOST_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

// options is a config record (endpoint/enabled/studioVersion/uaClass) — a
// fixed vocabulary of app-config values, never user/model content — safe
// to capture verbatim. The returned TelemetryClient is a function-bearing
// object, not useful to output-capture.
export const createTelemetryClient = withInstrumentation(
  function createTelemetryClient(options: TelemetryClientOptions): TelemetryClient {
    const localNoOp = isLocalhost(options.endpoint);
    const queue: Array<{ body: string; attempts: number }> = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cooldownUntil = 0;
    let running = false;
    let disposed = false;
    let generation = 0;
    const enabled = () => !disposed && options.enabled && !localNoOp && (options.isEnabled?.() ?? true);

    function clearPending(): void {
      generation++;
      queue.length = 0;
      cooldownUntil = 0;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    }

    async function drain(): Promise<void> {
      if (running || timer !== undefined) return;
      if (!enabled()) {
        clearPending();
        return;
      }
      const remaining = cooldownUntil - Date.now();
      if (remaining > 0) {
        timer = setTimeout(
          () => {
            timer = undefined;
            void drain();
          },
          Math.min(remaining, 2_147_483_647)
        );
        return;
      }
      running = true;
      try {
        while (queue.length > 0 && enabled()) {
          const item = queue[0]!;
          const epoch = generation;
          item.attempts++;
          try {
            const { response, header, body } = await withAbortTimeout(async (signal) => {
              const response = await fetch(options.endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: item.body,
                credentials: 'omit',
                keepalive: true,
                signal
              });
              const header = response.headers.get('Retry-After');
              const body =
                response.status === 429 && header === null ? await response.json().catch(() => undefined) : undefined;
              return { response, header, body };
            }, 10_000);
            if (epoch !== generation || !enabled()) continue;
            if (response.status === 429) {
              // Only an explicit rejection is replayed; network failures may already be accepted.
              const seconds = header !== null ? Number(header) : body?.retry_after_s;
              const delay =
                typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0
                  ? seconds * 1000
                  : header !== null
                    ? Date.parse(header) - Date.now()
                    : 5000;
              if (epoch !== generation || !enabled()) continue;
              if (item.attempts >= 3) queue.shift();
              cooldownUntil =
                Date.now() + Math.max(Number.isFinite(delay) ? delay : 5000, 1000 * 2 ** (item.attempts - 1));
              timer = setTimeout(
                () => {
                  timer = undefined;
                  void drain();
                },
                Math.min(cooldownUntil - Date.now(), 2_147_483_647)
              );
              return;
            }
          } catch {
            // Best effort: never fail the action or replay an ambiguously accepted request.
          }
          if (epoch === generation) queue.shift();
        }
        if (!enabled()) clearPending();
      } finally {
        running = false;
      }
    }

    return {
      async emit(event: TelemetryEvent): Promise<void> {
        const parsed = TelemetryEventSchema.safeParse(event);
        if (!parsed.success) throw new Error(`telemetry: schema violation — ${parsed.error.message}`);
        if (!enabled()) {
          clearPending();
          return;
        }
        // Memory-only and bounded: consent withdrawal or teardown discards pending events.
        if (queue.length >= 100) return;
        queue.push({
          body: JSON.stringify({ ...parsed.data, studio_version: options.studioVersion, ua_class: options.uaClass }),
          attempts: 0
        });
        await drain();
      },
      clearPending,
      dispose() {
        disposed = true;
        clearPending();
      }
    };
  },
  {
    op: 'createTelemetryClient',
    capture: Capture.Input,
    sanitize: (value, which) => {
      if (which !== 'input') return undefined;
      const [options] = value as [TelemetryClientOptions];
      return {
        endpoint: options.endpoint,
        enabled: options.enabled,
        studioVersion: options.studioVersion,
        uaClass: options.uaClass
      };
    }
  }
);

/**
 * Production endpoint for the telemetry Worker. Routed at the edge by
 * `apps/telemetry-worker/wrangler.toml` to the same-origin path under
 * www.daikonic.dev, so a same-origin POST does not require a preflight.
 */
export const TELEMETRY_ENDPOINT_PROD = 'https://www.daikonic.dev/rune-studio/api/telemetry/v1/event';

export const resolveTelemetryEndpoint = withInstrumentation(
  function resolveTelemetryEndpoint(origin?: string): string {
    const o = origin ?? (typeof location !== 'undefined' ? location.origin : '');
    try {
      const u = new URL(o);
      // `file:` URLs have origin "null" (the string), so naïvely returning
      // `${u.origin}/...` produces `null/rune-studio/...`, which would parse
      // but never resolve. Map both file: and localhost to a known-localhost
      // URL — the client's no-op gate (isLocalhost / `enabled === false`)
      // short-circuits before any fetch is issued.
      if (u.protocol === 'file:') {
        return 'http://localhost/rune-studio/api/telemetry/v1/event';
      }
      if (LOCALHOST_HOSTS.has(u.hostname)) {
        return `${u.origin}/rune-studio/api/telemetry/v1/event`;
      }
    } catch {
      // fall through to prod
    }
    return TELEMETRY_ENDPOINT_PROD;
    // `origin` is always a browser/page origin (protocol+host, e.g.
    // location.origin) — never user/model content — and the returned endpoint
    // is one of a fixed small set of known URLs. Both safe to capture verbatim.
  },
  { op: 'resolveTelemetryEndpoint', capture: Capture.Input | Capture.Output, sanitize: (value) => value }
);
