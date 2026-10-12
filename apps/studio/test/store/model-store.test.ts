// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * T015 — model-store curated path DI tests (014, US1).
 *
 * Asserts the wiring landed in T014 and updated for 019 Phase 0:
 *   - When `source.archiveUrl` is set, `loadModel(...)` is called WITH an
 *     `archiveLoader` (metadata-only path — no archive fetch, no OPFS write).
 *   - When `source.archiveUrl` is NOT set, `loadModel(...)` is called
 *     WITHOUT an archiveLoader.
 *   - 019 Phase 0: the archiveLoader returns a LoadedModel with empty files[]
 *     and commitHash='latest'; no network fetch or OPFS write occurs.
 *
 * Regression (020 Codex P2, PR #195):
 *   - Custom URL sources (no archiveUrl) must NOT receive an archiveLoader —
 *     they should reach the git-clone path in model-loader.ts (FR-007).
 *   - Sources with neither archiveUrl nor repoUrl throw NETWORK immediately.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ModelSource, LoadedModel } from '../../src/types/model-types.js';
import { usePreviewStore } from '../../src/store/preview-store.js';
import { useCodegenStore } from '../../src/store/codegen-store.js';
import { useOutputStore } from '../../src/store/output-store.js';
import { useActivityStore } from '../../src/store/activity-store.js';
import { useTelemetrySettingsStore } from '../../src/store/telemetry-settings.js';

// Mock model-loader.js BEFORE the store imports it. The store calls
// loadModel(source, options) — we capture options.archiveLoader so we can
// assert the DI wiring picked up archiveUrl.
const loadModelMock = vi.fn();
vi.mock('../../src/services/model-loader.js', () => ({
  loadModel: (source: ModelSource, options: unknown) => loadModelMock(source, options)
}));

// Run the store import AFTER the mock above so the store's transitive
// loadModel binding picks up our spy.
const { useModelStore, gatedByUserOptIn } = await import('../../src/store/model-store.js');

const CURATED_SOURCE: ModelSource = {
  id: 'cdm',
  name: 'CDM',
  repoUrl: 'https://github.com/example/cdm.git',
  ref: 'master',
  paths: ['**/*.rosetta'],
  archiveUrl: 'https://www.daikonic.dev/curated/cdm/latest.tar.gz'
};

const CUSTOM_SOURCE: ModelSource = {
  id: 'custom-abc',
  name: 'My Custom Repo',
  repoUrl: 'https://github.com/my/repo.git',
  ref: 'main',
  paths: ['**/*.rosetta']
  // no archiveUrl — custom URL flow, goes through git-clone path (FR-007)
};

/** A degenerate source with neither archiveUrl nor repoUrl — should throw immediately. */
const BARE_SOURCE: ModelSource = {
  id: 'bare-xyz',
  name: 'Bare Source',
  repoUrl: '',
  ref: 'main',
  paths: ['**/*.rosetta']
  // no archiveUrl, no repoUrl — unsupported
};

const FAKE_MODEL: LoadedModel = {
  source: CURATED_SOURCE,
  commitHash: '2026-04-25',
  files: [{ path: 'cdm/sample.rosetta', content: 'namespace cdm.sample\n', namespace: 'cdm.sample' }],
  loadedAt: 0
};

