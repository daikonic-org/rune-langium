// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { ChoiceNode } from '../../../src/components/nodes/ChoiceNode.js';

function renderInFlow(jsx: React.ReactNode) {
  return render(<ReactFlowProvider>{jsx}</ReactFlowProvider>);
}

const graphData = {
  $type: 'Choice',
  id: 'cdm.settlement::SettlementTerms',
  kind: 'choice',
  name: 'SettlementTerms',
  namespace: 'cdm.settlement',
  attributes: [
    {
      name: 'cashOption',
      typeCall: { type: { $refText: 'CashSettlement' } },
      card: { inf: 0, sup: 1, unbounded: false }
    },
    {
      name: 'physicalOption',
      typeCall: { type: { $refText: 'PhysicalSettlement' } },
      card: { inf: 0, sup: 1, unbounded: false }
    }
  ]
  // No `variant` field → graph variant
};

describe('ChoiceNode — graph variant (pre-existing behavior)', () => {
  it('renders the choice name', () => {
    renderInFlow(
      <ChoiceNode data={graphData as any} selected={false} id="cdm.settlement::SettlementTerms" type="choice" />
    );
    expect(screen.getByText('SettlementTerms')).toBeInTheDocument();
  });

  it('shows member count summary', () => {
    renderInFlow(
      <ChoiceNode data={graphData as any} selected={false} id="cdm.settlement::SettlementTerms" type="choice" />
    );
    expect(screen.getByText('2 options')).toBeInTheDocument();
  });

  it('renders attribute names from data.attributes', () => {
    renderInFlow(
      <ChoiceNode data={graphData as any} selected={false} id="cdm.settlement::SettlementTerms" type="choice" />
    );
    // getTypeRefText returns the $refText, which is the display name in graph mode.
    // Use getAllByText since the same text may appear multiple times in some fixtures.
    expect(screen.getAllByText('CashSettlement').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('PhysicalSettlement').length).toBeGreaterThanOrEqual(1);
  });
});
