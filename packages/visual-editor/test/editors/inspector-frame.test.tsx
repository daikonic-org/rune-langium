// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { InspectorFrame } from '../../src/components/editors/inspector/InspectorFrame.js';
import { InspectorDetailsPane } from '../../src/components/editors/inspector/InspectorDetailsPane.js';

afterEach(cleanup);
describe('common Inspector composition', () => {
  it('keeps one header/footer and mounted sections when switching tabs', () => {
    render(
      <InspectorFrame
        header={<h2>Person</h2>}
        footer={<p>Actual host status</p>}
        sections={[
          {
            id: 'members',
            label: 'Members',
            members: true,
            content: <input aria-label="Invalid name" defaultValue="draft" />
          },
          {
            id: 'conditions',
            label: 'Conditions',
            content: <textarea aria-label="Rune condition" defaultValue="age exists" />
          }
        ]}
        details={
          <InspectorDetailsPane targetName="age">
            <p>Field docs</p>
          </InspectorDetailsPane>
        }
      />
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Conditions' }));
    expect(screen.getByLabelText('Invalid name')).toHaveValue('draft');
    expect(screen.getByLabelText('Rune condition')).toBeVisible();
    expect(screen.getAllByRole('heading', { name: 'Person' })).toHaveLength(1);
    expect(screen.getAllByText('Actual host status')).toHaveLength(1);
    expect(screen.queryByRole('region', { name: 'Details: age' })).toBeNull();
  });
  it('omits tabs for one section and starts empty details collapsed', () => {
    render(
      <InspectorFrame
        header={<h2>Choice</h2>}
        sections={[{ id: 'members', label: 'Members', members: true, content: <p>Options</p> }]}
        details={
          <InspectorDetailsPane>
            <p>Unused</p>
          </InspectorDetailsPane>
        }
      />
    );
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByRole('button', { name: 'Expand item details' })).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Expand item details' }));
    expect(screen.getByText('Select a member to inspect its details.')).toBeVisible();
  });
  it('bounds keyboard resizing and exposes collapse/clear controls', () => {
    render(
      <InspectorDetailsPane targetName="name">
        <p>Documentation</p>
      </InspectorDetailsPane>
    );
    const divider = screen.getByRole('separator', { name: 'Resize item details' });
    fireEvent.keyDown(divider, { key: 'ArrowUp' });
    expect(Number(divider.getAttribute('aria-valuenow'))).toBe(240);
    fireEvent.keyDown(divider, { key: 'End' });
    expect(divider.getAttribute('aria-valuenow')).toBe(divider.getAttribute('aria-valuemax'));
    fireEvent.keyDown(divider, { key: 'Home' });
    expect(divider.getAttribute('aria-valuenow')).toBe(divider.getAttribute('aria-valuemin'));
    fireEvent.click(screen.getByRole('button', { name: 'Collapse item details' }));
    expect(screen.getByRole('button', { name: 'Expand item details' })).toHaveAttribute('aria-expanded', 'false');
  });
});