beforeEach(() => {
  loadModelMock.mockReset();
  loadModelMock.mockResolvedValue(FAKE_MODEL);
  // Reset store state so each test starts clean.
  useModelStore.setState({
    models: new Map(),
    loading: new Map(),
    errors: new Map()
  });
  usePreviewStore.getState().resetPreviewState();
  useCodegenStore.getState().resetCodegenState();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useModelStore — archiveLoader DI (T015)', () => {
  it('passes an archiveLoader to loadModel when source.archiveUrl is set', async () => {
    await useModelStore.getState().load(CURATED_SOURCE);

    expect(loadModelMock).toHaveBeenCalledTimes(1);
    const [src, opts] = loadModelMock.mock.calls[0]!;
    expect(src).toBe(CURATED_SOURCE);
    expect(opts).toMatchObject({
      archiveLoader: expect.any(Function),
      signal: expect.any(AbortSignal),
      onProgress: expect.any(Function)
    });
  });

  it('does NOT pass an archiveLoader when source.archiveUrl is undefined', async () => {
    await useModelStore.getState().load(CUSTOM_SOURCE);

    expect(loadModelMock).toHaveBeenCalledTimes(1);
    const [src, opts] = loadModelMock.mock.calls[0]!;
    expect(src).toBe(CUSTOM_SOURCE);
    expect((opts as { archiveLoader?: unknown }).archiveLoader).toBeUndefined();
  });

  it('source with no archiveUrl AND no repoUrl throws NETWORK immediately', async () => {
    // model-loader throws NETWORK if there is neither an archive URL nor a git
    // URL to clone — there is simply no way to load the source.
    vi.resetModules();
    vi.doUnmock('../../src/services/model-loader.js');
    const { loadModel } = await import('../../src/services/model-loader.js');
    await expect(loadModel(BARE_SOURCE)).rejects.toMatchObject({
      code: 'NETWORK',
      message: expect.stringMatching(/no archive loader or git url/i)
    });
    // Re-mock so the rest of the suite continues to use loadModelMock.
    vi.doMock('../../src/services/model-loader.js', () => ({
      loadModel: (source: ModelSource, options: unknown) => loadModelMock(source, options)
    }));
  });

  it('custom URL source (no archiveUrl) does NOT receive archiveLoader — reaches git-clone path', async () => {
    // FR-007 regression: the cleanup of legacyGitPathEnabled (commit 25cc5a07)
    // incorrectly threw NETWORK for CUSTOM_SOURCE before the git-clone path
    // was reached. Verify that model-store passes no archiveLoader for custom
    // sources (git-clone path selection is model-loader's job, not the store's).
    await useModelStore.getState().load(CUSTOM_SOURCE);

    expect(loadModelMock).toHaveBeenCalledTimes(1);
    const [src, opts] = loadModelMock.mock.calls[0]!;
    expect(src).toBe(CUSTOM_SOURCE);
    // store must NOT pass an archiveLoader — that would bypass the git-clone path
    expect((opts as { archiveLoader?: unknown }).archiveLoader).toBeUndefined();
    // store MUST still pass signal and onProgress for cancellation / progress
    expect((opts as { signal?: unknown }).signal).toBeInstanceOf(AbortSignal);
    expect(typeof (opts as { onProgress?: unknown }).onProgress).toBe('function');
  });

  it('archiveLoader callback returns metadata-only LoadedModel without fetching (019 Phase 0)', async () => {
    // 019 Phase 0: the archive loader no longer fetches the archive or writes
    // to OPFS. It returns a LoadedModel with empty files[] and commitHash='latest'.
    let capturedArchiveLoader: unknown = undefined;
    loadModelMock.mockImplementation(async (_source: ModelSource, options: { archiveLoader?: unknown }) => {
      capturedArchiveLoader = options.archiveLoader;
      return FAKE_MODEL;
    });

    await useModelStore.getState().load(CURATED_SOURCE);
    expect(typeof capturedArchiveLoader).toBe('function');

    // Invoke the captured loader directly and verify the returned shape.
    const result = await (
      capturedArchiveLoader as (
        s: ModelSource,
        o: { signal?: AbortSignal; onProgress?: (p: unknown) => void }
      ) => Promise<LoadedModel>
    )(CURATED_SOURCE, { signal: new AbortController().signal });

    // 019 Phase 0: no archive fetch — files[] is empty, commitHash is 'latest'.
    expect(result.files).toEqual([]);
    expect(result.commitHash).toBe('latest');
    expect(result.source).toBe(CURATED_SOURCE);
  });

  it.each(['resolve', 'reject'] as const)('ignores a cancelled load that later %ss', async (outcome) => {
    let finish!: (value: LoadedModel) => void;
    let fail!: (reason: Error) => void;
    loadModelMock.mockImplementationOnce(
      () =>
        new Promise<LoadedModel>((resolve, reject) => {
          finish = resolve;
          fail = reject;
        })
    );
    const oldLoad = useModelStore.getState().load(CURATED_SOURCE);
    const oldSignal = loadModelMock.mock.calls[0]![1].signal as AbortSignal;
    useModelStore.getState().cancel(CURATED_SOURCE.id);
    expect(oldSignal.aborted).toBe(true);

    let finishNew!: (value: LoadedModel) => void;
    loadModelMock.mockImplementationOnce(
      () =>
        new Promise<LoadedModel>((resolve) => {
          finishNew = resolve;
        })
    );
    const newLoad = useModelStore.getState().load(CURATED_SOURCE);
    if (outcome === 'resolve') finish(FAKE_MODEL);
    else fail(new Error('old workspace failed'));
    await oldLoad;
    expect(useModelStore.getState().models.size).toBe(0);
    expect(useModelStore.getState().errors.size).toBe(0);
    expect(useModelStore.getState().loading.has(CURATED_SOURCE.id)).toBe(true);

    const newModel = { ...FAKE_MODEL, commitHash: 'new-workspace' };
    finishNew(newModel);
    await newLoad;
    expect(useModelStore.getState().models.get(CURATED_SOURCE.id)).toBe(newModel);
    expect(useModelStore.getState().loading.size).toBe(0);
  });

  it('resets preview and codegen state when the last loaded model is unloaded', () => {
    useModelStore.setState({
      models: new Map([['cdm', FAKE_MODEL]]),
      loading: new Map(),
      errors: new Map()
    });
    usePreviewStore.setState({
      targets: [{ id: 'cdm.Trade', namespace: 'cdm', name: 'Trade', kind: 'data' }],
      selectedTargetId: 'cdm.Trade',
      selectedTarget: { id: 'cdm.Trade', namespace: 'cdm', name: 'Trade', kind: 'data' },
      schemas: new Map([
        [
          'cdm.Trade',
          {
            schemaVersion: 1,
            targetId: 'cdm.Trade',
            title: 'Trade',
            status: 'ready',
            fields: []
          }
        ]
      ]),
      samples: new Map(),
      status: { state: 'ready', targetId: 'cdm.Trade' }
    });
    useCodegenStore.getState().setCodePreviewTarget('typescript');

    useModelStore.getState().unload('cdm');

    expect(useModelStore.getState().models.size).toBe(0);
    expect(usePreviewStore.getState().selectedTargetId).toBeUndefined();
    expect(usePreviewStore.getState().status).toEqual({ state: 'waiting' });
    expect(useCodegenStore.getState().codePreviewTarget).toBe('zod');
  });

  // Task 6 (2026-07-16 prod-ux-checkout-harness): load() gains its first-ever
  // Activity/Output logging, tagged op="modelLoad", correlated by a single
  // allocateOpId() per load() invocation and a real performance.now() span.
  it('load() publishes a success activity entry with op="modelLoad" and a durationMs', async () => {
    useOutputStore.setState({ lines: [] });
    useActivityStore.setState({ entries: [] });

    await useModelStore.getState().load(CURATED_SOURCE);

    const entries = useActivityStore.getState().entries;
    const modelLoadEntries = entries.filter((e) => e.tag === 'modelLoad');
    expect(modelLoadEntries).toHaveLength(1);
    expect(modelLoadEntries[0]?.ok).toBe(true);
    expect(modelLoadEntries[0]?.subject).toBe('cdm');
    expect(modelLoadEntries[0]?.durationMs).toBeGreaterThanOrEqual(0);
    expect(modelLoadEntries[0]?.opId).toBeTypeOf('number');

    const lines = useOutputStore.getState().lines;
    const modelLoadLines = lines.filter((l) => l.op === 'modelLoad');
    expect(modelLoadLines).toHaveLength(1);
    expect(modelLoadLines[0]?.severity).toBe('success');
    expect(modelLoadLines[0]?.subject).toBe('cdm');
    expect(modelLoadLines[0]?.opId).toBe(modelLoadEntries[0]?.opId);
  });

  it('load() publishes a failure activity entry with ok=false on error', async () => {
    useOutputStore.setState({ lines: [] });
    useActivityStore.setState({ entries: [] });
    // Reuse this file's existing loadModelMock (a plain vi.fn()) rejection
    // convention rather than inventing a new mocking approach.
    loadModelMock.mockRejectedValueOnce(new Error('network unreachable'));

    await useModelStore.getState().load(CURATED_SOURCE);

    const entries = useActivityStore.getState().entries;
    const modelLoadEntries = entries.filter((e) => e.tag === 'modelLoad');
    expect(modelLoadEntries).toHaveLength(1);
    expect(modelLoadEntries[0]?.ok).toBe(false);
    expect(modelLoadEntries[0]?.subject).toBe('cdm');
    expect(modelLoadEntries[0]?.durationMs).toBeGreaterThanOrEqual(0);

    const lines = useOutputStore.getState().lines;
    const modelLoadLines = lines.filter((l) => l.op === 'modelLoad');
    expect(modelLoadLines).toHaveLength(1);
    expect(modelLoadLines[0]?.severity).toBe('error');
    expect(modelLoadLines[0]?.opId).toBe(modelLoadEntries[0]?.opId);
  });
});

