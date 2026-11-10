// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { it, expect, vi } from 'vitest';
import { parseWorkspace } from '../../src/api/parse.js';
import { getAnnotationDefinitions } from '../../src/api/annotation-definitions.js';
import { createRuneDslServices } from '../../src/services/rune-dsl-module.js';
import { URI } from 'langium';

it('leaves references untouched while a new source is still unlinked', () => {
  const { RuneDsl } = createRuneDslServices();
  const document = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
    'namespace example\ntype Owner:\n  name string (1..1) [metadata scheme]\n',
    URI.parse('memory:///unlinked.rosetta')
  );
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  try {
    expect(getAnnotationDefinitions(document.parseResult.value)).toEqual({});
    expect(warn).not.toHaveBeenCalled();
  } finally {
    warn.mockRestore();
  }
});

it('uses the actual imported annotation target when another namespace defines the same name', async () => {
  const entries = [
    {
      uri: 'memory:///scope-owner.rosetta',
      content:
        'namespace scope.owner\nimport scope.selected.*\ntype Owner:\n  name string (1..1) [marking scheme "scheme"="ISIN"]\n'
    },
    {
      uri: 'memory:///scope-selected.rosetta',
      content: 'namespace scope.selected\nannotation marking:\n  scheme string (1..1)\n'
    },
    {
      uri: 'memory:///scope-other.rosetta',
      content: 'namespace scope.other\nannotation marking:\n  foreignScheme string (1..1)\n'
    }
  ];
  const parsed = await parseWorkspace(entries);
  expect(parsed.every((result) => !result.hasErrors)).toBe(true);
  const owner = parsed[0]!.value.elements.find((node) => node.$type === 'Data');
  if (!owner) throw new Error('Missing owner');
  expect(getAnnotationDefinitions(owner)).toEqual({ marking: { name: 'marking', namespace: 'scope.selected' } });
});
