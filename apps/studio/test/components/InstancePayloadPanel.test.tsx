// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InstancePayloadPanel } from '../../src/components/InstancePayloadPanel.js';

describe('InstancePayloadPanel', () => {
  it('renders one JSON value and delegates exporting to its owner', async () => {
    const onExport = vi.fn().mockResolvedValue(undefined);
    render(<InstancePayloadPanel payload={{ kind: 'instance', value: { name: 'Acme' } }} onExport={onExport} />);

    expect(screen.getByTestId('instance-payload-output')).toHaveTextContent('"Acme"');
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(onExport).toHaveBeenCalledOnce());
  });

  it('keeps a failed persistence/export operation visible', async () => {
    render(
      <InstancePayloadPanel
        payload={{ kind: 'instance', value: { name: 'Acme' } }}
        onExport={async () => {
          throw new Error('Instance save failed.');
        }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Instance save failed.');
  });

  it('prevents duplicate exports and ignores a previous payload failure', async () => {
    let reject!: (error: Error) => void;
    const pending = new Promise<void>((_, failure) => {
      reject = failure;
    });
    const onExport = vi.fn().mockReturnValue(pending);
    const { rerender } = render(
      <InstancePayloadPanel payload={{ kind: 'instance', value: { name: 'First' } }} onExport={onExport} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    fireEvent.click(screen.getByRole('button', { name: 'Exporting…' }));
    expect(onExport).toHaveBeenCalledOnce();
    rerender(
      <InstancePayloadPanel
        payload={{ kind: 'instance', value: { name: 'Next' } }}
        onExport={vi.fn().mockResolvedValue(undefined)}
      />
    );
    await act(async () => {
      reject(new Error('Previous payload failure'));
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled();
    expect(screen.getByTestId('instance-payload-output')).toHaveTextContent('Next');
  });

  it('explains unavailable clipboard access without losing the payload', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    render(<InstancePayloadPanel payload={{ kind: 'instance', value: { name: 'Acme' } }} onExport={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Select and copy the text instead');
    expect(screen.getByTestId('instance-payload-output')).toHaveTextContent('Acme');
  });
});
