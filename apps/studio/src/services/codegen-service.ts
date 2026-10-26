// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * Code generation service integration for Studio.
 *
 * Two deployment modes:
 *  - **Local**: baseUrl points at `http://localhost:8377`; Studio talks to the
 *    existing codegen server started by `pnpm codegen:start`. Endpoints used:
 *    /api/health, /api/languages, /api/generate.
 *  - **Hosted** (feature 011-export-code-cf): baseUrl is relative (`/rune-studio`)
 *    or a non-localhost absolute URL. Studio talks to the CF Worker which
 *    exposes the new `/api/generate/health` + `/api/generate` contract,
 *    gated by CF Turnstile + Durable Object rate-limiting.
 *
 * @see specs/008-core-editor-features/contracts/codegen-api.md (local)
 * @see specs/011-export-code-cf/contracts/http-generate.md (hosted)
 */

import { isRecord } from './message-guards.js';
import type { FormPreviewSchema, GeneratedProjection, ProjectionSubject } from '@rune-langium/codegen/export';
import type { ProjectRuntimeInput } from './project-runtime-input.js';
import type { ProjectResolutionReceipt } from '@rune-langium/core/project-contract';
import type { ProjectSnapshot } from '@rune-langium/project-config';

export interface ProjectionRequest {
  type: 'projection:generate';
  requestId: string;
  language: GeneratedProjection['language'];
  subject: ProjectionSubject;
  kind: 'function' | 'condition';
  source: string;
  filesRevision: number;
}

export const isProjectionResultMessage = withInstrumentation(
  function isProjectionResultMessage(
    value: unknown
  ): value is { type: 'projection:result'; requestId: string; projection: GeneratedProjection } {
    if (
      !isRecord(value) ||
      value.type !== 'projection:result' ||
      typeof value.requestId !== 'string' ||
      !isRecord(value.projection)
    )
      return false;
    const projection = value.projection;
    return (
      (projection.language === 'typescript' || projection.language === 'python') &&
      typeof projection.code === 'string' &&
      isRecord(projection.subject) &&
      typeof projection.subject.uri === 'string' &&
      typeof projection.subject.nodeId === 'string' &&
      isRecord(projection.subject.region) &&
      Number.isSafeInteger(projection.subject.region.from) &&
      Number.isSafeInteger(projection.subject.region.to) &&
      Array.isArray(projection.sourceMap) &&
      Array.isArray(projection.requiredHelpers) &&
      projection.requiredHelpers.every((name) => typeof name === 'string')
    );
  },
  { op: 'isProjectionResultMessage' }
);

export const isProjectionErrorMessage = withInstrumentation(
  function isProjectionErrorMessage(
    value: unknown
  ): value is { type: 'projection:error'; requestId: string; error: string } {
    return (
      isRecord(value) &&
      value.type === 'projection:error' &&
      typeof value.requestId === 'string' &&
      typeof value.error === 'string'
    );
  },
  { op: 'isProjectionErrorMessage' }
);
import type {
  CodeGenerationRequest,
  CodeGenerationResult,
  GeneratedFile,
  GenerationError
} from '@rune-langium/codegen-legacy';
import { withInstrumentation, Capture } from './instrumentation/core.js';

export type { CodeGenerationRequest, CodeGenerationResult, GeneratedFile };

export interface PreviewFileEntry {
  uri: string;
  content: string;
  /**
   * Pre-serialized Langium AST for curated bundle files (CDM, FpML,
   * rune-dsl). When present, the codegen worker deserializes this
   * instead of parsing `content` (which is empty for curated refOnly
   * entries — the raw .rune source isn't shipped client-side).
   *
   * 019 Task #88 follow-up — curated form preview was broken because
   * the worker filtered empty-content docs as parse errors. Hydrating
   * via this field gives the preview emitter a fully-typed AST.
   */
  serializedModelJson?: string;
}

