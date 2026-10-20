// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * ReferencePicker — dropdown to select in-scope variables.
 *
 * Shows FunctionScope entries (inputs, aliases, output) with type/cardinality.
 * Uses the design-system Select for keyboard navigation and accessible
 * listbox semantics.
 *
 * @module
 */

import { Select, SelectContent, SelectItem, SelectTrigger } from '@rune-langium/design-system/ui/select';
import type { ExpressionNode } from '../../../schemas/expression-node-schema.js';
import type { FunctionScope, FunctionScopeEntry } from '../../../store/expression-store.js';

export interface ReferencePickerProps {
  open: boolean;
  scope: FunctionScope;
  onSelect: (node: ExpressionNode) => void;
  onClose: () => void;
}

export function ReferencePicker({ open, scope, onSelect, onClose }: ReferencePickerProps) {
  const allEntries = [
    ...scope.inputs.map((e) => ({ ...e, origin: 'input' as const })),
    ...(scope.output ? [{ ...scope.output, origin: 'output' as const }] : []),
    ...scope.aliases.map((e) => ({ ...e, origin: 'alias' as const })),
    ...(scope.attributes ?? []).map((e) => ({ ...e, origin: 'attribute' as const })),
    ...(scope.references ?? []).map((e) => ({ ...e, origin: e.kind ?? 'callable' }))
  ].filter((entry) => entry.origin !== 'callable' || entry.argumentCount !== undefined);
  const handleValueChange = (value: string) => {
    const entry: FunctionScopeEntry | undefined = allEntries.find(({ origin, name }) => `${origin}:${name}` === value);
    if (!entry) return;
    let rawArgs: ExpressionNode[] | undefined;
    if (entry.kind === 'callable') {
      const count = entry.argumentCount;
      if (count === undefined) return;
      rawArgs = Array.from({ length: count }, () => ({ $type: 'Placeholder', id: crypto.randomUUID() }));
    }
    onSelect({
      $type: 'RosettaSymbolReference',
      id: crypto.randomUUID(),
      symbol: entry.name,
      ...(rawArgs ? { explicitArguments: true, rawArgs } : {})
    } as unknown as ExpressionNode);
  };

  return (
    <Select
      open={open}
      value={null}
      onValueChange={handleValueChange}
      onOpenChange={(isOpen: boolean) => {
        if (!isOpen) onClose();
      }}
    >
      {/*
       * Zero-size anchor — opened programmatically by ExpressionBuilder,
       * not by direct user interaction on a visible button.
       */}
      <SelectTrigger
        aria-hidden="true"
        tabIndex={-1}
        className="border-0 p-0 shadow-none [&_svg]:hidden"
        nativeButton={false}
        render={<span aria-hidden style={{ position: 'absolute', width: 0, height: 0, pointerEvents: 'none' }} />}
      />
      <SelectContent
        className="w-72 max-w-[calc(100vw-32px)] max-h-64 p-0"
        align="start"
        data-testid="reference-picker"
      >
        {allEntries.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No variables in scope</p>
        ) : null}
        {allEntries.map((entry) => (
          <SelectItem
            key={`${entry.origin}-${entry.name}`}
            value={`${entry.origin}:${entry.name}`}
            data-testid={`ref-option-${entry.name}`}
          >
            <span className="flex min-w-0 w-full items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-mono font-medium" title={entry.name}>
                {entry.name}
              </span>
              {entry.typeName && (
                <span className="max-w-20 truncate text-3xs text-muted-foreground" title={entry.typeName}>
                  {entry.typeName}
                </span>
              )}
              {entry.cardinality && (
                <span className="shrink-0 rounded bg-muted px-1 text-3xs text-muted-foreground">
                  {entry.cardinality}
                </span>
              )}
              <span className="shrink-0 rounded bg-muted px-1 text-3xs text-muted-foreground">{entry.origin}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
