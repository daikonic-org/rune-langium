// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * T085 — cross-app design-system primitives.
 * Exercises the new shared components from a Studio consumer; they're
 * pure React + Tailwind so a single set of tests covers all three
 * surfaces (landing, docs, Studio) that consume them.
 */

import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Alert, AlertTitle } from '@rune-langium/design-system/ui/alert';
import { Heading } from '@rune-langium/design-system/ui/heading';
import { CodeBlock } from '@rune-langium/design-system/ui/code-block';
import { AppSwitcher } from '@rune-langium/design-system/ui/app-switcher';
import { Button } from '@rune-langium/design-system/ui/button';
import { Checkbox } from '@rune-langium/design-system/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@rune-langium/design-system/ui/dropdown-menu';
import { RadioGroup, RadioGroupItem } from '@rune-langium/design-system/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@rune-langium/design-system/ui/select';

describe('Heading (T085)', () => {
  it('renders the requested semantic level', () => {
    render(<Heading level={1}>Title</Heading>);
    expect(screen.getByRole('heading', { level: 1, name: /Title/ })).toBeInTheDocument();
  });

  it('preserves semantic level when `as` overrides the visual size', () => {
    render(
      <Heading level={1} as="h2">
        Section
      </Heading>
    );
    expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument();
  });
});

describe('CodeBlock (T085)', () => {
  it('exposes the language as a data attribute', () => {
    const { container } = render(<CodeBlock language="typescript">x</CodeBlock>);
    expect(container.querySelector('pre')?.getAttribute('data-language')).toBe('typescript');
  });
});

describe('AppSwitcher (T085, T092)', () => {
  it('renders three navigation links', () => {
    render(<AppSwitcher current="studio" />);
    expect(screen.getAllByRole('link')).toHaveLength(3);
  });

  it('marks the current surface with aria-current=page', () => {
    render(<AppSwitcher current="studio" />);
    const links = screen.getAllByRole('link');
    const studio = links.find((l) => l.textContent === 'Studio');
    const home = links.find((l) => l.textContent === 'Home');
    expect(studio?.getAttribute('aria-current')).toBe('page');
    expect(home?.getAttribute('aria-current')).toBeNull();
  });

  it('respects URL overrides for staging deployments', () => {
    render(<AppSwitcher current="studio" urls={{ home: 'https://staging.daikonic.dev/' }} />);
    const home = screen.getAllByRole('link').find((l) => l.textContent === 'Home');
    expect(home?.getAttribute('href')).toBe('https://staging.daikonic.dev/');
  });

  it('exposes role=navigation with an accessible name', () => {
    render(<AppSwitcher current="studio" />);
    expect(screen.getByRole('navigation', { name: /rune-langium surfaces/i })).toBeInTheDocument();
  });
});