export interface PreviewSetFilesMessage {
  project?: ProjectRuntimeInput;
  projectUnavailable?: string;
  type: 'preview:setFiles';
  files: PreviewFileEntry[];
  requestId?: string;
  /** Monotonic provider-side revision for this exact preview-file snapshot. */
  filesRevision: number;
}

export interface PreviewFilesReadyMessage {
  projectReceipt?: ProjectResolutionReceipt;
  projectError?: string;
  type: 'preview:files-ready';
  requestId: string;
  filesRevision: number;
}

export interface PreviewGenerateMessage {
  type: 'preview:generate';
  targetId: string;
  requestId: string;
}

export interface PreviewResultMessage {
  type: 'preview:result';
  targetId: string;
  requestId: string;
  schema: FormPreviewSchema;
}

export interface PreviewStaleMessage {
  type: 'preview:stale';
  targetId?: string;
  requestId: string;
  reason: 'parse-error' | 'generation-error' | 'unsupported-target' | 'no-files';
  message: string;
}

export interface PreviewExecuteMessage {
  type: 'preview:execute';
  funcName: string;
  inputs: Record<string, unknown>;
  requestId: string;
}

export interface InstanceValidateMessage {
  type: 'instance:validate';
  typeFqn: string;
  data: Record<string, unknown>;
  requestId: string;
}

// `data` is user-entered form/instance data — never captured. `typeFqn` is
// dropped too: it names a type from the CURRENT workspace's own model,
// which may or may not be from the curated (public) corpus — not
// confidently safe either way, so treated as unsafe by default. Only
// `requestId` (an app-minted UUID) is captured.
export const createInstanceValidateMessage = withInstrumentation(
  function createInstanceValidateMessage(
    typeFqn: string,
    data: Record<string, unknown>,
    requestId: string
  ): InstanceValidateMessage {
    return { type: 'instance:validate', typeFqn, data, requestId };
  },
  {
    op: 'createInstanceValidateMessage',
    capture: Capture.Input,
    sanitize: (value, which) => (which === 'input' ? { requestId: (value as [string, unknown, string])[2] } : undefined)
  }
);

export const isPreviewExecuteResultMessage = withInstrumentation(
  function isPreviewExecuteResultMessage(msg: unknown): msg is {
    type: 'preview:execute-result';
    requestId: string;
    funcName: string;
    output: unknown;
  } {
    return (
      typeof msg === 'object' && msg !== null && (msg as Record<string, unknown>).type === 'preview:execute-result'
    );
  },
  {
    op: 'isPreviewExecuteResultMessage',
    capture: Capture.Output,
    sanitize: (value, which) => (which === 'output' ? value : undefined)
  }
);

export const isPreviewExecuteErrorMessage = withInstrumentation(
  function isPreviewExecuteErrorMessage(msg: unknown): msg is {
    type: 'preview:execute-error';
    requestId: string;
    funcName: string;
    error: string;
  } {
    return typeof msg === 'object' && msg !== null && (msg as Record<string, unknown>).type === 'preview:execute-error';
  },
  {
    op: 'isPreviewExecuteErrorMessage',
    capture: Capture.Output,
    sanitize: (value, which) => (which === 'output' ? value : undefined)
  }
);

export const isInstanceValidateResultMessage = withInstrumentation(
  function isInstanceValidateResultMessage(msg: unknown): msg is {
    type: 'instance:validateResult';
    unavailable?: string;
    requestId: string;
    diagnostics: Array<{ path: string; message: string; conditionName?: string }>;
  } {
    return (
      typeof msg === 'object' && msg !== null && (msg as Record<string, unknown>).type === 'instance:validateResult'
    );
  },
  {
    op: 'isInstanceValidateResultMessage',
    capture: Capture.Output,
    sanitize: (value, which) => (which === 'output' ? value : undefined)
  }
);

