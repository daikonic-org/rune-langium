// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { getTargetLayouts, type Target } from '@rune-langium/codegen/export';
import type { ComponentType } from 'react';
import { SqlOptionsForm } from './SqlOptionsForm.js';
import { ExcelOptionsFormAdapter } from '../codegen-forms/ExcelOptionsFormAdapter.js';

export interface LayoutChoice {
  value: string;
  label: string;
  hint?: string;
}

export interface TargetPanelConfig {
  layouts: LayoutChoice[];
  defaultLayout?: string;
}

const PER_NAMESPACE: LayoutChoice = {
  value: 'per-namespace',
  label: 'Per-namespace',
  hint: 'One file per namespace'
};
const BARREL: LayoutChoice = { value: 'barrel', label: 'Barrel', hint: 'Barrel + per-namespace files' };
const SINGLE_FILE: LayoutChoice = { value: 'single-file', label: 'Single file', hint: 'All types in one file' };

const LAYOUT_LABELS: Record<string, LayoutChoice> = {
  'per-namespace': PER_NAMESPACE,
  barrel: BARREL,
  'single-file': SINGLE_FILE
};

function panel(target: Target, defaultLayout: string): TargetPanelConfig {
  return {
    layouts: getTargetLayouts(target).map((value) => LAYOUT_LABELS[value] ?? { value, label: value }),
    defaultLayout
  };
}

/** Studio presentation metadata shared by modal and workbench settings. */
export const TARGET_PANELS: Partial<Record<Target, TargetPanelConfig>> = {
  zod: panel('zod', 'barrel'),
  typescript: panel('typescript', 'barrel'),
  'json-schema': panel('json-schema', 'single-file'),
  sql: panel('sql', 'per-namespace')
};

/** Controlled option forms shared by legacy downloads and the Export workbench. */
export const TARGET_OPTION_FORMS: Partial<
  Record<Target, ComponentType<{ value: Record<string, unknown>; onChange(value: Record<string, unknown>): void }>>
> = {
  sql: SqlOptionsForm,
  excel: ExcelOptionsFormAdapter
};