describe('useModelStore — setCuratedFiles (refOnly post-/api/parse)', () => {
  beforeEach(() => {
    useModelStore.setState({
      models: new Map([
        [
          'cdm',
          {
            source: CURATED_SOURCE,
            commitHash: '2026-05-13',
            files: [],
            loadedAt: 0
          }
        ]
      ]),
      loading: new Map(),
      errors: new Map()
    });
  });

  it("updates a loaded model's files", () => {
    const files = [
      {
        path: 'sample.rosetta',
        content: '',
        namespace: 'cdm.sample',
        refOnly: true,
        serializedModelJson: '{"a":1}' as never
      },
      {
        path: 'other.rosetta',
        content: '',
        namespace: 'cdm.other',
        refOnly: true,
        serializedModelJson: '{"b":2}' as never
      }
    ];
    useModelStore.getState().setCuratedFiles('cdm', files);
    expect(useModelStore.getState().models.get('cdm')?.files).toHaveLength(2);
    expect(useModelStore.getState().models.get('cdm')?.files[0]?.path).toBe('sample.rosetta');
  });

  it('no-ops when the source is not loaded', () => {
    const stateBefore = useModelStore.getState().models;
    useModelStore
      .getState()
      .setCuratedFiles('unknown-bundle', [{ path: 'x.rosetta', content: '', namespace: 'x', refOnly: true }]);
    expect(useModelStore.getState().models).toBe(stateBefore);
  });

  it('retains a pinned implicit Rune dependency returned by the router', () => {
    const files = [{ path: 'basictypes.rosetta', content: '', namespace: 'com.rosetta.model', refOnly: true }];
    useModelStore.getState().setCuratedFiles('rune-dsl', files, 'cohort-rune-1');
    expect(useModelStore.getState().models.get('rune-dsl')).toMatchObject({
      source: { id: 'rune-dsl' },
      commitHash: 'cohort-rune-1',
      files
    });
    const pinned = useModelStore.getState().models;
    useModelStore.getState().setCuratedFiles('rune-dsl', files, 'cohort-rune-1');
    expect(useModelStore.getState().models).toBe(pinned);
    useModelStore.getState().setCuratedFiles('unknown-bundle', files, 'cohort-unknown');
    expect(useModelStore.getState().models).toBe(pinned);
  });

  it('updates the resolved cohort even when file contents are unchanged', () => {
    const files = [{ path: 'sample.rosetta', content: '', namespace: 'cdm.sample', refOnly: true }];
    useModelStore.getState().setCuratedFiles('cdm', files, 'cohort-cdm-1');
    useModelStore.getState().setCuratedFiles('cdm', files, 'cohort-cdm-2');
    expect(useModelStore.getState().models.get('cdm')?.commitHash).toBe('cohort-cdm-2');
  });

  it('is idempotent when paths AND serializedModelJson identity match', () => {
    const json1 = '{"a":1}' as never;
    const files = [{ path: 'a.rosetta', content: '', namespace: 'a', refOnly: true, serializedModelJson: json1 }];
    useModelStore.getState().setCuratedFiles('cdm', files);
    const afterFirst = useModelStore.getState().models;
    // Same paths + same serializedModelJson identity → no re-publish.
    useModelStore
      .getState()
      .setCuratedFiles('cdm', [
        { path: 'a.rosetta', content: '', namespace: 'a', refOnly: true, serializedModelJson: json1 }
      ]);
    expect(useModelStore.getState().models).toBe(afterFirst);
  });

  it('re-publishes when serializedModelJson identity changes (bundle version bump)', () => {
    const json1 = '{"a":1}' as never;
    const json2 = '{"a":2}' as never;
    useModelStore
      .getState()
      .setCuratedFiles('cdm', [
        { path: 'a.rosetta', content: '', namespace: 'a', refOnly: true, serializedModelJson: json1 }
      ]);
    const afterFirst = useModelStore.getState().models;
    useModelStore
      .getState()
      .setCuratedFiles('cdm', [
        { path: 'a.rosetta', content: '', namespace: 'a', refOnly: true, serializedModelJson: json2 }
      ]);
    expect(useModelStore.getState().models).not.toBe(afterFirst);
    expect(useModelStore.getState().models.get('cdm')?.files[0]?.serializedModelJson).toBe(json2);
  });

  // Defect A safety net (prod-smoke 2026-05-20): a transient /api/parse
  // response (server hiccup, mid-flight reparse race) MUST NOT wipe a
  // bundle's already-loaded curated files with an empty list. The user
  // saw the 4768-type explorer collapse back to 22 base types in an
  // active session because some parse path called `setCuratedFiles('cdm', [])`
  // while CDM was demonstrably still loaded.
  it('refuses to wipe a non-empty bundle with an empty file list (Defect A)', () => {
    const json1 = '{"a":1}' as never;
    useModelStore.getState().setCuratedFiles('cdm', [
      { path: 'a.rosetta', content: '', namespace: 'a', refOnly: true, serializedModelJson: json1 },
      { path: 'b.rosetta', content: '', namespace: 'b', refOnly: true, serializedModelJson: json1 }
    ]);
    const populated = useModelStore.getState().models;
    expect(populated.get('cdm')?.files).toHaveLength(2);

    // Empty payload — must be silently dropped, leaving the bundle intact.
    useModelStore.getState().setCuratedFiles('cdm', []);
    expect(useModelStore.getState().models).toBe(populated);
    expect(useModelStore.getState().models.get('cdm')?.files).toHaveLength(2);
  });

  it('still allows an explicit transition from empty → non-empty (initial hydration)', () => {
    // The empty-list guard only applies when we're about to OVERWRITE
    // a non-empty list. Going from `files: []` → `files: [x, y]` (the
    // first hydration after archive-load) must still update so the
    // ModelLoader badge transitions from "(loading…)" to "(N files)".
    useModelStore.setState({
      models: new Map([
        [
          'cdm',
          {
            source: CURATED_SOURCE,
            commitHash: '2026-05-13',
            files: [],
            loadedAt: 0
          }
        ]
      ]),
      loading: new Map(),
      errors: new Map()
    });
    const json1 = '{"a":1}' as never;
    useModelStore
      .getState()
      .setCuratedFiles('cdm', [
        { path: 'a.rosetta', content: '', namespace: 'a', refOnly: true, serializedModelJson: json1 }
      ]);
    expect(useModelStore.getState().models.get('cdm')?.files).toHaveLength(1);
  });
});