/**
 * Own message channel for instance-editing's schema fetches (finding
 * #6/#7 fix) — previously these piggy-backed on `preview:generate`/
 * `preview:result`, the SAME messages `usePreviewStore` uses for the
 * Preview perspective's own target selection. The codegen worker tracks
 * module-level `lastPreviewTargetId`/`lastPreviewRequestId` keyed off ANY
 * `preview:generate` message, so an instance schema fetch could silently
 * overwrite which target gets re-generated on the next `preview:setFiles`
 * — corrupting the Preview perspective's state for a type the user never
 * selected there. A distinct request/response pair (mirroring
 * `instance:validate`/`instance:validateResult`) means the codegen worker
 * never touches `lastPreviewTargetId`/`lastPreviewRequestId` for these
 * requests at all — no ambiguity to disambiguate on the receiving end.
 */
export interface InstanceGenerateSchemaMessage {
  type: 'instance:generateSchema';
  typeFqn: string;
  requestId: string;
}

// typeFqn dropped — see createInstanceValidateMessage's comment above.
export const createInstanceGenerateSchemaMessage = withInstrumentation(
  function createInstanceGenerateSchemaMessage(typeFqn: string, requestId: string): InstanceGenerateSchemaMessage {
    return { type: 'instance:generateSchema', typeFqn, requestId };
  },
  {
    op: 'createInstanceGenerateSchemaMessage',
    capture: Capture.Input,
    sanitize: (value, which) => (which === 'input' ? { requestId: (value as [string, string])[1] } : undefined)
  }
);

export const isInstanceGenerateSchemaResultMessage = withInstrumentation(
  function isInstanceGenerateSchemaResultMessage(msg: unknown): msg is {
    type: 'instance:generateSchemaResult';
    requestId: string;
    schema: FormPreviewSchema;
  } {
    if (typeof msg !== 'object' || msg === null) return false;
    const candidate = msg as Record<string, unknown>;
    return (
      candidate.type === 'instance:generateSchemaResult' &&
      typeof candidate.requestId === 'string' &&
      isFormPreviewSchema(candidate.schema)
    );
  },
  {
    op: 'isInstanceGenerateSchemaResultMessage',
    capture: Capture.Output,
    sanitize: (value, which) => (which === 'output' ? value : undefined)
  }
);

export const isInstanceGenerateSchemaStaleMessage = withInstrumentation(
  function isInstanceGenerateSchemaStaleMessage(msg: unknown): msg is {
    type: 'instance:generateSchemaStale';
    requestId: string;
    reason: PreviewStaleMessage['reason'];
    message: string;
  } {
    if (typeof msg !== 'object' || msg === null) return false;
    const candidate = msg as Record<string, unknown>;
    return (
      candidate.type === 'instance:generateSchemaStale' &&
      typeof candidate.requestId === 'string' &&
      typeof candidate.reason === 'string' &&
      PREVIEW_STALE_REASONS.has(candidate.reason as PreviewStaleMessage['reason']) &&
      typeof candidate.message === 'string'
    );
  },
  {
    op: 'isInstanceGenerateSchemaStaleMessage',
    capture: Capture.Output,
    sanitize: (value, which) => (which === 'output' ? value : undefined)
  }
);

export type PreviewWorkerRequest = PreviewSetFilesMessage | PreviewGenerateMessage;
export type PreviewWorkerMessage = PreviewResultMessage | PreviewStaleMessage;

const PREVIEW_STALE_REASONS = new Set<PreviewStaleMessage['reason']>([
  'parse-error',
  'generation-error',
  'unsupported-target',
  'no-files'
]);

// `files[].content`/`serializedModelJson` are raw model source text — never
// captured; only a count plus the app-minted requestId.
export const createPreviewSetFilesMessage = withInstrumentation(
  function createPreviewSetFilesMessage(
    files: PreviewFileEntry[],
    requestId: string | undefined,
    filesRevision: number
  ): PreviewSetFilesMessage {
    return {
      type: 'preview:setFiles',
      files,
      ...(requestId ? { requestId } : {}),
      filesRevision
    };
  },
  {
    op: 'createPreviewSetFilesMessage',
    capture: Capture.Input,
    sanitize: (value, which) => {
      if (which !== 'input') return undefined;
      const [files, requestId] = value as [PreviewFileEntry[], string | undefined];
      return { fileCount: files.length, requestId };
    }
  }
);

