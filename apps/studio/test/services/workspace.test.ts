// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * Workspace service unit tests (T081, T101).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse } from '@rune-langium/core';
import {
  _resetParserWorkerForTests,
  parseFile,
  parseWorkspaceFiles,
  updateFileContent,
  createWorkspaceFile,
  createBlankWorkspaceFile,
  uniqueFilePath,
  readFileList,
  mergeModelFiles,
  mergeCuratedRefOnlyFiles,
  collectCuratedDocsFromWorkspace,
  collectCuratedSourcesForCodegen,
  BUNDLE_MARKER_SUFFIX
} from '../../src/services/workspace.js';
import type { WorkspaceFile } from '../../src/services/workspace.js';
import type { CachedFile, LoadedModel } from '../../src/types/model-types.js';

afterEach(() => {
  vi.unstubAllGlobals();
  _resetParserWorkerForTests();
});

// ---------------------------------------------------------------------------
// parseFile
// ---------------------------------------------------------------------------
describe('parseFile', () => {
  it('should parse a valid rosetta source', async () => {
    const source = `namespace demo

type Foo:
  bar string (1..1)
`;
    const result = await parseFile(source);
    expect(result.model).toBeTruthy();
    expect(result.errors).toHaveLength(0);
  });

  it('should return errors for invalid syntax', async () => {
    const source = 'this is not valid rosetta %%%';
    const result = await parseFile(source);
    // We expect at least some diagnostics for invalid syntax
    expect(result.errors.length).toBeGreaterThan(0);
    // Even on parse errors, the result object is always returned
    expect(result).toHaveProperty('model');
    expect(result).toHaveProperty('errors');
  });

  it('reports lexer-only errors from the main-thread fallback', async () => {
    vi.stubGlobal('Worker', undefined);
    const source = 'namespace demo\ntype Foo:\n  bar string (1..1)\n\u0000';
    const parsed = await parse(source);
    expect(parsed.parserErrors).toHaveLength(0);
    expect(parsed.lexerErrors.length).toBeGreaterThan(0);
    const result = await parseFile(source);
    expect(result.parseMode).toBe('main-thread-fallback');
    expect(result.errors).toEqual(parsed.lexerErrors.map((error) => error.message));
  });

  it('should handle empty content', async () => {
    const result = await parseFile('');
    expect(result).toHaveProperty('model');
    expect(result).toHaveProperty('errors');
  });
});

