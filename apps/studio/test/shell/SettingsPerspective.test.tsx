// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SettingsPerspective } from '../../src/shell/perspectives/screens/SettingsPerspective.js';

describe('SettingsPerspective', () => {
  it('renders the settings screen with an Appearance section (font scale)', () => {
    render(<SettingsPerspective />);
    expect(screen.getByTestId('settings-perspective')).toBeTruthy();
    // the font-scale control is surfaced here (reuse of FontScaleButton)
    expect(screen.getByRole('button', { name: /font size/i })).toBeTruthy();
  });
  it('shows live Workspace configuration without the retired coming-soon promise', () => {
    render(<SettingsPerspective />);
    expect(screen.getByTestId('settings-project-section')).toBeTruthy();
    expect(screen.getByText('Workspace configuration')).toBeInTheDocument();
    expect(screen.queryByText(/coming soon|runestudio\/config/i)).not.toBeInTheDocument();
  });
});
