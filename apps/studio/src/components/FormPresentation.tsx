// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from 'react';
import type { PreviewField } from '@rune-langium/codegen/export';
import { Button } from '@rune-langium/design-system/ui/button';
import { Checkbox } from '@rune-langium/design-system/ui/checkbox';
import { Input } from '@rune-langium/design-system/ui/input';
import { Popover, PopoverTrigger, PopoverContent } from '@rune-langium/design-system/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@rune-langium/design-system/ui/select';
import { GripVertical, SlidersHorizontal } from 'lucide-react';
import { useWorkspaceOptional } from '../shell/providers/workspace-context.js';
import {
  formWorkspaceKey,
  canEditFormPresentation,
  useFormPresentationStore,
  formatPreviewNumber,
  type FormPreferences,
  type NumericPresentation,
  type ObjectFormLayout
} from '../store/form-presentation-store.js';
import { withInstrumentation } from '../services/instrumentation/core.js';

const DEFAULT_LAYOUT: ObjectFormLayout = { columns: 1, order: [], spans: {} };
const DEFAULT_FORMAT: NumericPresentation = { style: 'decimal', currency: 'USD', grouping: true };
const PresentationContext = createContext<{
  preferences: FormPreferences;
  editing: boolean;
  update(change: (preferences: FormPreferences) => FormPreferences): void;
}>({ preferences: { layouts: {}, formats: {} }, editing: false, update() {} });

export const useFormPresentationState = withInstrumentation(
  function useFormPresentationState() {
    const workspaceId = useWorkspaceOptional()?.workspaceId;
    const entry = useFormPresentationStore((state) => state.workspaces[formWorkspaceKey(workspaceId)]);
    const load = useFormPresentationStore((state) => state.load);
    useEffect(() => {
      void load(workspaceId);
    }, [workspaceId, load]);
    return { workspaceId, entry, ready: canEditFormPresentation(entry) };
  },
  { op: 'useFormPresentationState', sanitize: () => ({}) }
);

export const FormPresentation = withInstrumentation(
  function FormPresentation({
    children,
    toolbarStart,
    showToolbar = true,
    editing: controlledEditing,
    onEditingChange
  }: {
    children: ReactNode;
    toolbarStart?: ReactNode;
    showToolbar?: boolean;
    editing?: boolean;
    onEditingChange?(editing: boolean): void;
  }) {
    const { workspaceId, entry, ready } = useFormPresentationState();
    const update = useFormPresentationStore((state) => state.update);
    const retry = useFormPresentationStore((state) => state.retry);
    const setEditing = useFormPresentationStore((state) => state.setEditing);
    const editing = ready && (controlledEditing ?? (showToolbar && entry?.editing === true));
    return (
      <PresentationContext
        value={{
          preferences: entry?.preferences ?? { layouts: {}, formats: {} },
          editing,
          update: (change) => update(workspaceId, change)
        }}
      >
        {showToolbar && (
          <div className="preview-layout-toolbar">
            {toolbarStart}
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={!ready}
              aria-pressed={editing}
              onClick={() => (onEditingChange ? onEditingChange(!editing) : setEditing(workspaceId, !editing))}
            >
              <SlidersHorizontal className="size-3.5" aria-hidden="true" />
              {editing ? 'Done editing' : 'Edit layout'}
            </Button>
            {editing && (
              <span role="status">
                {!workspaceId
                  ? 'Session preferences'
                  : entry?.saving
                    ? 'Saving…'
                    : entry?.revision && !entry.error
                      ? 'Saved in this workspace'
                      : 'Workspace preferences'}
              </span>
            )}
          </div>
        )}
        {editing && (
          <p className="preview-layout-help">
            Drag fields to arrange them. Use arrow keys on a handle to move a field. Formats apply to every use of the
            same type.
          </p>
        )}
        {entry?.error && (
          <p role="alert" className="preview-layout-error">
            {entry.error}{' '}
            <Button type="button" variant="ghost" size="xs" onClick={() => void retry(workspaceId)}>
              Retry
            </Button>
          </p>
        )}
        {children}
      </PresentationContext>
    );
  },
  {
    op: 'FormPresentation',
    sanitize: () => ({}),
    sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' })
  }
);