// ---------------------------------------------------------------------------
// parseWorkspaceFiles
// ---------------------------------------------------------------------------
describe('parseWorkspaceFiles', () => {
  it('associates a parsed model with the exact source captured before asynchronous parsing', async () => {
    const source =
      'namespace test.snapshot\nversion "test"\nfunc Original:\n  output:\n    result int (1..1)\n  set result: 1';
    const file = createWorkspaceFile('snapshot.rosetta', source);
    let rejectNetwork!: (error: Error) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise((_resolve, reject) => {
            rejectNetwork = reject;
          })
      )
    );
    const pending = parseWorkspaceFiles([file]);
    file.content =
      'namespace test.snapshot\nversion "test"\nfunc Newer:\n  output:\n    result int (1..1)\n  set result: 2';
    rejectNetwork(new Error('offline'));
    const result = await pending;
    expect(result.parsedModels[0]!.model.elements[0]!.name).toBe('Original');
    expect(result.parsedModels[0]!.source).toBe(source);
  });
  it('reports lexer-only workspace errors on main-thread fallback', async () => {
    vi.stubGlobal('Worker', undefined);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const file = createWorkspaceFile('lexer.rosetta', 'namespace lexer\ntype Foo:\n  bar string (1..1)\n\u0000');
    const parsed = await parse(file.content);
    expect(parsed.parserErrors).toHaveLength(0);
    const result = await parseWorkspaceFiles([file]);
    expect(result.parseMode).toBe('main-thread-fallback');
    expect(result.errors.get(file.path)).toEqual(parsed.lexerErrors.map((error) => error.message));
  });

  it('should parse multiple files', async () => {
    const files: WorkspaceFile[] = [
      {
        name: 'a.rosetta',
        path: 'a.rosetta',
        content: `namespace a

type A:
  x string (1..1)
`,
        dirty: false
      },
      {
        name: 'b.rosetta',
        path: 'b.rosetta',
        content: `namespace b

type B:
  y int (0..1)
`,
        dirty: false
      }
    ];

    const result = await parseWorkspaceFiles(files);
    expect(result.models.length).toBeGreaterThanOrEqual(0);
    expect(result.errors).toBeInstanceOf(Map);
  });

  it('resolves cross-file references when parsing a workspace', async () => {
    const files: WorkspaceFile[] = [
      {
        name: 'types.rosetta',
        path: 'types.rosetta',
        content: `namespace demo

type Person:
  name string (1..1)
`,
        dirty: false
      },
      {
        name: 'trade.rosetta',
        path: 'trade.rosetta',
        content: `namespace demo

type Trade:
  party Person (1..1)
`,
        dirty: false
      }
    ];

    const result = await parseWorkspaceFiles(files);
    const tradeModel = result.models.find((model) =>
      (model as { elements?: Array<{ name?: string }> }).elements?.some((el) => el.name === 'Trade')
    ) as
      | {
          elements?: Array<{
            name?: string;
            attributes?: Array<{ typeCall?: { type?: { ref?: { name?: string } } } }>;
          }>;
        }
      | undefined;

    const trade = tradeModel?.elements?.find((element) => element.name === 'Trade');
    const partyAttribute = trade?.attributes?.find(() => true);
    expect(partyAttribute?.typeCall?.type?.ref?.name).toBe('Person');
    expect(result.errors.size).toBe(0);
  });

  it('should handle empty file list', async () => {
    const result = await parseWorkspaceFiles([]);
    expect(result.models).toHaveLength(0);
    expect(result.errors.size).toBe(0);
  });

  it('surfaces when parsing falls back to the main thread (router fails)', async () => {
    // Stub fetch so /api/parse rejects — the router throws, and
    // parseWorkspaceFiles' outer catch routes to the main-thread fallback
    // with the full WorkspaceFile[].
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

    const result = await parseWorkspaceFiles([
      {
        name: 'fallback.rosetta',
        path: 'fallback.rosetta',
        content: `namespace demo

type Foo:
  bar string (1..1)
`,
        dirty: false
      }
    ]);

    expect(result.parseMode).toBe('main-thread-fallback');
    expect(result.fallbackMessage).toContain('fetch failed');
  });
});

// ---------------------------------------------------------------------------
// updateFileContent
// ---------------------------------------------------------------------------
describe('updateFileContent', () => {
  const files: WorkspaceFile[] = [
    { name: 'a.rosetta', path: 'a.rosetta', content: 'old', dirty: false },
    { name: 'b.rosetta', path: 'b.rosetta', content: 'old', dirty: false }
  ];

  it('should update the matching file and mark it dirty', () => {
    const updated = updateFileContent(files, 'a.rosetta', 'new content');
    const a = updated.find((f) => f.path === 'a.rosetta');
    expect(a!.content).toBe('new content');
    expect(a!.dirty).toBe(true);
  });

  it('should leave other files unchanged', () => {
    const updated = updateFileContent(files, 'a.rosetta', 'new');
    const b = updated.find((f) => f.path === 'b.rosetta');
    expect(b!.content).toBe('old');
    expect(b!.dirty).toBe(false);
  });

  it('should return unchanged array if path not found', () => {
    const updated = updateFileContent(files, 'missing.rosetta', 'new');
    expect(updated).toEqual(files);
  });
});

