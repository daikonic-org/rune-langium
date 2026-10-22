// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { useState } from 'react';
import { jsonCodec } from '@rune-langium/codegen/instances';
import { Button } from '@rune-langium/design-system/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@rune-langium/design-system/ui/popover';
import { WorkspaceTypePicker } from './WorkspaceTypePicker.js';
import { Textarea } from '@rune-langium/design-system/ui/textarea';
import { withInstrumentation } from '../services/instrumentation/core.js';

export const WorkflowImport = withInstrumentation(
  function WorkflowImport({
    typeFqn,
    multiple = false,
    onImport,
    label = 'Import input…'
  }: {
    typeFqn?: string;
    multiple?: boolean;
    label?: string;
    onImport(values: unknown[], typeFqn?: string): void;
  }) {
    const [chosenType, setChosenType] = useState<string | null>(null);
    const effectiveType = typeFqn ?? chosenType ?? undefined;
    const [open, setOpen] = useState(false),
      [text, setText] = useState(''),
      [error, setError] = useState('');
    const importData = () => {
      const result = jsonCodec.import(text, effectiveType ?? '');
      if (result.diagnostics.length || result.data === undefined) {
        setError(result.diagnostics.map((d) => d.message).join(' ') || 'Enter JSON data.');
        return;
      }
      const values = multiple && Array.isArray(result.data) ? result.data : [result.data];
      if (
        !values.length ||
        (multiple && values.some((value) => !value || typeof value !== 'object' || Array.isArray(value)))
      ) {
        setError('Import an object or a non-empty array of objects.');
        return;
      }
      if (multiple && !effectiveType) {
        setError('Choose the imported object type.');
        return;
      }
      try {
        onImport(values, effectiveType);
        setError('');
        setOpen(false);
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure));
      }
    };
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger render={<Button variant="ghost" size="xs" />}>{label}</PopoverTrigger>
        <PopoverContent className="w-96 max-w-[calc(100vw-1.5rem)] space-y-3" align="end">
          <h3 className="font-semibold">{multiple ? 'Import objects' : 'Import input'}</h3>
          <p className="text-xs text-muted-foreground">
            {multiple
              ? 'Objects are added to the grid. The active workflow stays unchanged.'
              : 'Populate this input. Execute again to generate a result.'}
          </p>
          {multiple && !typeFqn ? (
            <WorkspaceTypePicker
              label="Imported object type"
              value={chosenType}
              onSelect={setChosenType}
              filterKinds={['data', 'choice']}
            />
          ) : null}
          <Textarea
            aria-label="Import JSON data"
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="min-h-40 font-mono text-xs"
          />
          <label className="block text-xs">
            Choose JSON file
            <input
              type="file"
              accept=".json,application/json"
              className="mt-1 block max-w-full"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file)
                  try {
                    setText(await file.text());
                  } catch {
                    setError('Could not read this file.');
                  }
              }}
            />
          </label>
          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={importData} disabled={!text.trim()}>
              Import
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    );
  },
  {
    op: 'WorkflowImport',
    sanitize: () => '[workflow]',
    sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' })
  }
);