export const isPreviewFilesReadyMessage = withInstrumentation(
  function isPreviewFilesReadyMessage(msg: unknown): msg is PreviewFilesReadyMessage {
    if (!isRecord(msg)) return false;
    return (
      msg.type === 'preview:files-ready' &&
      typeof msg.requestId === 'string' &&
      typeof msg.filesRevision === 'number' &&
      Number.isSafeInteger(msg.filesRevision) &&
      msg.filesRevision >= 0
    );
  },
  {
    op: 'isPreviewFilesReadyMessage',
    capture: Capture.Output,
    sanitize: (value, which) => (which === 'output' ? value : undefined)
  }
);

// targetId dropped — see createInstanceValidateMessage's comment above.
export const createPreviewGenerateMessage = withInstrumentation(
  function createPreviewGenerateMessage(targetId: string, requestId: string): PreviewGenerateMessage {
    return { type: 'preview:generate', targetId, requestId };
  },
  {
    op: 'createPreviewGenerateMessage',
    capture: Capture.Input,
    sanitize: (value, which) => (which === 'input' ? { requestId: (value as [string, string])[1] } : undefined)
  }
);

export const isPreviewWorkerMessage = withInstrumentation(
  function isPreviewWorkerMessage(message: unknown): message is PreviewWorkerMessage {
    if (!message || typeof message !== 'object') return false;
    const candidate = message as Record<string, unknown>;
    const type = candidate.type;
    if (type === 'preview:result') {
      return (
        typeof candidate.targetId === 'string' &&
        typeof candidate.requestId === 'string' &&
        isFormPreviewSchema(candidate.schema)
      );
    }
    if (type === 'preview:stale') {
      return (
        (candidate.targetId === undefined || typeof candidate.targetId === 'string') &&
        typeof candidate.requestId === 'string' &&
        typeof candidate.reason === 'string' &&
        PREVIEW_STALE_REASONS.has(candidate.reason as PreviewStaleMessage['reason']) &&
        typeof candidate.message === 'string'
      );
    }
    return false;
  },
  {
    op: 'isPreviewWorkerMessage',
    capture: Capture.Output,
    sanitize: (value, which) => (which === 'output' ? value : undefined)
  }
);

function isFormPreviewSchema(value: unknown): value is FormPreviewSchema {
  if (!isRecord(value)) return false;
  const candidate = value;
  if (
    candidate.schemaVersion !== 1 ||
    typeof candidate.targetId !== 'string' ||
    typeof candidate.title !== 'string' ||
    (candidate.status !== 'ready' && candidate.status !== 'unsupported') ||
    !Array.isArray(candidate.fields) ||
    !candidate.fields.every(isPreviewField)
  ) {
    return false;
  }
  if (
    candidate.unsupportedFeatures !== undefined &&
    (!Array.isArray(candidate.unsupportedFeatures) ||
      !candidate.unsupportedFeatures.every((item) => typeof item === 'string'))
  ) {
    return false;
  }
  if (candidate.result !== undefined && !isPreviewField(candidate.result)) return false;
  if (candidate.functionOutput !== undefined && !isFunctionPreviewOutput(candidate.functionOutput)) return false;
  if (
    candidate.sourceMap !== undefined &&
    (!Array.isArray(candidate.sourceMap) || !candidate.sourceMap.every(isPreviewSourceMapEntry))
  ) {
    return false;
  }
  return true;
}

