// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { StructureView } from '../../src/components/StructureView.js';
import type { RangeDiagnostic } from '../../src/hooks/useDiagnosticsForRange.js';

function show(
  typeName: string,
  diagnostics?: readonly RangeDiagnostic[],
  range: { start: number; end: number } | null | undefined = { start: 10, end: 20 },
  onNavigate?: (id: string) => void
) {
  const adapterDoc = {
    namespaces: [{ uri: 'demo' }],
    nodes: [
      {
        id: 'demo.Trade',
        $type: 'Data',
        name: 'Trade',
        namespace: 'demo',
        attributes: [
          {
            name: 'value',
            typeCall: { type: { $refText: typeName } },
            astRange: range ?? undefined,
            card: { inf: 1, sup: 1, unbounded: false }
          }
        ]
      },
      { id: 'demo.Status', $type: 'Enum', name: 'Status', namespace: 'demo', values: [{ name: 'Open' }] }
    ]
  };
  return render(
    <StructureView
      focusedTypeId="demo.Trade"
      adapterDoc={adapterDoc}
      structureDiagnostics={diagnostics}
      onNavigateToEnumType={onNavigate}
    />
  );
}
const diagnostic = (severity: 1 | 2 | 3 | 4, start = 12, end = 18): RangeDiagnostic => ({
  severity,
  start,
  end,
  message: 'Invalid member'
});

describe('Structure member affordances', () => {
  it('uses a keyboard-accessible enum navigation button with the canonical declaration ID', () => {
    const navigate = vi.fn();
    show('Status', undefined, undefined, navigate);
    const button = screen.getByRole('button', { name: 'Navigate to Status' });
    button.focus();
    expect(button).toHaveFocus();
    fireEvent.click(button);
    expect(navigate).toHaveBeenCalledExactlyOnceWith('demo.Status');
    expect(screen.queryByRole('button', { name: 'Expand value' })).toBeNull();
  });
  it('does not offer navigation without a host callback', () => {
    show('Status');
    expect(screen.queryByRole('button', { name: 'Navigate to Status' })).toBeNull();
  });
  it('identifies unresolved references without offering a nonexistent destination', () => {
    const navigate = vi.fn();
    show('Missing', undefined, undefined, navigate);
    expect(screen.getByRole('img', { name: 'Unresolved type: Missing' })).toHaveAttribute(
      'title',
      'The referenced type could not be resolved'
    );
    expect(screen.queryByRole('button', { name: 'Navigate to Missing' })).toBeNull();
  });
  it.each([
    [1, 'error'],
    [2, 'warn'],
    [3, 'info'],
    [4, 'info']
  ] as const)('marks an overlapping diagnostic with severity %s', (severity, suffix) => {
    const { container } = show('Missing', [diagnostic(severity)]);
    const row = container.querySelector('[data-attr="value"]');
    expect(row).toHaveClass(`rune-node-row--diagnostic-${suffix}`);
    expect(row).toHaveAttribute('title', 'Invalid member');
  });
  it('selects the highest severity and ignores diagnostics outside the member range', () => {
    const { container } = show('string', [diagnostic(2), diagnostic(1), diagnostic(1, 30, 40)]);
    expect(container.querySelector('[data-attr="value"]')).toHaveClass('rune-node-row--diagnostic-error');
  });
  it.each(['outside', 'touching', 'missing-range', 'no-diagnostics'] as const)(
    'omits false-positive markers: %s',
    (mode) => {
      const ranges =
        mode === 'outside'
          ? [diagnostic(1, 30, 40)]
          : mode === 'touching'
            ? [diagnostic(1, 20, 30)]
            : mode === 'no-diagnostics'
              ? undefined
              : [diagnostic(1)];
      const { container } = show('string', ranges, mode === 'missing-range' ? null : undefined);
      expect(container.querySelector('[data-attr="value"]')?.className).not.toContain('rune-node-row--diagnostic-');
    }
  );
});