describe('gatedByUserOptIn (Phase 5 — model-store telemetry gated on per-user Settings opt-in)', () => {
  beforeEach(() => {
    useTelemetrySettingsStore.setState({ enabled: false, hydrated: true });
  });

  it('does not forward emits when the user has not opted in', async () => {
    const inner = { emit: vi.fn(async () => {}) };
    const gated = gatedByUserOptIn(inner);
    await gated.emit({ event: 'curated_load_attempt', modelId: 'cdm' } as never);
    expect(inner.emit).not.toHaveBeenCalled();
  });

  it('forwards emits once the user has opted in', async () => {
    useTelemetrySettingsStore.setState({ enabled: true, hydrated: true });
    const inner = { emit: vi.fn(async () => {}) };
    const gated = gatedByUserOptIn(inner);
    await gated.emit({ event: 'curated_load_attempt', modelId: 'cdm' } as never);
    expect(inner.emit).toHaveBeenCalledWith({ event: 'curated_load_attempt', modelId: 'cdm' });
  });

  it('re-checks the live opt-in on every call rather than a snapshot at construction', async () => {
    const inner = { emit: vi.fn(async () => {}) };
    const gated = gatedByUserOptIn(inner);
    await gated.emit({ event: 'curated_load_attempt', modelId: 'cdm' } as never);
    expect(inner.emit).not.toHaveBeenCalled();

    useTelemetrySettingsStore.setState({ enabled: true, hydrated: true });
    await gated.emit({ event: 'curated_load_attempt', modelId: 'fpml' } as never);
    expect(inner.emit).toHaveBeenCalledWith({ event: 'curated_load_attempt', modelId: 'fpml' });
  });
});