function isFunctionPreviewOutput(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.typeFqn === 'string' &&
    (value.kind === 'data' || value.kind === 'choice') &&
    isRecord(value.cardinality) &&
    typeof value.cardinality.min === 'number' &&
    Number.isSafeInteger(value.cardinality.min) &&
    value.cardinality.min >= 0 &&
    (value.cardinality.max === 'unbounded' ||
      (typeof value.cardinality.max === 'number' &&
        Number.isSafeInteger(value.cardinality.max) &&
        value.cardinality.max >= value.cardinality.min))
  );
}

function isPreviewField(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const candidate = value;
  if (
    typeof candidate.path !== 'string' ||
    typeof candidate.label !== 'string' ||
    typeof candidate.required !== 'boolean' ||
    !isPreviewFieldKind(candidate.kind)
  ) {
    return false;
  }
  if (candidate.cardinality !== undefined && !isPreviewCardinality(candidate.cardinality as Record<string, unknown>)) {
    return false;
  }
  if (candidate.description !== undefined && typeof candidate.description !== 'string') {
    return false;
  }
  switch (candidate.kind) {
    case 'enum':
      return Array.isArray(candidate.enumValues) && candidate.enumValues.every(isEnumValue);
    case 'object':
      return (
        Array.isArray(candidate.children) &&
        candidate.children.every(isPreviewField) &&
        (candidate.assignableTypeFqns === undefined ||
          (Array.isArray(candidate.assignableTypeFqns) &&
            candidate.assignableTypeFqns.every((typeFqn) => typeof typeFqn === 'string')))
      );
    case 'array':
      return (
        Array.isArray(candidate.children) && candidate.children.length === 1 && candidate.children.every(isPreviewField)
      );
    default:
      return candidate.enumValues === undefined && candidate.children === undefined;
  }
}

function isPreviewFieldKind(value: unknown): boolean {
  return (
    value === 'string' ||
    value === 'number' ||
    value === 'boolean' ||
    value === 'enum' ||
    value === 'object' ||
    value === 'array' ||
    value === 'unknown'
  );
}

function isPreviewCardinality(value: Record<string, unknown>): boolean {
  return (
    (value.min === undefined || typeof value.min === 'number') &&
    (value.max === undefined || typeof value.max === 'number' || value.max === 'unbounded')
  );
}

function isEnumValue(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const candidate = value;
  return typeof candidate.value === 'string' && typeof candidate.label === 'string';
}

function isPreviewSourceMapEntry(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const candidate = value;
  return (
    typeof candidate.fieldPath === 'string' &&
    typeof candidate.sourceUri === 'string' &&
    typeof candidate.sourceLine === 'number' &&
    typeof candidate.sourceChar === 'number'
  );
}

function isGeneratedFile(value: unknown): value is GeneratedFile {
  return isRecord(value) && typeof value.path === 'string' && typeof value.content === 'string';
}

function isGenerationError(value: unknown): value is GenerationError {
  return (
    isRecord(value) &&
    typeof value.sourceFile === 'string' &&
    typeof value.construct === 'string' &&
    typeof value.message === 'string'
  );
}

function parseCodeGenerationResultBody(value: unknown): Omit<CodeGenerationResult, 'language'> | null {
  if (
    !isRecord(value) ||
    !Array.isArray(value.files) ||
    !value.files.every(isGeneratedFile) ||
    !Array.isArray(value.errors) ||
    !value.errors.every(isGenerationError) ||
    (value.warnings !== undefined &&
      (!Array.isArray(value.warnings) || !value.warnings.every((warning) => typeof warning === 'string')))
  ) {
    return null;
  }
  return {
    files: value.files,
    errors: value.errors,
    warnings: Array.isArray(value.warnings) ? value.warnings : []
  };
}

function isHostedLanguagesEnvelope(value: unknown): value is { languages?: string[] } {
  return (
    isRecord(value) &&
    (value.languages === undefined ||
      (Array.isArray(value.languages) && value.languages.every((item) => typeof item === 'string')))
  );
}

