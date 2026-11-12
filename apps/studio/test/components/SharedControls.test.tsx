// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NativeSelect } from '@rune-langium/design-system/ui/select';
import { Input } from '@rune-langium/design-system/ui/input';
import { FieldTemplate } from '../../src/codegen-forms/z2f-components.js';

describe('shared form controls', () => {
  it('retains native selection, form registration, validation and refs', async () => {
    const user = userEvent.setup();
    const ref = createRef<HTMLSelectElement>();
    const onChange = vi.fn();
    render(
      <form aria-label="Quote">
        <label htmlFor="currency">Currency</label>
        <NativeSelect id="currency" name="currency" defaultValue="" required ref={ref} onChange={onChange}>
          <option value="">Choose currency</option>
          <option value="USD">US Dollar</option>
          <option value="GBP">Pound Sterling</option>
        </NativeSelect>
      </form>
    );
    const select = screen.getByRole('combobox', { name: 'Currency' });
    expect(ref.current).toBe(select);
    expect(select).toBeInvalid();
    await user.selectOptions(select, 'GBP');
    expect(select).toBeValid();
    expect(select).toHaveValue('GBP');
    expect(onChange).toHaveBeenCalledOnce();
    expect(new FormData(ref.current!.form!).get('currency')).toBe('GBP');
  });

  it('keeps disabled selectors out of submitted form data', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = render(
      <form>
        <NativeSelect name="currency" aria-label="Currency" defaultValue="USD" disabled onChange={onChange}>
          <option value="USD">US Dollar</option>
          <option value="GBP">Pound Sterling</option>
        </NativeSelect>
      </form>
    );
    const select = screen.getByRole('combobox', { name: 'Currency' });
    await user.selectOptions(select, 'GBP');
    expect(select).toBeDisabled();
    expect(select).toHaveValue('USD');
    expect(onChange).not.toHaveBeenCalled();
    expect(new FormData(container.querySelector('form')!).has('currency')).toBe(false);
  });

  it('preserves z2f labels, help and announced errors through the shared field template', () => {
    render(
      <FieldTemplate
        name="amount"
        label="Amount"
        description="Quoted amount"
        helpText="Use a positive value"
        error="Amount is required"
        required
        disabled
      >
        <Input id="amount" name="amount" required disabled aria-invalid />
      </FieldTemplate>
    );
    expect(screen.getByRole('textbox', { name: 'Amount' })).toBeDisabled();
    expect(screen.getByText('Quoted amount')).toBeInTheDocument();
    expect(screen.getByText('Use a positive value')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Amount is required');
  });
});
