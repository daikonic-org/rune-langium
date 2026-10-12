// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from '@rune-langium/core';
import { createEditorStore } from '../../src/store/editor-store.js';

export async function loadInspectorFixture(
  source = readFileSync(resolve(import.meta.dirname, '../fixtures/forms-baseline.rosetta'), 'utf8')
) {
  const parsed = await parse(source);
  if (parsed.hasErrors) throw new Error('Inspector fixture must parse');
  const store = createEditorStore();
  store.getState().loadModels(parsed.value);
  const getNode = (name: string) => {
    const node = store.getState().nodes.find((candidate) => candidate.data.name === name);
    if (!node) throw new Error(`Fixture declaration missing: ${name}`);
    return node;
  };
  return { store, source, getNode };
}