export const useNumericPresentation = withInstrumentation(
  function useNumericPresentation(field: PreviewField) {
    const { preferences } = useContext(PresentationContext);
    return field.typeSymbol ? preferences.formats[field.typeSymbol] : undefined;
  },
  {
    op: 'useNumericPresentation',
    sanitize: () => ({}),
    sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' })
  }
);

export const formMemberKey = withInstrumentation(
  function formMemberKey(path: string, parentPath: string): string {
    return parentPath && path.startsWith(`${parentPath}.`) ? path.slice(parentPath.length + 1) : path;
  },
  {
    op: 'formMemberKey',
    sanitize: () => ({}),
    sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' })
  }
);

export const PreviewLayoutGroup = withInstrumentation(
  function PreviewLayoutGroup({
    symbol,
    parentPath = '',
    fields,
    children,
    renderField
  }: {
    symbol?: string;
    parentPath?: string;
    fields: PreviewField[];
    children?: ReactNode;
    renderField(field: PreviewField): ReactNode;
  }) {
    const { preferences, editing, update } = useContext(PresentationContext);
    const layout = (symbol && preferences.layouts[symbol]) || DEFAULT_LAYOUT;
    const editable = editing && !!symbol && fields.length > 0;
    const group = useId();
    const drag = useRef<{ key: string; target?: string; after?: boolean; pointer: number } | null>(null);
    const [drop, setDrop] = useState<{ key: string; after: boolean } | null>(null);
    const [announcement, announce] = useState('');
    const members = fields.map((field) => ({ field, key: formMemberKey(field.path, parentPath) }));
    const byKey = new Map(members.map((member) => [member.key, member]));
    const ordered = [
      ...layout.order.flatMap((key) => (byKey.has(key) ? [byKey.get(key)!] : [])),
      ...members.filter(({ key }) => !layout.order.includes(key))
    ];
    const patch = (change: Partial<ObjectFormLayout>) => {
      if (symbol)
        update((current) => ({
          ...current,
          layouts: { ...current.layouts, [symbol]: { ...(current.layouts[symbol] ?? DEFAULT_LAYOUT), ...change } }
        }));
    };
    const move = (key: string, target: string, after = false) => {
      if (key === target) return;
      const next = ordered.map((item) => item.key).filter((item) => item !== key);
      next.splice(next.indexOf(target) + (after ? 1 : 0), 0, key);
      patch({ order: next });
      announce(`${byKey.get(key)?.field.label} moved to position ${next.indexOf(key) + 1} of ${next.length}.`);
    };
    return (
      <div className="preview-layout-group" data-layout-group={group}>
        {editable && (
          <div className="preview-layout-group__tools">
            <span className="truncate" title={symbol}>
              {symbol?.split(':').slice(1).join(':')}
            </span>
            <LayoutSelect
              label="Layout columns"
              value={String(layout.columns)}
              onChange={(value) => patch({ columns: Number(value) as 1 | 2 | 3 })}
              options={[
                ['1', '1 column'],
                ['2', '2 columns'],
                ['3', '3 columns']
              ]}
            />
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => {
                if (symbol)
                  update((current) => {
                    const layouts = { ...current.layouts };
                    delete layouts[symbol];
                    return { ...current, layouts };
                  });
              }}
            >
              Reset layout
            </Button>
          </div>
        )}
        <div className="preview-layout-grid" style={{ '--requested-columns': layout.columns } as CSSProperties}>
          {children && <div className="preview-layout-fixed">{children}</div>}
          {ordered.map(({ field, key }, index) => (
            <div
              key={field.path}
              data-layout-field={key}
              data-layout-owner={group}
              data-drop={drop?.key === key ? (drop.after ? 'after' : 'before') : undefined}
              className="preview-layout-field"
              style={
                {
                  '--requested-span':
                    layout.spans[key] === 'full' ||
                    (!layout.spans[key] && (field.kind === 'object' || field.kind === 'array'))
                      ? 3
                      : (layout.spans[key] ?? 1)
                } as CSSProperties
              }
            >
              {editable && (
                <div className="preview-layout-field__tools">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="preview-layout-handle"
                    aria-label={`Move ${field.label}`}
                    title="Drag to move; arrow keys reorder"
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        drag.current = null;
                        setDrop(null);
                        return;
                      }
                      const backwards = event.key === 'ArrowUp' || event.key === 'ArrowLeft';
                      const forwards = event.key === 'ArrowDown' || event.key === 'ArrowRight';
                      if (!backwards && !forwards && event.key !== 'Home' && event.key !== 'End') return;
                      event.preventDefault();
                      const target =
                        event.key === 'Home'
                          ? 0
                          : event.key === 'End'
                            ? ordered.length - 1
                            : index + (backwards ? -1 : 1);
                      if (target >= 0 && target < ordered.length) move(key, ordered[target]!.key, target > index);
                    }}
                    onPointerDown={(event) => {
                      if (event.button !== 0 || !event.isPrimary) return;
                      event.preventDefault();
                      event.currentTarget.focus();
                      event.currentTarget.setPointerCapture(event.pointerId);
                      drag.current = { key, pointer: event.pointerId };
                    }}
                    onPointerMove={(event) => {
                      if (!drag.current || drag.current.pointer !== event.pointerId) return;
                      const scroller = event.currentTarget.closest<HTMLElement>('.studio-scroll');
                      if (scroller) {
                        const bounds = scroller.getBoundingClientRect();
                        const edge = Math.min(36, bounds.height / 4);
                        if (event.clientY > bounds.bottom - edge) scroller.scrollBy(0, 12);
                        else if (event.clientY < bounds.top + edge) scroller.scrollBy(0, -12);
                      }
                      const element = document
                        .elementFromPoint(event.clientX, event.clientY)
                        ?.closest<HTMLElement>('[data-layout-field]');
                      if (element?.dataset.layoutOwner !== group || element.dataset.layoutField === key) {
                        setDrop(null);
                        drag.current.target = undefined;
                        return;
                      }
                      // Insertion follows reading order, including side-by-side columns.
                      const after = ordered.findIndex((item) => item.key === element.dataset.layoutField) > index;
                      drag.current.target = element.dataset.layoutField;
                      drag.current.after = after;
                      setDrop({ key: element.dataset.layoutField!, after });
                    }}
                    onPointerUp={(event) => {
                      const current = drag.current;
                      if (current?.pointer === event.pointerId && current.target)
                        move(current.key, current.target, current.after);
                      drag.current = null;
                      setDrop(null);
                    }}
                    onPointerCancel={() => {
                      drag.current = null;
                      setDrop(null);
                    }}
                    onLostPointerCapture={() => {
                      drag.current = null;
                      setDrop(null);
                    }}
                  >
                    <GripVertical className="size-3.5" aria-hidden="true" />
                  </Button>
                  <span className="preview-layout-field__name">{field.label}</span>
                  <LayoutSelect
                    label={`Width of ${field.label}`}
                    value={String(
                      layout.spans[key] ?? (field.kind === 'object' || field.kind === 'array' ? 'full' : 1)
                    )}
                    onChange={(value) =>
                      patch({
                        spans: { ...layout.spans, [key]: value === 'full' ? 'full' : (Number(value) as 1 | 2 | 3) }
                      })
                    }
                    options={[
                      ['1', '1 column'],
                      ['2', '2 columns'],
                      ['full', 'Full width']
                    ]}
                  />
                  {(field.kind === 'number'
                    ? field.typeSymbol
                    : field.kind === 'array' && field.children[0].kind === 'number'
                      ? field.children[0].typeSymbol
                      : undefined) && (
                    <NumericFormatEditor
                      symbol={(field.kind === 'array' ? field.children[0].typeSymbol : field.typeSymbol)!}
                    />
                  )}
                </div>
              )}
              {renderField(field)}
            </div>
          ))}
        </div>
        <span role="status" aria-live="polite" className="sr-only">
          {announcement}
        </span>
      </div>
    );
  },
  {
    op: 'PreviewLayoutGroup',
    sanitize: () => ({}),
    sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' })
  }
);