// ---------------------------------------------------------------------------
// createWorkspaceFile
// ---------------------------------------------------------------------------
describe('createWorkspaceFile', () => {
  it('should create a dirty file', () => {
    const file = createWorkspaceFile('test.rosetta', 'namespace test');
    expect(file.name).toBe('test.rosetta');
    expect(file.content).toBe('namespace test');
    expect(file.dirty).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// createBlankWorkspaceFile (enhance/012 — New start-page option)
// ---------------------------------------------------------------------------
describe('createBlankWorkspaceFile', () => {
  it('returns an untitled.rosetta file on an empty workspace', () => {
    const file = createBlankWorkspaceFile([]);
    expect(file.name).toBe('untitled.rosetta');
    expect(file.path).toBe('untitled.rosetta');
    expect(file.dirty).toBe(true);
    expect(file.readOnly).toBeFalsy();
  });

  it('includes a non-empty starter template with a namespace line', () => {
    const file = createBlankWorkspaceFile([]);
    expect(file.content.length).toBeGreaterThan(0);
    expect(file.content).toMatch(/^namespace\s+\w+/m);
  });

  it('uses untitled-2.rosetta when untitled.rosetta already exists', () => {
    const existing: WorkspaceFile[] = [
      { name: 'untitled.rosetta', path: 'untitled.rosetta', content: '', dirty: true }
    ];
    const file = createBlankWorkspaceFile(existing);
    expect(file.path).toBe('untitled-2.rosetta');
    expect(file.name).toBe('untitled-2.rosetta');
  });

  it('finds the next gap when untitled and untitled-2 both exist', () => {
    const existing: WorkspaceFile[] = [
      { name: 'untitled.rosetta', path: 'untitled.rosetta', content: '', dirty: true },
      { name: 'untitled-2.rosetta', path: 'untitled-2.rosetta', content: '', dirty: true }
    ];
    const file = createBlankWorkspaceFile(existing);
    expect(file.path).toBe('untitled-3.rosetta');
  });

  it('ignores read-only model files when computing uniqueness', () => {
    // A bundled model that happens to contain untitled.rosetta shouldn't block
    // the user's first New.
    const existing: WorkspaceFile[] = [
      {
        name: 'untitled.rosetta',
        path: '[model-id]/untitled.rosetta',
        content: '',
        dirty: false,
        readOnly: true
      }
    ];
    const file = createBlankWorkspaceFile(existing);
    expect(file.path).toBe('untitled.rosetta');
  });
});

// ---------------------------------------------------------------------------
// uniqueFilePath (final-review Finding 1 — import-dialog new-file collision)
// ---------------------------------------------------------------------------
describe('uniqueFilePath', () => {
  it('returns the candidate unchanged when no file has that path', () => {
    const existing: WorkspaceFile[] = [{ name: 'a.rosetta', path: 'a.rosetta', content: '', dirty: false }];
    expect(uniqueFilePath('demo.rosetta', existing)).toBe('demo.rosetta');
  });

  it('appends -2 when the candidate path already exists', () => {
    const existing: WorkspaceFile[] = [{ name: 'demo.rosetta', path: 'demo.rosetta', content: '', dirty: false }];
    expect(uniqueFilePath('demo.rosetta', existing)).toBe('demo-2.rosetta');
  });

  it('appends -3 when both the candidate and -2 already exist', () => {
    const existing: WorkspaceFile[] = [
      { name: 'demo.rosetta', path: 'demo.rosetta', content: '', dirty: false },
      { name: 'demo-2.rosetta', path: 'demo-2.rosetta', content: '', dirty: false }
    ];
    expect(uniqueFilePath('demo.rosetta', existing)).toBe('demo-3.rosetta');
  });
});

describe('mergeModelFiles', () => {
  it('preserves dehydrated parse results for read-only model files', () => {
    const model: LoadedModel = {
      source: {
        id: 'cdm',
        name: 'CDM',
        repoUrl: 'https://example.com/cdm.git',
        ref: 'main',
        paths: ['**/*.rosetta']
      },
      commitHash: '2026-04-25',
      loadedAt: 0,
      files: [
        {
          path: 'types/Trade.rosetta',
          content: 'namespace cdm',
          namespace: 'cdm',
          serializedModelJson: '{"$type":"RosettaModel","elements":[]}'
        }
      ]
    };

    const merged = mergeModelFiles([], model);
    expect(merged[0]).toMatchObject({
      path: '[cdm]/types/Trade.rosetta',
      readOnly: true,
      serializedModelJson: '{"$type":"RosettaModel","elements":[]}'
    });
  });
});

describe('mergeCuratedRefOnlyFiles', () => {
  // Regression: App.tsx's on-demand curated namespace hydration effect
  // previously updated only `models`/`parsedModels`/`deferredExports` (via
  // applyParseResult) — never `files` — so a reference that only became
  // resolvable via ON-DEMAND hydration (not present at initial workspace
  // load) stayed permanently unresolved in Form Preview, identically on
  // every retry. `CodegenProvider`'s preview-worker file-sync effect is
  // keyed on `files`, not `models`. Live-repro'd 2026-08-01 via
  // cdm.base.staticdata.party.Party → BusinessUnit → Identifier: the
  // hydration toast for cdm.base.staticdata.identifier completed, but
  // `unresolved-reference:Identifier` repeated identically across all 5
  // retries.

  const cdmSource = {
    id: 'cdm',
    name: 'CDM',
    repoUrl: 'https://example.com/cdm.git',
    ref: 'main',
    paths: ['**/*.rosetta']
  };

  it('merges a hydrated bundle namespace into `files` with its real serializedModelJson, given the bundle is already a loaded model', () => {
    const currentFiles: WorkspaceFile[] = [
      { name: 'a.rosetta', path: 'a.rosetta', content: 'namespace demo', dirty: false }
    ];
    const loadedModels = new Map<string, LoadedModel>([
      ['cdm', { source: cdmSource, commitHash: '2026-04-25', loadedAt: 0, files: [] }]
    ]);
    const identifierFile: CachedFile = {
      path: 'base-staticdata-identifier-type.rosetta',
      content: '',
      namespace: 'cdm.base.staticdata.identifier',
      serializedModelJson: '{"$type":"RosettaModel","elements":["Identifier"]}'
    };

    const merged = mergeCuratedRefOnlyFiles(currentFiles, { cdm: [identifierFile] }, loadedModels);

    expect(merged).not.toBe(currentFiles);
    expect(merged.find((f) => f.name === 'a.rosetta')).toBeDefined();
    const mergedIdentifier = merged.find((f) => f.path === '[cdm]/base-staticdata-identifier-type.rosetta');
    expect(mergedIdentifier).toMatchObject({
      readOnly: true,
      bundleId: 'cdm',
      serializedModelJson: '{"$type":"RosettaModel","elements":["Identifier"]}'
    });
  });

  it('replaces a PRIOR set of files for the same bundle with the new cumulative closure, not appending duplicates', () => {
    const staleEntry: WorkspaceFile = {
      name: 'old.rosetta',
      path: '[cdm]/old.rosetta',
      content: '',
      dirty: false,
      readOnly: true,
      bundleId: 'cdm',
      serializedModelJson: '{"stale":true}'
    };
    const loadedModels = new Map<string, LoadedModel>([
      ['cdm', { source: cdmSource, commitHash: '2026-04-25', loadedAt: 0, files: [] }]
    ]);
    const freshEntries: CachedFile[] = [
      { path: 'a.rosetta', content: '', namespace: 'cdm.a', serializedModelJson: '{"fresh":"a"}' },
      { path: 'b.rosetta', content: '', namespace: 'cdm.b', serializedModelJson: '{"fresh":"b"}' }
    ];

    const merged = mergeCuratedRefOnlyFiles([staleEntry], { cdm: freshEntries }, loadedModels);

    expect(merged.find((f) => f.path === '[cdm]/old.rosetta')).toBeUndefined();
    expect(merged.map((f) => f.path).sort()).toEqual(['[cdm]/a.rosetta', '[cdm]/b.rosetta']);
  });

  it('returns the SAME array reference (no-op) when no bundle id in curatedRefOnlyFiles matches a loaded model', () => {
    const currentFiles: WorkspaceFile[] = [{ name: 'a.rosetta', path: 'a.rosetta', content: '', dirty: false }];
    const loadedModels = new Map<string, LoadedModel>();
    const entries: CachedFile[] = [{ path: 'x.rosetta', content: '', namespace: 'cdm.x' }];

    const merged = mergeCuratedRefOnlyFiles(currentFiles, { cdm: entries }, loadedModels);

    expect(merged).toBe(currentFiles);
  });

  it('merges each bundle independently when curatedRefOnlyFiles spans multiple bundles', () => {
    const loadedModels = new Map<string, LoadedModel>([
      ['cdm', { source: cdmSource, commitHash: '2026-04-25', loadedAt: 0, files: [] }],
      ['fpml', { source: { ...cdmSource, id: 'fpml', name: 'FpML' }, commitHash: 'v1', loadedAt: 0, files: [] }]
    ]);
    const merged = mergeCuratedRefOnlyFiles(
      [],
      {
        cdm: [{ path: 'a.rosetta', content: '', namespace: 'cdm.a' }],
        fpml: [{ path: 'b.rosetta', content: '', namespace: 'fpml.b' }]
      },
      loadedModels
    );

    expect(merged.map((f) => f.path).sort()).toEqual(['[cdm]/a.rosetta', '[fpml]/b.rosetta']);
  });
});

// ---------------------------------------------------------------------------
// collectCuratedDocsFromWorkspace (C-1 fix — bundle marker exclusion)
// ---------------------------------------------------------------------------
describe('collectCuratedDocsFromWorkspace', () => {
  it('includes a curated file with serializedModelJson as { uri, serializedModel }', () => {
    const files: WorkspaceFile[] = [
      {
        name: 'Trade.rosetta',
        path: '[cdm]/types/Trade.rosetta',
        content: '',
        dirty: false,
        readOnly: true,
        serializedModelJson: '{"$type":"RosettaModel","elements":[]}',
        bundleId: 'cdm',
        bundleVersion: '2026-04-25'
      }
    ];
    const docs = collectCuratedDocsFromWorkspace(files);
    expect(docs).toHaveLength(1);
    expect(docs[0]).toEqual({
      uri: '[cdm]/types/Trade.rosetta',
      serializedModel: '{"$type":"RosettaModel","elements":[]}'
    });
  });

  it('excludes the synthetic bundle marker even though it has serializedModelJson', () => {
    const files: WorkspaceFile[] = [
      {
        name: '.bundle-marker',
        path: `[cdm]${BUNDLE_MARKER_SUFFIX}`,
        content: '',
        dirty: false,
        readOnly: true,
        serializedModelJson: '{}',
        bundleId: 'cdm',
        bundleVersion: '2026-04-25'
      }
    ];
    const docs = collectCuratedDocsFromWorkspace(files);
    expect(docs).toHaveLength(0);
  });

  it('excludes a user file with no serializedModelJson', () => {
    const files: WorkspaceFile[] = [
      {
        name: 'my.rosetta',
        path: 'my.rosetta',
        content: 'namespace my',
        dirty: false
      }
    ];
    const docs = collectCuratedDocsFromWorkspace(files);
    expect(docs).toHaveLength(0);
  });

  it('returns only real curated docs when mixed with a marker and a user file', () => {
    const files: WorkspaceFile[] = [
      {
        name: 'Trade.rosetta',
        path: '[cdm]/types/Trade.rosetta',
        content: '',
        dirty: false,
        readOnly: true,
        serializedModelJson: '{"$type":"RosettaModel","elements":[]}',
        bundleId: 'cdm',
        bundleVersion: '2026-04-25'
      },
      {
        name: '.bundle-marker',
        path: `[fpml]${BUNDLE_MARKER_SUFFIX}`,
        content: '',
        dirty: false,
        readOnly: true,
        serializedModelJson: '{}',
        bundleId: 'fpml',
        bundleVersion: '2026-04-01'
      },
      {
        name: 'user.rosetta',
        path: 'user.rosetta',
        content: 'namespace user',
        dirty: false
      }
    ];
    const docs = collectCuratedDocsFromWorkspace(files);
    expect(docs).toHaveLength(1);
    expect(docs[0]!.uri).toBe('[cdm]/types/Trade.rosetta');
  });
});

// ---------------------------------------------------------------------------
// collectCuratedSourcesForCodegen (issue #401 fix — don't send a redundant,
// unboundedly large curatedDocs payload when curatedBundles already gives
// the server everything Path C needs)
// ---------------------------------------------------------------------------
describe('collectCuratedSourcesForCodegen', () => {
  it('omits curatedDocs when curatedBundles is non-empty, even if serialized docs are loaded', () => {
    const files: WorkspaceFile[] = [
      {
        name: 'Trade.rosetta',
        path: '[cdm]/types/Trade.rosetta',
        content: '',
        dirty: false,
        readOnly: true,
        serializedModelJson: '{"$type":"RosettaModel","elements":[]}',
        bundleId: 'cdm',
        bundleVersion: '2026-04-25'
      }
    ];
    const { curatedBundles, curatedDocs } = collectCuratedSourcesForCodegen(files);
    expect(curatedBundles).toEqual([{ id: 'cdm', version: '2026-04-25' }]);
    expect(curatedDocs).toEqual([]);
  });

  it('falls back to curatedDocs when no bundle info is present at all', () => {
    const files: WorkspaceFile[] = [
      {
        name: 'Trade.rosetta',
        path: '[cdm]/types/Trade.rosetta',
        content: '',
        dirty: false,
        readOnly: true,
        serializedModelJson: '{"$type":"RosettaModel","elements":[]}'
        // no bundleId/bundleVersion
      }
    ];
    const { curatedBundles, curatedDocs } = collectCuratedSourcesForCodegen(files);
    expect(curatedBundles).toEqual([]);
    expect(curatedDocs).toHaveLength(1);
    expect(curatedDocs[0]).toEqual({
      uri: '[cdm]/types/Trade.rosetta',
      serializedModel: '{"$type":"RosettaModel","elements":[]}'
    });
  });

  it('returns empty arrays for a workspace with only user files', () => {
    const files: WorkspaceFile[] = [{ name: 'my.rosetta', path: 'my.rosetta', content: 'namespace my', dirty: false }];
    const { curatedBundles, curatedDocs } = collectCuratedSourcesForCodegen(files);
    expect(curatedBundles).toEqual([]);
    expect(curatedDocs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// readFileList
// ---------------------------------------------------------------------------
describe('readFileList', () => {
  it('should filter only .rosetta files', async () => {
    // Create mock files with text() method (jsdom File may not have it)
    const rosettaFile = {
      name: 'model.rosetta',
      webkitRelativePath: '',
      text: async () => 'namespace demo'
    } as unknown as File;

    const txtFile = {
      name: 'readme.txt',
      webkitRelativePath: '',
      text: async () => 'not rosetta'
    } as unknown as File;

    // Create a FileList-like object
    const fileList = {
      length: 2,
      item: (i: number) => [rosettaFile, txtFile][i] ?? null,
      0: rosettaFile,
      1: txtFile
    } as unknown as FileList;

    const result = await readFileList(fileList);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('model.rosetta');
    expect(result[0]!.content).toBe('namespace demo');
    expect(result[0]!.dirty).toBe(false);
  });

  it('should handle an empty FileList', async () => {
    const fileList = {
      length: 0,
      item: () => null
    } as unknown as FileList;

    const result = await readFileList(fileList);
    expect(result).toHaveLength(0);
  });
});
