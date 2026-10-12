// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * explore-file-nav-store tests. Narrow store for Explore's file-navigation
 * surface (shared-perspective-chrome plan, Task 3 prep): activeEditorFile +
 * syncStatus, and the openFileInSource primitive, so both ExplorePerspective's
 * body and the new ExploreCenterSlot (FileTabStrip) can read/write the same
 * state instead of a local useState the slot component couldn't reach.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { WorkspaceFile } from '../../src/services/workspace.js';
import {
  resolveEditorFilePath,
  resolveHydratedSourcePath,
  useExploreFileNavStore
} from '../../src/shell/explore-file-nav-store.js';

describe('explore file nav store', () => {
  beforeEach(() => {
    useExploreFileNavStore.setState({ activeEditorFile: undefined, syncStatus: null });
  });

  it('starts with no active file and no sync status', () => {
    const state = useExploreFileNavStore.getState();
    expect(state.activeEditorFile).toBeUndefined();
    expect(state.syncStatus).toBeNull();
  });

  it('openFileInSource sets the active file — mirrors the old setActiveEditorFile(filePath) behavior', () => {
    useExploreFileNavStore.getState().openFileInSource('a.rosetta');
    expect(useExploreFileNavStore.getState().activeEditorFile).toBe('a.rosetta');
  });

  it('setActiveEditorFile is exposed directly (FileTabStrip / SourceEditor onFileSelect call it without going through openFileInSource)', () => {
    useExploreFileNavStore.getState().setActiveEditorFile('b.rosetta');
    expect(useExploreFileNavStore.getState().activeEditorFile).toBe('b.rosetta');
  });

  it('setActiveEditorFile accepts undefined (files-emptied reset uses this)', () => {
    useExploreFileNavStore.getState().setActiveEditorFile('a.rosetta');
    useExploreFileNavStore.getState().setActiveEditorFile(undefined);
    expect(useExploreFileNavStore.getState().activeEditorFile).toBeUndefined();
  });

  it('setSyncStatus updates syncStatus', () => {
    useExploreFileNavStore.getState().setSyncStatus({ state: 'synced' } as never);
    expect(useExploreFileNavStore.getState().syncStatus).toEqual({ state: 'synced' });
  });

  it('a file opened through openFileInSource is what a subsequent unrelated read of activeEditorFile sees (single source, no duplication)', () => {
    // Simulates the tab strip calling openFileInSource and the body's
    // SourceEditor separately reading activeEditorFile — both must observe
    // the same store-backed value rather than divergent local state.
    useExploreFileNavStore.getState().openFileInSource('c.rosetta');
    const bodyRead = useExploreFileNavStore.getState().activeEditorFile;
    expect(bodyRead).toBe('c.rosetta');
  });
});

describe('parser to source-editor file navigation', () => {
  const curated: WorkspaceFile = {
    name: 'types.rosetta',
    path: '[cdm]/models/types.rosetta',
    content: 'namespace cdm.example\n',
    dirty: false,
    readOnly: true,
    refOnly: true,
    bundleId: 'cdm'
  };

  it('opens the exact hydrated curated file with its editor identity', () => {
    const sameBasename = { ...curated, path: '[fpml]/models/types.rosetta', bundleId: 'fpml' };
    expect(resolveEditorFilePath('cdm/models/types.rosetta', [sameBasename, curated])).toBe(curated.path);
  });

  it('waits for source to arrive for the same selected parser identity', () => {
    expect(resolveEditorFilePath('cdm/models/types.rosetta', [{ ...curated, content: '', sourceLoaded: false }])).toBe(
      curated.path
    );
    expect(resolveEditorFilePath('cdm/models/types.rosetta', [curated])).toBe(curated.path);
  });

  it('preserves user file identities including empty files and bundle-like paths', () => {
    const user = { name: 'types.rosetta', path: 'cdm/models/types.rosetta', content: '', dirty: false };
    expect(resolveEditorFilePath(user.path, [curated, user])).toBe(user.path);
    expect(resolveEditorFilePath('missing/types.rosetta', [curated, user])).toBeUndefined();
  });
});

describe('hydrated curated source ownership', () => {
  const enumFile: WorkspaceFile = {
    name: 'enums.rosetta',
    path: '[cdm]/enums.rosetta',
    content: '',
    dirty: false,
    refOnly: true,
    readOnly: true,
    bundleId: 'cdm',
    bundleVersion: 'latest',
    namespace: 'cdm.example',
    artifactKey: 'cdm/digest/example'
  };
  const typeFile = { ...enumFile, name: 'types.rosetta', path: '[cdm]/types.rosetta' };
  const request = {
    bundleId: 'cdm',
    bundleVersion: 'latest',
    namespace: 'cdm.example',
    path: enumFile.path,
    nodeId: 'cdm.example.Example'
  };

  it.each([
    [enumFile, typeFile],
    [typeFile, enumFile]
  ])('selects the declaration document regardless of namespace file order', (...files) => {
    expect(resolveHydratedSourcePath(request, files, ['cdm.example'], 'cdm/types.rosetta')).toBe(typeFile.path);
  });
  it('waits for authoritative ownership instead of opening the catalogue document', () => {
    expect(resolveHydratedSourcePath(request, [enumFile, typeFile], ['cdm.example'])).toBeUndefined();
  });
  it('retains an explicit file request', () => {
    expect(
      resolveHydratedSourcePath(
        { ...request, nodeId: undefined, path: typeFile.path },
        [enumFile, typeFile],
        ['cdm.example']
      )
    ).toBe(typeFile.path);
  });
  it('does not use a same-name file from another bundle', () => {
    const other = { ...typeFile, bundleId: 'fpml', path: '[fpml]/types.rosetta' };
    expect(resolveHydratedSourcePath(request, [other], ['cdm.example'], 'cdm/types.rosetta')).toBeUndefined();
  });
  it('rejects replaced versions and immutable artifact identities', () => {
    expect(
      resolveHydratedSourcePath(request, [{ ...typeFile, bundleVersion: 'next' }], ['cdm.example'], typeFile.path)
    ).toBeUndefined();
    expect(
      resolveHydratedSourcePath({ ...request, artifactKey: 'old' }, [typeFile], ['cdm.example'], typeFile.path)
    ).toBeUndefined();
  });
  it('supports legacy source only after its namespace is hydrated', () => {
    const legacy = { ...typeFile, artifactKey: undefined };
    expect(resolveHydratedSourcePath(request, [legacy], [], typeFile.path)).toBeUndefined();
    expect(resolveHydratedSourcePath(request, [legacy], ['cdm.example'], typeFile.path)).toBe(typeFile.path);
  });
});