function LayoutSelect({
  label,
  value,
  onChange,
  options
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  options: string[][];
}) {
  return (
    <Select
      value={value}
      onValueChange={(value) => {
        if (value) onChange(value);
      }}
    >
      <SelectTrigger size="sm" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([value, title]) => (
          <SelectItem key={value} value={value!}>
            {title}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function NumericFormatEditor({ symbol }: { symbol: string }) {
  const { preferences, update } = useContext(PresentationContext);
  const stored = preferences.formats[symbol];
  const format = stored ?? DEFAULT_FORMAT;
  const [currency, setCurrency] = useState(format.currency);
  const [currencyError, setCurrencyError] = useState(false);
  const id = useId();
  const patch = (change: Partial<NumericPresentation>) =>
    update((current) => ({
      ...current,
      formats: { ...current.formats, [symbol]: { ...(current.formats[symbol] ?? DEFAULT_FORMAT), ...change } }
    }));
  return (
    <Popover>
      <PopoverTrigger
        render={<Button type="button" variant="ghost" size="xs" />}
        onClick={() => {
          setCurrency(format.currency);
          setCurrencyError(false);
        }}
        aria-label={`Format ${symbol.split(':').slice(1).join(':')}`}
      >
        Format
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="preview-format-editor"
        aria-label={`Number format for ${symbol.split(':').slice(1).join(':')}`}
      >
        <p className="font-medium">Number format</p>
        <p className="text-xs text-muted-foreground break-words">
          Applies to {symbol.split(':').slice(1).join(':')} throughout this workspace.
        </p>
        <LayoutSelect
          label="Number format"
          value={stored ? format.style : 'default'}
          onChange={(style) => {
            if (style === 'default')
              update((current) => {
                const formats = { ...current.formats };
                delete formats[symbol];
                return { ...current, formats };
              });
            else patch({ style: style as 'decimal' | 'currency' });
          }}
          options={[
            ['default', 'Default'],
            ['decimal', 'Decimal'],
            ['currency', 'Currency']
          ]}
        />
        {stored && (
          <>
            {format.style === 'currency' && (
              <div className="preview-field">
                <label htmlFor={id} className="preview-field__label">
                  Currency code
                </label>
                <Input
                  id={id}
                  value={currency}
                  maxLength={3}
                  aria-invalid={currencyError || undefined}
                  aria-describedby={currencyError ? `${id}-error` : undefined}
                  onChange={(event) => setCurrency(event.target.value.toUpperCase())}
                  onBlur={() => {
                    const valid = /^[A-Z]{3}$/.test(currency);
                    setCurrencyError(!valid);
                    if (valid) patch({ currency });
                  }}
                />
                {currencyError && (
                  <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
                    Use a three-letter currency code, such as USD.
                  </p>
                )}
              </div>
            )}
            <LayoutSelect
              label="Decimal places"
              value={format.fractionDigits === undefined ? 'auto' : String(format.fractionDigits)}
              onChange={(value) => patch({ fractionDigits: value === 'auto' ? undefined : Number(value) })}
              options={[
                ['auto', 'Automatic decimal places'],
                ...Array.from({ length: 21 }, (_, index) => [String(index), `${index} decimal places`])
              ]}
            />
            <label className="flex items-center gap-2 text-xs">
              <Checkbox
                checked={format.grouping}
                onCheckedChange={(checked) => patch({ grouping: checked === true })}
              />
              Group thousands
            </label>
          </>
        )}
        <output className="text-sm tabular-nums">{formatPreviewNumber(1234.56, stored)}</output>
        <p className="text-xs text-muted-foreground">
          Formatting changes the display. Editing always shows the original value.
        </p>
      </PopoverContent>
    </Popover>
  );
}
