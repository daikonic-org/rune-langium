// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { InspectorFrame } from '../../src/components/editors/inspector/InspectorFrame.js';
import { InspectorDetailsPane } from '../../src/components/editors/inspector/InspectorDetailsPane.js';

afterEach(cleanup);
describe('common Inspector composition', () => {
  it('names element details and uses an accessible icon-only collapse control', () => {
    const { rerender } = render(
      <InspectorDetailsPane elementLabel="Attribute" targetName="party">
        <p>Metadata</p>
      </InspectorDetailsPane>
    );
    expect(screen.getByText('Attribute Detail: party')).toBeVisible();
    const collapse = screen.getByRole('button', { name: 'Collapse item details' });
    expect(collapse).toHaveTextContent('');
    fireEvent.click(collapse);
    expect(screen.getByRole('button', { name: 'Expand item details' })).toHaveAttribute('aria-expanded', 'false');
    rerender(
      <InspectorDetailsPane elementLabel="Member" targetName="Buy">
        <p>Metadata</p>
      </InspectorDetailsPane>
    );
    expect(screen.getByText('Member Detail: Buy')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Details: Buy' })).toBeVisible();
  });
  it('mounts sections on first activation and retains their drafts and DOM identity', () => {
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
    const member = screen.getByLabelText('Invalid name');
    fireEvent.change(member, { target: { value: 'invalid draft!' } });
    expect(screen.queryByLabelText('Rune condition')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Conditions' }));
    const condition = screen.getByLabelText('Rune condition');
    fireEvent.change(condition, { target: { value: 'age > (' } });
    expect(screen.getByLabelText('Invalid name')).toBe(member);
    expect(member).toHaveValue('invalid draft!');
    expect(screen.getByLabelText('Rune condition')).toBeVisible();
    expect(screen.getAllByRole('heading', { name: 'Person' })).toHaveLength(1);
    expect(screen.getAllByText('Actual host status')).toHaveLength(1);
    expect(screen.queryByRole('region', { name: 'Details: age' })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Members' }));
    expect(screen.getByLabelText('Rune condition')).toBe(condition);
    expect(condition).not.toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: 'Conditions' }));
    expect(screen.getByLabelText('Rune condition')).toBe(condition);
    expect(condition).toHaveValue('age > (');
    expect(condition).toBeVisible();
  });
  it('retains activated sections across reordering and records a fallback activation', () => {
    const members = { id: 'members', label: 'Members', content: <input aria-label="Member draft" /> };
    const conditions = { id: 'conditions', label: 'Conditions', content: <input aria-label="Condition draft" /> };
    const metadata = { id: 'metadata', label: 'Metadata', content: <input aria-label="Metadata draft" /> };
    const { rerender } = render(<InspectorFrame header="Person" sections={[members, conditions, metadata]} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Conditions' }));
    const condition = screen.getByLabelText('Condition draft');
    fireEvent.change(condition, { target: { value: 'unfinished (' } });
    rerender(<InspectorFrame header="Person" sections={[metadata, conditions, members]} />);
    expect(screen.getByLabelText('Condition draft')).toBe(condition);
    expect(condition).toHaveValue('unfinished (');
    expect(screen.queryByLabelText('Metadata draft')).toBeNull();
    rerender(<InspectorFrame header="Person" sections={[metadata, members]} />);
    const fallback = screen.getByLabelText('Metadata draft');
    expect(fallback).toBeVisible();
    rerender(<InspectorFrame header="Person" sections={[members, metadata]} />);
    expect(screen.getByLabelText('Metadata draft')).toBe(fallback);
    expect(fallback).not.toBeVisible();
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