function isLocalLanguagesEnvelope(value: unknown): value is { languages: Array<{ id: string; class: string }> } {
  return (
    isRecord(value) &&
    Array.isArray(value.languages) &&
    value.languages.every((item) => isRecord(item) && typeof item.id === 'string' && typeof item.class === 'string')
  );
}

/**
 * Default codegen service URL. Override via VITE_CODEGEN_URL env var.
 *
 * In the browser we resolve to the same-origin Worker route base
 * (`/rune-studio`) so the proxy's URL composition yields
 * `/rune-studio/api/generate` (POST) and `/rune-studio/api/generate/health`
 * (GET) — the actual hosted contract served by the `rune-codegen-worker`
 * via the wrangler route `www.daikonic.dev/rune-studio/api/generate/*`.
 *
 * Earlier defaults were broken:
 *   - `http://localhost:8377` shipped a dev-server URL in prod bundles.
 *   - `/api/codegen` composed to `/api/codegen/api/generate`, a path that
 *     matches NO deployed route (the Pages Function at `/api/codegen` is a
 *     *different* API — it's the studio's Download flow, not the legacy
 *     `/api/generate` ExportDialog contract). That broke the availability
 *     probe + every generation request when `VITE_CODEGEN_URL` was unset.
 *
 * The Node/SSR fallback keeps the wrangler-dev URL (`http://localhost:8377`)
 * so CLI consumers and type-checks continue to point at `pnpm dev:codegen`'s
 * default port. This branch only runs in `typeof window === 'undefined'`
 * contexts (test setup, SSR) — it never reaches the prod browser bundle.
 *
 * The canonical production override is set explicitly by
 * `apps/docs/scripts/build-combined.mjs` (`VITE_CODEGEN_URL=/rune-studio`).
 * This default exists so a standalone studio build (no combined-docs step)
 * still produces a working bundle.
 */
const DEFAULT_CODEGEN_URL = typeof window === 'undefined' ? 'http://localhost:8377' : '/rune-studio';

export interface GenerateOptions {
  /**
   * Turnstile token from the widget. Required for the first generation per
   * hosted session; subsequent generations omit this and rely on the
   * hcsession cookie. Ignored in local mode.
   */
  turnstileToken?: string;
}

/**
 * Browser-compatible proxy that calls the codegen HTTP API.
 * For CLI usage, use CodegenServiceProxy from '@rune-langium/codegen-legacy/node'.
 */
export class BrowserCodegenProxy {
  private readonly baseUrl: string;

  constructor(baseUrl?: string) {
    const envUrl =
      typeof import.meta !== 'undefined'
        ? (import.meta as unknown as Record<string, Record<string, string>>).env?.['VITE_CODEGEN_URL']
        : undefined;
    this.baseUrl = baseUrl ?? envUrl ?? DEFAULT_CODEGEN_URL;
  }

  /**
   * True when this proxy targets the hosted Worker (relative URL or
   * non-localhost absolute URL). Callers use this to decide whether to
   * render the Turnstile widget and which endpoints to hit.
   */
  isHostedService(): boolean {
    const base = this.baseUrl;
    if (base.startsWith('/')) return true;
    try {
      const { hostname } = new URL(base);
      return hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '0.0.0.0';
    } catch {
      // Non-absolute, non-root-relative URL — treat as hosted (safer default).
      return true;
    }
  }

