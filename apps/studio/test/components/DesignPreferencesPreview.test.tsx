// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DesignPreferencesPreview from '../../src/components/DesignPreferencesPreview.js';

describe('DesignPreferencesPreview', () => {
  it('compares live styles and resets without retaining choices after unmount', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<DesignPreferencesPreview />);
    await user.click(screen.getByRole('button', { name: 'Design preferences' }));
    await user.click(screen.getByRole('checkbox', { name: 'Calmer chrome' }));
    await user.click(screen.getByRole('checkbox', { name: 'Clearer navigation text' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Pane pill gap' }), 'wide');
    expect(document.documentElement.dataset.designPreviewCalm).toBe('true');
    expect(document.documentElement.dataset.designPreviewReadable).toBe('true');
    expect(document.documentElement.dataset.designPreviewGap).toBe('wide');
    await user.click(screen.getByRole('button', { name: 'Reset to current design' }));
    expect(document.documentElement.dataset.designPreviewCalm).toBe('false');
    expect(document.documentElement.dataset.designPreviewReadable).toBe('false');
    expect(document.documentElement.dataset.designPreviewGap).toBe('current');
    unmount();
    expect(document.documentElement.hasAttribute('data-design-preview-calm')).toBe(false);
    expect(document.documentElement.hasAttribute('data-design-preview-readable')).toBe(false);
    expect(document.documentElement.hasAttribute('data-design-preview-gap')).toBe(false);
  });
});
