// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { useEffect, useRef, useState } from 'react';
import { jsonCodec, runeJsonCodec } from '@rune-langium/codegen/instances';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@rune-langium/design-system/ui/select';
import { Upload } from 'lucide-react';
import { Button } from '@rune-langium/design-system/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@rune-langium/design-system/ui/popover';
import { WorkspaceTypePicker } from './WorkspaceTypePicker.js';
import { Textarea } from '@rune-langium/design-system/ui/textarea';
import { usePreviewSession } from '../shell/providers/preview-session-context.js';
import { useInstanceStore } from '../store/instance-store.js';
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
    onImport(values: unknown[], typeFqn?: string, codec?: string): void;
  }) {
    const session = usePreviewSession();
    const operation = useRef<AbortController | undefined>(undefined);
    useEffect(() => () => operation.current?.abort(), []);
    const [busy, setBusy] = useState(false);
    const [chosenType, setChosenType] = useState<string | null>(null);
    const effectiveType = typeFqn ?? chosenType ?? undefined;
    const [codec, setCodec] = useState('JSON');
    const [open, setOpen] = useState(false),
      [text, setText] = useState(''),
      [error, setError] = useState('');
    const importData = async () => {
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
      const abort = new AbortController();
      operation.current?.abort();
      operation.current = abort;
      const epoch = useInstanceStore.getState().workspaceEpoch;
      setBusy(true);
      try {
        const convert = async (value: unknown): Promise<unknown> => {
          if (Array.isArray(value)) return Promise.all(value.map(convert));
          const converted = runeJsonCodec.import(JSON.stringify(value), effectiveType ?? '');
          if (converted.diagnostics.length)
            throw new Error(converted.diagnostics.map((diagnostic) => diagnostic.message).join(' '));
          if (value && typeof value === 'object' && !Object.prototype.hasOwnProperty.call(value, '@data')) {
            if (!session?.decode || !effectiveType)
              throw new Error('Wait for the object decoder and choose an object type before importing Rune JSON.');
            return session.decode(effectiveType, converted.data, abort.signal);
          }
          return converted.data;
        };
        const decoded = codec === 'RUNE_JSON' ? await Promise.all(values.map(convert)) : values;
        if (abort.signal.aborted || useInstanceStore.getState().workspaceEpoch !== epoch)
          throw new Error('Workspace changed while importing. Retry in the current workspace.');
        onImport(decoded, effectiveType, codec);
        setError('');
        setOpen(false);
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure));
      } finally {
        if (operation.current === abort) setBusy(false);
      }
    };
    return (
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (!next) operation.current?.abort();
          setOpen(next);
        }}
      >
        <PopoverTrigger render={<Button variant="ghost" size="xs" />}>
          <Upload className="size-3.5" aria-hidden="true" />
          {label}
        </PopoverTrigger>
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
          <Select value={codec} onValueChange={(value) => value && setCodec(value)}>
            <SelectTrigger size="sm" aria-label="Import format">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="JSON">JSON</SelectItem>
              <SelectItem value="RUNE_JSON">Rune JSON</SelectItem>
            </SelectContent>
          </Select>
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
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                operation.current?.abort();
                setOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={() => void importData()} disabled={!text.trim() || busy}>
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