  async generate(
    request: CodeGenerationRequest,
    signal?: AbortSignal,
    options?: GenerateOptions
  ): Promise<CodeGenerationResult> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (options?.turnstileToken) {
      headers['X-Turnstile-Token'] = options.turnstileToken;
    }

    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
      signal,
      // Hosted only: the hcsession cookie the Worker sets on first generation
      // must ride along on subsequent requests. In local mode we use `omit`
      // because the local codegen server sends Access-Control-Allow-Origin:*
      // and browsers reject credentialed CORS against a wildcard origin.
      credentials: this.isHostedService() ? 'include' : 'omit'
    });

    if (!response.ok) {
      if (response.status === 422) {
        const body = await response.json();
        return {
          language: request.language,
          files: [],
          errors:
            isRecord(body) && Array.isArray(body.errors) && body.errors.every(isGenerationError)
              ? body.errors
              : [
                  {
                    sourceFile: '',
                    construct: '',
                    message: 'Validation errors in input model'
                  }
                ],
          warnings: []
        };
      }
      // Let callers distinguish by status via the thrown message; dialog-side
      // UX maps 401/429/5xx to specific messages (see ExportDialog T028).
      const err = new Error(`Code generation failed (HTTP ${response.status})`);
      (err as Error & { status?: number }).status = response.status;
      try {
        (err as Error & { body?: unknown }).body = await response.json();
      } catch {
        /* non-JSON body; ignore */
      }
      throw err;
    }

    const result = parseCodeGenerationResultBody(await response.json());
    if (!result) {
      throw new Error('Code generation returned an invalid response payload');
    }
    return { language: request.language, ...result };
  }

  async listLanguages(): Promise<Array<{ id: string; class: string }>> {
    if (this.isHostedService()) {
      // New contract returns languages inside the health envelope.
      const response = await fetch(`${this.baseUrl}/api/generate/health`);
      if (!response.ok) {
        throw new Error(`Language discovery failed (HTTP ${response.status})`);
      }
      const data = await response.json();
      if (!isHostedLanguagesEnvelope(data)) {
        throw new Error('Language discovery returned an invalid hosted response payload');
      }
      return (data.languages ?? []).map((id) => ({ id, class: '' }));
    }
    const response = await fetch(`${this.baseUrl}/api/languages`);
    if (!response.ok) {
      throw new Error(`Language discovery failed (HTTP ${response.status})`);
    }
    const data = await response.json();
    if (!isLocalLanguagesEnvelope(data)) {
      throw new Error('Language discovery returned an invalid local response payload');
    }
    return data.languages;
  }

  async isAvailable(): Promise<boolean> {
    const path = this.isHostedService() ? '/api/generate/health' : '/api/health';
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        signal: AbortSignal.timeout(3000)
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

let _instance: BrowserCodegenProxy | undefined;

export const getCodegenService = withInstrumentation(
  function getCodegenService(): BrowserCodegenProxy {
    if (!_instance) {
      _instance = new BrowserCodegenProxy();
    }
    return _instance;
  },
  { op: 'getCodegenService' }
);

/** Correlated object adaptation shares the preview worker's applied project generation. */
export interface InstanceDecodeMessage {
  type: 'instance:decode';
  typeFqn: string;
  data: unknown;
  requestId: string;
}

export interface InstanceSerializeMessage {
  type: 'instance:serialize';
  snapshot: ProjectSnapshot;
  typeFqn: string;
  data: unknown;
  requestId: string;
}
export const isInstanceSerializeResultMessage = withInstrumentation(
  function isInstanceSerializeResultMessage(value: unknown): value is {
    type: 'instance:serializeResult';
    requestId: string;
    text?: string;
    error?: string;
  } {
    return (
      isRecord(value) &&
      value.type === 'instance:serializeResult' &&
      typeof value.requestId === 'string' &&
      (typeof value.text === 'string' || typeof value.error === 'string')
    );
  },
  { op: 'isInstanceSerializeResultMessage', capture: 0 }
);
export const isInstanceDecodeResultMessage = withInstrumentation(
  function isInstanceDecodeResultMessage(
    value: unknown
  ): value is { type: 'instance:decodeResult'; requestId: string; data?: unknown; error?: string } {
    return (
      value !== null &&
      typeof value === 'object' &&
      (value as Record<string, unknown>).type === 'instance:decodeResult' &&
      typeof (value as Record<string, unknown>).requestId === 'string'
    );
  },
  { op: 'isInstanceDecodeResultMessage', capture: 0 }
);
