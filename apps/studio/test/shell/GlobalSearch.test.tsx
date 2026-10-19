// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { GlobalSearch } from '../../src/shell/GlobalSearch.js';
import { BUNDLE_MARKER_SUFFIX, type WorkspaceFile } from '../../src/services/workspace.js';
import { WorkspaceStateContext, type WorkspaceState } from '../../src/shell/providers/workspace-context.js';

afterEach(cleanup);

it.each([{ metaKey: true }, { ctrlKey: true }])('opens search with its unmodified primary shortcut: %j', (modifier) => {
  render(<GlobalSearch hasWorkspace={false} hasExploreContent={false} />);
  act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ...modifier, cancelable: true })));
  expect(screen.getByRole('dialog', { name: 'Search Studio' })).toBeInTheDocument();
});

it('leaves handled editor commands and extended shortcuts alone', () => {
  render(<GlobalSearch hasWorkspace={false} hasExploreContent={false} />);
  const handled = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true });
  handled.preventDefault();
  act(() => {
    window.dispatchEvent(handled);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, shiftKey: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, shiftKey: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, metaKey: true }));
  });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('searches user files without exposing curated or synthetic workspace entries', () => {
  const files: WorkspaceFile[] = [
    { name: 'user.rosetta', path: 'user.rosetta', content: '', dirty: false },
    { name: 'curated.rosetta', path: '[cdm]/curated.rosetta', content: '', dirty: false, readOnly: true },
    { name: 'reference.rosetta', path: '[cdm]/reference.rosetta', content: '', dirty: false, refOnly: true },
    { name: '.bundle-marker', path: `[cdm]${BUNDLE_MARKER_SUFFIX}`, content: '', dirty: false }
  ];
  const workspace: WorkspaceState = {
    fileCount: 1,
    files,
    models: [],
    parsedModels: [],
    deferredExports: [],
    parseErrors: new Map()
  };
  render(
    <WorkspaceStateContext.Provider value={workspace}>
      <GlobalSearch hasWorkspace hasExploreContent={false} />
    </WorkspaceStateContext.Provider>
  );

  fireEvent.click(screen.getByRole('button', { name: /^Search types, files, commands/ }));
  expect(screen.getByText('user.rosetta')).toBeInTheDocument();
  expect(screen.queryByText('curated.rosetta')).not.toBeInTheDocument();
  expect(screen.queryByText('reference.rosetta')).not.toBeInTheDocument();
  expect(screen.queryByText('.bundle-marker')).not.toBeInTheDocument();
});
