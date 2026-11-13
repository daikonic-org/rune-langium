// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  NativeSelect,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@rune-langium/design-system/ui/select';
import { Input } from '@rune-langium/design-system/ui/input';
import {
  Command,
  CommandCollection,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList
} from '@rune-langium/design-system/ui/command';
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

  it('preserves Select focus, keyboard selection and form values through the shared trigger', async () => {
    const user = userEvent.setup();
    const ref = createRef<HTMLButtonElement>();
    const onChange = vi.fn();
    const { container } = render(
      <form>
        <Select name="currency" defaultValue="USD" onValueChange={onChange}>
          <SelectTrigger aria-label="Currency" ref={ref}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="USD">US Dollar</SelectItem>
            <SelectItem value="GBP">Pound Sterling</SelectItem>
          </SelectContent>
        </Select>
      </form>
    );
    const trigger = screen.getByRole('combobox', { name: 'Currency' });
    expect(ref.current).toBe(trigger);
    await user.click(trigger);
    await waitFor(() => expect(screen.getByRole('option', { name: 'US Dollar' })).toHaveFocus());
    await user.keyboard('{End}');
    await waitFor(() => expect(screen.getByRole('option', { name: 'Pound Sterling' })).toHaveFocus());
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('GBP');
    expect(trigger).toHaveTextContent('Pound Sterling');
    expect(trigger).toHaveFocus();
    expect(new FormData(container.querySelector('form')!).get('currency')).toBe('GBP');
  });

  it('forwards Command search refs and selects the original typed value by keyboard', async () => {
    const user = userEvent.setup();
    const ref = createRef<HTMLInputElement>();
    const onSelect = vi.fn();
    render(
      <Command
        items={[
          { value: 42, label: 'Forty two' },
          { value: 7, label: 'Seven' }
        ]}
        onItemSelect={onSelect}
      >
        <CommandInput aria-label="Search numbers" ref={ref} />
        <CommandList>
          <CommandEmpty>No numbers found</CommandEmpty>
          <CommandCollection<number>>
            {(item) => (
              <CommandItem key={item.value} value={item}>
                {item.label}
              </CommandItem>
            )}
          </CommandCollection>
        </CommandList>
      </Command>
    );
    const input = screen.getByRole('combobox', { name: 'Search numbers' });
    const emptyState = screen.getByRole('status');
    expect(emptyState).toHaveAttribute('aria-live', 'polite');
    expect(emptyState).toBeEmptyDOMElement();
    expect(ref.current).toBe(input);
    await user.type(input, 'unmatched');
    expect(emptyState).toHaveTextContent('No numbers found');
    await user.clear(input);
    await user.type(input, 'Seven');
    expect(emptyState).toBeEmptyDOMElement();
    expect(screen.queryByRole('option', { name: 'Forty two' })).not.toBeInTheDocument();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onSelect).toHaveBeenCalledWith(7);
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