describe('Base UI migration regressions', () => {
  it('preserves custom classes when Button renders through a supplied element', () => {
    render(<Button render={<a href="/docs" className="custom-link" />}>Docs</Button>);

    expect(screen.getByRole('link', { name: 'Docs' })).toHaveClass('custom-link');
  });

  it('centers one label for adjacent text and keeps icon-only controls simple', () => {
    render(
      <>
        <Button>
          <svg aria-hidden="true" />
          {'Generate '}
          {3}
          {' targets'}
        </Button>
        <Button size="icon" aria-label="Close">
          <svg aria-hidden="true" />
        </Button>
        <Button render={<a href="/docs">Open docs</a>} />
      </>
    );

    const generate = screen.getByRole('button', { name: 'Generate 3 targets' });
    expect(generate.querySelectorAll('[data-slot="button-label"]')).toHaveLength(1);
    expect(generate.querySelector('svg')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' }).querySelector('[data-slot="button-label"]')).toBeNull();
    expect(
      screen.getByRole('link', { name: 'Open docs' }).querySelector('[data-slot="button-label"]')
    ).toHaveTextContent('Open docs');
  });

  it('preserves custom classes when AlertTitle renders through a supplied element', () => {
    render(
      <Alert>
        <AlertTitle render={<h3 className="custom-title" />}>Migration warning</AlertTitle>
      </Alert>
    );

    expect(screen.getByRole('heading', { level: 3, name: 'Migration warning' })).toHaveClass('custom-title');
  });

  it('renders Checkbox and RadioGroupItem with non-submitting buttons', () => {
    const { container } = render(
      <form>
        <Checkbox aria-label="Accept terms" />
        <RadioGroup value="a">
          <RadioGroupItem value="a" aria-label="Option A" />
        </RadioGroup>
      </form>
    );

    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons).not.toHaveLength(0);
    expect(buttons.every((button) => button.getAttribute('type') === 'button')).toBe(true);
  });

  it('shows placeholder text when empty and selected labels instead of raw values', async () => {
    function ExampleSelect() {
      const [value, setValue] = useState<string | null>(null);

      return (
        <Select value={value} onValueChange={setValue}>
          <SelectTrigger aria-label="Layout direction">
            <SelectValue placeholder="Pick a direction" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="TB">Top → Bottom</SelectItem>
            <SelectItem value="LR">Left → Right</SelectItem>
          </SelectContent>
        </Select>
      );
    }

    render(<ExampleSelect />);

    const trigger = screen.getByRole('combobox', { name: 'Layout direction' });
    expect(trigger).toHaveTextContent('Pick a direction');
    expect(screen.getByText('Pick a direction').closest('[data-slot="select-value"]')).toHaveClass(
      'text-muted-foreground'
    );

    const user = userEvent.setup({ writeToClipboard: false });
    await user.click(trigger);
    await user.click(await screen.findByRole('option', { name: 'Top → Bottom' }));

    expect(trigger).toHaveTextContent('Top → Bottom');
    expect(trigger).not.toHaveTextContent('TB');
  });

  it('renders select popups through a portal so panel overflow cannot clip them', async () => {
    function ExampleSelect() {
      const [value, setValue] = useState<string | null>(null);

      return (
        <div data-testid="panel-shell" className="overflow-hidden">
          <Select value={value} onValueChange={setValue}>
            <SelectTrigger aria-label="Portaled layout direction">
              <SelectValue placeholder="Pick a direction" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="TB">Top → Bottom</SelectItem>
              <SelectItem value="LR">Left → Right</SelectItem>
            </SelectContent>
          </Select>
        </div>
      );
    }

    const { getByTestId } = render(<ExampleSelect />);
    const user = userEvent.setup({ writeToClipboard: false });
    await user.click(screen.getByRole('combobox', { name: 'Portaled layout direction' }));

    const panelShell = getByTestId('panel-shell');
    expect(panelShell.querySelector('[data-slot="select-content"]')).toBeNull();
    expect(document.body.querySelector('[data-slot="select-content"]')).not.toBeNull();
  });

  it('renders dropdown submenus through a portal so parent menu overflow cannot clip them', () => {
    const { getByTestId } = render(
      <div data-testid="panel-shell" className="overflow-hidden">
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger render={<button type="button">Actions</button>} />
          <DropdownMenuContent>
            <DropdownMenuSub defaultOpen>
              <DropdownMenuSubTrigger>More tools</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem>Inspect</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );

    const panelShell = getByTestId('panel-shell');
    expect(panelShell.querySelector('[data-slot="dropdown-menu-sub-content"]')).toBeNull();
    expect(document.body.querySelector('[data-slot="dropdown-menu-sub-content"]')).not.toBeNull();
  });

  it('targets submenu trigger open styling with Base UI popup-open state', () => {
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger render={<button type="button">Actions</button>} />
        <DropdownMenuContent>
          <DropdownMenuSub defaultOpen>
            <DropdownMenuSubTrigger>More tools</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem>Inspect</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
    );

    expect(screen.getByText('More tools')).toHaveClass('data-[popup-open]:bg-accent');
  });
});
