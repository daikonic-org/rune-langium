// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * Layout factory — produces the default `PanelLayoutRecord` for a fresh
 * workspace and for the "Reset layout" command.
 *
 * Two shapes flow through `PanelLayoutRecord.dockview`:
 *
 *   - **factory** (`{ shape: 'factory', columns, bottomGroup }`) — what
 *     this module emits and what the layout-migrations sanitiser
 *     produces. Tightly typed, fixed-arity columns.
 *   - **native**  (`{ shape: 'native',  json }`) — a round-tripped
 *     `api.toJSON()` snapshot. Opaque to us; we only feed it back into
 *     `api.fromJSON()`.
 *
 * The discriminator (`shape`) makes the bridge's translation explicit
 * instead of structural-guessing.
 */

import type { PanelLayoutRecord } from '../workspace/persistence.js';
import type { ExplorerColumn, FactoryShape, LayoutColumn, LayoutPreset, PanelComponentName } from './layout-types.js';
import { withInstrumentation, Capture } from '../services/instrumentation/core.js';

export {
  type LayoutPreset,
  PANEL_COMPONENT_NAMES,
  type BottomGroup,
  type CenterGroup,
  type CenterStackTabName,
  type DockviewPayload,
  type EditorGroup,
  type ExplorerColumn,
  type FactoryShape,
  type LayoutColumn,
  type LayoutNode,
  type NativeShape,
  type PanelComponentName
} from './layout-types.js';

/**
 * User-facing tab titles for each locked panel component. Surfaced on
 * dockview's tab strip via `addPanel({ title })` (FR-008). Internal
 * `workspace.*` IDs must never leak into the rendered chrome.
 */
export const PANEL_TITLES: Record<PanelComponentName, string> = {
  'workspace.fileTree': 'Type explorer',
  'workspace.editor': 'Source',
  'workspace.inspector': 'Inspector',
  'workspace.problems': 'Problems',
  'workspace.activity': 'Activity',
  'workspace.output': 'Output',
  'workspace.visualPreview': 'Graph',
  'workspace.formPreview': 'Form',
  'workspace.codePreview': 'Code'
};

export const LAYOUT_SCHEMA_VERSION = 7;

const _SMALL_VIEWPORT_BREAKPOINT_PX = 1280;

export interface BuildLayoutInput {
  studioVersion: string;
  viewportWidth: number;
  preset?: LayoutPreset;
}

export const buildDefaultLayout = withInstrumentation(
  function buildDefaultLayout(input: BuildLayoutInput): PanelLayoutRecord {
    const preset = input.preset ?? 'edit';

    const previewActive = preset === 'preview' ? 'workspace.codePreview' : 'workspace.formPreview';

    const explorerColumn: ExplorerColumn = { component: 'workspace.fileTree', size: 200 };

    const dockview: FactoryShape = {
      shape: 'factory',
      preset,
      columns: [
        explorerColumn,
        {
          active: 'workspace.visualPreview',
          weight: 3,
          tabs: [{ component: 'workspace.visualPreview' }]
        },
        {
          active: previewActive,
          size: 280,
          tabs: [{ component: 'workspace.formPreview' }, { component: 'workspace.codePreview' }]
        }
      ],
      bottomGroup: {
        active: 'workspace.problems',
        collapsed: true,
        tabs: [
          { component: 'workspace.problems' },
          { component: 'workspace.activity' },
          { component: 'workspace.output' }
        ]
      }
    };

    return {
      version: LAYOUT_SCHEMA_VERSION,
      writtenBy: input.studioVersion,
      dockview
    };
    // UI panel layout only — every field is a fixed PanelComponentName /
    // config value, never user or model content. Safe to capture in full.
  },
  { op: 'buildDefaultLayout', capture: Capture.Input | Capture.Output, sanitize: (value) => value }
);

export const getLayoutColumnComponents = withInstrumentation(
  function getLayoutColumnComponents(column: LayoutColumn): PanelComponentName[] {
    if ('tabs' in column) return column.tabs.map((tab) => tab.component);
    return [column.component];
  },
  { op: 'getLayoutColumnComponents', capture: Capture.Input | Capture.Output, sanitize: (value) => value }
);
