// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { expect, it } from 'vitest';
import type { DockviewApi } from 'dockview-react';
import { automaticPreviewWidths, expandedPreviewSnapshot } from '../../src/shell/responsive-layout.js';

type Snapshot = ReturnType<DockviewApi['toJSON']>;
// Captured native Dockview structure, including a later manually widened explorer.
function snapshot(): Snapshot {
  return JSON.parse(
    JSON.stringify({
      grid: {
        width: 1200,
        height: 720,
        orientation: 'HORIZONTAL',
        root: {
          type: 'branch',
          size: 720,
          data: [
            { type: 'leaf', size: 980, data: { id: 'types', views: ['types'] } },
            { type: 'leaf', size: 168, data: { id: 'model', views: ['model'] } },
            { type: 'leaf', size: 52, data: { id: 'preview', views: ['form', 'code'], activeView: 'code' } }
          ]
        }
      },
      panels: {},
      activeGroup: 'model'
    })
  );
}

it('retains expanded intent without changing any unrelated live widths or starving the main task', () => {
  const value = snapshot();
  const original = JSON.stringify(value);
  const result = expandedPreviewSnapshot(value, new Map([['preview', 320]]));
  expect(result.grid).toBe(value.grid);
  expect(result.panels).toBe(value.panels);
  expect(JSON.stringify(value)).toBe(original);
  expect(automaticPreviewWidths(result).get('preview')).toBe(320);
});

it('retains utility height and nested/edge topology without interpreting the native tree', () => {
  const value = snapshot();
  value.grid.orientation = 'VERTICAL' as Snapshot['grid']['orientation'];
  const body = value.grid.root;
  body.size = 600;
  value.grid.root = {
    type: 'branch',
    size: 1200,
    data: [body, { type: 'leaf', size: 120, data: { id: 'utilities', views: [] } }]
  };
  Object.assign(value, { edgeGroups: { right: { size: 320, visible: false, group: { id: 'edge', views: [] } } } });
  const result = expandedPreviewSnapshot(value, new Map([['preview', 320]]));
  expect(result.grid).toBe(value.grid);
  expect(result.edgeGroups).toBe(value.edgeGroups);
  expect(automaticPreviewWidths(result).get('preview')).toBe(320);
});

it('removes automatic intent after an explicit show/hide choice', () => {
  const value = expandedPreviewSnapshot(snapshot(), new Map([['preview', 320]]));
  const manual = expandedPreviewSnapshot(value, new Map());
  expect(automaticPreviewWidths(manual).size).toBe(0);
  expect(manual.grid).toBe(value.grid);
});

it('ignores corrupt preference metadata instead of changing native restore behavior', () => {
  for (const value of [
    null,
    {},
    { studioAutomaticPreviewWidths: [] },
    { studioAutomaticPreviewWidths: { a: NaN, b: Infinity, c: 52, d: '320' } }
  ])
    expect(automaticPreviewWidths(value).size).toBe(0);
});
