// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { PreviewEnumInput } from '../../src/components/PreviewEnumInput.js';
it('searches large code lists by value/description and keeps unknown current values visible', async () => {
  const onChange = vi.fn();
  const options = Array.from({ length: 120 }, (_, i) => ({ value: `CODE${i}`, label: `Description ${i}` }));
  const { rerender } = render(
    <PreviewEnumInput
      label="Business center"
      value="unlisted"
      options={options}
      required={false}
      onChange={onChange}
      invalid
    />
  );
  const user = userEvent.setup();
  expect(screen.getByRole('button', { name: 'Business center' })).toHaveTextContent('unlisted (not in list)');
  await user.click(screen.getByRole('button', { name: 'Business center' }));
  await user.type(screen.getByRole('combobox', { name: 'Search Business center' }), 'CODE119');
  await user.click(await screen.findByRole('option', { name: 'Description 119' }));
  expect(onChange).toHaveBeenCalledWith('CODE119');
  rerender(
    <PreviewEnumInput label="Business center" value="CODE119" options={options} required={false} onChange={onChange} />
  );
  await user.click(screen.getByRole('button', { name: 'Business center' }));
  await user.click(await screen.findByRole('option', { name: 'Select…' }));
  expect(onChange).toHaveBeenLastCalledWith(undefined);
});
it('labels deprecated values, preserves historical selection and keeps clear separate from authored sentinel-like values', async () => {
  const onChange = vi.fn();
  render(
    <PreviewEnumInput
      label="Code"
      value="old"
      options={[
        { value: 'old', label: 'Old', deprecatedDate: '2020-01-01' },
        { value: '__rune_enum_unset__', label: 'Literal sentinel' }
      ]}
      required={false}
      onChange={onChange}
    />
  );
  const user = userEvent.setup();
  expect(screen.getByRole('combobox', { name: 'Code' })).toHaveTextContent('deprecated 2020-01-01');
  await user.click(screen.getByRole('combobox', { name: 'Code' }));
  await user.click(await screen.findByRole('option', { name: 'Literal sentinel' }));
  expect(onChange).toHaveBeenLastCalledWith('__rune_enum_unset__');
});
