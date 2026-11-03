// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImportDialog } from '../../src/components/ImportDialog.js';
import type { WorkspaceFile } from '../../src/services/workspace.js';

vi.mock('@rune-langium/codegen/import', () => ({
  importModel: vi.fn()
}));
// Full-replacement mocking of '@rune-langium/core' would strip out
// createRuneDslServices/parseWorkspace/etc., which apps/studio/src/services/
// workspace.ts (imported transitively via createWorkspaceFile/updateFileContent)
// calls at module-load time — breaking the whole import graph, not just this
// test. Use the importOriginal + spread pattern already established in
// apps/studio/test/services/workspace-fallback-filter.test.ts so only `parse`
// is overridden.
vi.mock('@rune-langium/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@rune-langium/core')>();
  return {
    ...actual,
    parse: vi.fn()
  };
});
vi.mock('../../src/shell/import-merge.js', () => ({
  mergeImportedText: vi.fn()
}));
vi.mock('../../src/shell/sql-wasm-asset.js', () => ({
  getSqlWasmBytes: vi.fn(async () => new Uint8Array([1, 2, 3]))
}));

import { importModel } from '@rune-langium/codegen/import';
import { parse } from '@rune-langium/core';
import { mergeImportedText } from '../../src/shell/import-merge.js';
import { getSqlWasmBytes } from '../../src/shell/sql-wasm-asset.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function DefaultMockOptionsForm({
  value
}: {
  value: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
}) {
  return <div data-testid="default-mock-options-form">{JSON.stringify(value)}</div>;
}

const DEFAULT_OPTIONS_FORMS_BY_FORMAT = {
  'json-schema': DefaultMockOptionsForm,
  openapi: DefaultMockOptionsForm,
  sql: DefaultMockOptionsForm,
  xsd: DefaultMockOptionsForm
};

function baseProps(overrides: Partial<React.ComponentProps<typeof ImportDialog>> = {}) {
  return {
    open: true,
    onClose: vi.fn(),
    files: [] as WorkspaceFile[],
    onFilesChange: vi.fn(),
    onFileFocused: vi.fn(),
    namespaceToFile: new Map<string, string>(),
    optionsFormsByFormat: DEFAULT_OPTIONS_FORMS_BY_FORMAT,
    ...overrides
  };
}

describe('ImportDialog', () => {
  it('previews a new-file import and enables "Add to workspace"', async () => {
    (importModel as any).mockResolvedValue({
      text: 'namespace demo\nversion "0.0.0"\n\ntype Foo:\n  bar string (1..1)\n',
      model: { namespace: 'demo', types: [{ name: 'Foo' }], enums: [], funcs: [] },
      diagnostics: []
    });
    (parse as any).mockResolvedValue({ hasErrors: false });

    const props = baseProps();
    render(<ImportDialog {...props} />);
    fireEvent.change(screen.getByTestId('import-dialog__source'), { target: { value: '{}' } });
    fireEvent.click(screen.getByText('Preview'));

    await waitFor(() => expect(screen.getByTestId('import-dialog__confirm')).not.toBeDisabled());
    expect(screen.getByTestId('import-dialog__confirm')).toHaveTextContent('Add to workspace');

    fireEvent.click(screen.getByTestId('import-dialog__confirm'));
    expect(props.onFilesChange).toHaveBeenCalledWith([
      expect.objectContaining({ name: 'demo.rosetta', content: expect.stringContaining('type Foo') })
    ]);
    expect(props.onFileFocused).toHaveBeenCalledWith('demo.rosetta');
    expect(props.onClose).toHaveBeenCalled();
  });

  it('disambiguates the new-file path when a file already occupies <namespace>.rosetta (final-review Finding 1)', async () => {
    (importModel as any).mockResolvedValue({
      text: 'namespace demo\nversion "0.0.0"\n\ntype Foo:\n  bar string (1..1)\n',
      model: { namespace: 'demo', types: [{ name: 'Foo' }], enums: [], funcs: [] },
      diagnostics: []
    });
    (parse as any).mockResolvedValue({ hasErrors: false });

    // No namespaceToFile entry for 'demo' (so the "new file" branch is taken),
    // but a file at the derived path 'demo.rosetta' already exists in the
    // workspace under an unrelated namespace — simulating file-name != namespace.
    const files: WorkspaceFile[] = [
      { name: 'demo.rosetta', path: 'demo.rosetta', content: 'namespace other', dirty: false }
    ];
    const props = baseProps({ files, namespaceToFile: new Map<string, string>() });
    render(<ImportDialog {...props} />);
    fireEvent.change(screen.getByTestId('import-dialog__source'), { target: { value: '{}' } });
    fireEvent.click(screen.getByText('Preview'));

    await waitFor(() => expect(screen.getByTestId('import-dialog__confirm')).not.toBeDisabled());
    expect(screen.getByTestId('import-dialog__confirm')).toHaveTextContent('Add to workspace');

    fireEvent.click(screen.getByTestId('import-dialog__confirm'));
    expect(props.onFilesChange).toHaveBeenCalledWith([
      ...files,
      expect.objectContaining({
        name: 'demo-2.rosetta',
        path: 'demo-2.rosetta',
        content: expect.stringContaining('type Foo')
      })
    ]);
    expect(props.onFileFocused).toHaveBeenCalledWith('demo-2.rosetta');
  });

  it('previews a namespace match and offers "Merge into <path>"', async () => {
    (importModel as any).mockResolvedValue({
      text: 'namespace demo\nversion "0.0.0"\n\ntype Foo:\n  bar string (1..1)\n',
      model: { namespace: 'demo', types: [{ name: 'Foo' }], enums: [], funcs: [] },
      diagnostics: []
    });
    (mergeImportedText as any).mockResolvedValue({
      mergedText: 'MERGED',
      skipped: ['Existing'],
      overwritten: [],
      renamed: []
    });

    const files: WorkspaceFile[] = [{ name: 'demo.rosetta', path: 'demo.rosetta', content: 'ORIGINAL', dirty: false }];
    const props = baseProps({ files, namespaceToFile: new Map([['demo', 'demo.rosetta']]) });
    render(<ImportDialog {...props} />);
    fireEvent.change(screen.getByTestId('import-dialog__source'), { target: { value: '{}' } });
    fireEvent.click(screen.getByText('Preview'));

    await waitFor(() =>
      expect(screen.getByTestId('import-dialog__confirm')).toHaveTextContent('Merge into demo.rosetta')
    );
    expect(screen.getByTestId('import-dialog__merge-banner')).toHaveTextContent('1 declaration(s) skipped');

    fireEvent.click(screen.getByTestId('import-dialog__confirm'));
    expect(props.onFilesChange).toHaveBeenCalledWith([
      expect.objectContaining({ path: 'demo.rosetta', content: 'MERGED', dirty: true })
    ]);
    expect(props.onFileFocused).toHaveBeenCalledWith('demo.rosetta');
  });

  it('shows a user-facing error when the reader throws', async () => {
    (importModel as any).mockRejectedValue(new Error('malformed JSON'));
    render(<ImportDialog {...baseProps()} />);
    fireEvent.change(screen.getByTestId('import-dialog__source'), { target: { value: 'not json' } });
    fireEvent.click(screen.getByText('Preview'));

    await waitFor(() => expect(screen.getByTestId('import-dialog__error')).toHaveTextContent('malformed JSON'));
    expect(screen.getByTestId('import-dialog__confirm')).toBeDisabled();
  });

  it('shows an internal-error state when the new-file hard-invariant re-parse fails', async () => {
    (importModel as any).mockResolvedValue({
      text: 'namespace demo\nversion "0.0.0"\n\ntype Foo:\n  bar string (1..1)\n',
      model: { namespace: 'demo', types: [{ name: 'Foo' }], enums: [], funcs: [] },
      diagnostics: []
    });
    (parse as any).mockResolvedValue({ hasErrors: true });

    render(<ImportDialog {...baseProps()} />);
    fireEvent.change(screen.getByTestId('import-dialog__source'), { target: { value: '{}' } });
    fireEvent.click(screen.getByText('Preview'));

    await waitFor(() => expect(screen.getByTestId('import-dialog__internal-error')).toBeInTheDocument());
    expect(screen.getByTestId('import-dialog__confirm')).toBeDisabled();
  });

  it('shows an internal-error state (not a user-facing error) when mergeImportedText fails', async () => {
    (importModel as any).mockResolvedValue({
      text: 'namespace demo\nversion "0.0.0"\n\ntype Foo:\n  bar string (1..1)\n',
      model: { namespace: 'demo', types: [{ name: 'Foo' }], enums: [], funcs: [] },
      diagnostics: []
    });
    (mergeImportedText as any).mockRejectedValue(new Error('mergeImportedText: merged output failed to re-parse.'));

    const files: WorkspaceFile[] = [{ name: 'demo.rosetta', path: 'demo.rosetta', content: 'ORIGINAL', dirty: false }];
    const props = baseProps({ files, namespaceToFile: new Map([['demo', 'demo.rosetta']]) });
    render(<ImportDialog {...props} />);
    fireEvent.change(screen.getByTestId('import-dialog__source'), { target: { value: '{}' } });
    fireEvent.click(screen.getByText('Preview'));

    await waitFor(() =>
      expect(screen.getByTestId('import-dialog__internal-error')).toHaveTextContent(
        'mergeImportedText: merged output failed to re-parse.'
      )
    );
    expect(screen.queryByTestId('import-dialog__error')).not.toBeInTheDocument();
    expect(screen.getByTestId('import-dialog__confirm')).toBeDisabled();
  });

  it('disables confirm and shows the empty-state alert when there is nothing to import', async () => {
    (importModel as any).mockResolvedValue({
      text: 'namespace demo\nversion "0.0.0"\n',
      model: { namespace: 'demo', types: [], enums: [], funcs: [] },
      diagnostics: []
    });
    (parse as any).mockResolvedValue({ hasErrors: false });

    render(<ImportDialog {...baseProps()} />);
    fireEvent.change(screen.getByTestId('import-dialog__source'), { target: { value: '{}' } });
    fireEvent.click(screen.getByText('Preview'));

    await waitFor(() => expect(screen.getByTestId('import-dialog__empty')).toBeInTheDocument());
    expect(screen.getByTestId('import-dialog__confirm')).toBeDisabled();
  });

  it('drives the REAL mergeImportedText (and real parse) through the confirm flow end-to-end (final-review Finding 3)', async () => {
    // Only importModel stays mocked here — the reader itself is out of scope
    // for this integration test. `parse` and `mergeImportedText` are restored
    // to their real implementations for this one test via mockImplementation,
    // so the actual CST-splice merge logic runs (not the per-file mocks the
    // rest of this suite uses).
    const realCore = await vi.importActual<typeof import('@rune-langium/core')>('@rune-langium/core');
    const realImportMerge = await vi.importActual<typeof import('../../src/shell/import-merge.js')>(
      '../../src/shell/import-merge.js'
    );
    (parse as any).mockImplementation(realCore.parse);
    (mergeImportedText as any).mockImplementation(realImportMerge.mergeImportedText);

    (importModel as any).mockResolvedValue({
      text: 'namespace demo\nversion "0.0.0"\n\ntype NewType:\n  field string (1..1)\n',
      model: { namespace: 'demo', types: [{ name: 'NewType' }], enums: [], funcs: [] },
      diagnostics: []
    });

    const files: WorkspaceFile[] = [
      {
        name: 'demo.rosetta',
        path: 'demo.rosetta',
        content: 'namespace demo\nversion "0.0.0"\n\ntype OldType:\n  x string (1..1)\n',
        dirty: false
      }
    ];
    const props = baseProps({ files, namespaceToFile: new Map([['demo', 'demo.rosetta']]) });
    render(<ImportDialog {...props} />);
    fireEvent.change(screen.getByTestId('import-dialog__source'), { target: { value: '{}' } });
    fireEvent.click(screen.getByText('Preview'));

    await waitFor(() =>
      expect(screen.getByTestId('import-dialog__confirm')).toHaveTextContent('Merge into demo.rosetta')
    );
    expect(screen.getByTestId('import-dialog__merge-banner')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('import-dialog__confirm'));

    expect(props.onFilesChange).toHaveBeenCalledTimes(1);
    const updatedFiles = (props.onFilesChange as any).mock.calls[0][0] as WorkspaceFile[];
    const merged = updatedFiles.find((f) => f.path === 'demo.rosetta');
    expect(merged?.content).toContain('type OldType');
    expect(merged?.content).toContain('type NewType');
    expect(props.onFileFocused).toHaveBeenCalledWith('demo.rosetta');
  });

  it('resets the preview when the format is switched', async () => {
    (importModel as any).mockResolvedValue({
      text: 'namespace demo\nversion "0.0.0"\n',
      model: { namespace: 'demo', types: [{ name: 'Foo' }], enums: [], funcs: [] },
      diagnostics: []
    });
    (parse as any).mockResolvedValue({ hasErrors: false });

    render(<ImportDialog {...baseProps()} />);
    fireEvent.change(screen.getByTestId('import-dialog__source'), { target: { value: '{}' } });
    fireEvent.click(screen.getByText('Preview'));
    await waitFor(() => expect(screen.getByTestId('import-dialog__confirm')).not.toBeDisabled());

    const user = userEvent.setup({ writeToClipboard: false });
    await user.click(screen.getByRole('combobox', { name: 'Format:' }));
    await user.click(await screen.findByRole('option', { name: 'OpenAPI' }));

    expect(screen.getByTestId('import-dialog__confirm')).toBeDisabled();
    expect(screen.queryByTestId('import-dialog__preview')).not.toBeInTheDocument();
  });

  it('shows an "Importing…" status while the preview round-trip is in flight', async () => {
    let resolveImportModel!: (value: unknown) => void;
    (importModel as any).mockReturnValue(
      new Promise((resolve) => {
        resolveImportModel = resolve;
      })
    );

    render(<ImportDialog {...baseProps()} />);
    fireEvent.change(screen.getByTestId('import-dialog__source'), { target: { value: '{}' } });
    fireEvent.click(screen.getByText('Preview'));

    // While importModel()'s promise is still pending, the dialog must show
    // visible status — not just disabled controls with no feedback.
    expect(screen.getByTestId('import-dialog__previewing')).toHaveTextContent('Importing…');

    resolveImportModel({
      text: 'namespace demo\nversion "0.0.0"\n\ntype Foo:\n  bar string (1..1)\n',
      model: { namespace: 'demo', types: [{ name: 'Foo' }], enums: [], funcs: [] },
      diagnostics: []
    });
    (parse as any).mockResolvedValue({ hasErrors: false });

    await waitFor(() => expect(screen.queryByTestId('import-dialog__previewing')).not.toBeInTheDocument());
    expect(screen.getByTestId('import-dialog__confirm')).not.toBeDisabled();
  });

  it('renders the options form for the selected format and translates its reader-native field names into importModel', async () => {
    // The z2f-generated forms produce reader-native field names
    // (skipConditions) — importModel()'s ImportOptions still uses the legacy
    // CLI-flag name (conditions, inverse polarity). ImportDialog must
    // translate, not pass the reader-native name straight through.
    function MockOptionsForm({
      value,
      onChange
    }: {
      value: Record<string, unknown>;
      onChange: (v: Record<string, unknown>) => void;
    }) {
      return (
        <button data-testid="mock-options-form" onClick={() => onChange({ skipConditions: true })}>
          {JSON.stringify(value)}
        </button>
      );
    }

    const optionsFormsByFormat = {
      'json-schema': MockOptionsForm,
      openapi: MockOptionsForm,
      sql: MockOptionsForm,
      xsd: MockOptionsForm
    };

    (importModel as any).mockResolvedValue({
      text: 'namespace demo\n\ntype Foo:\n\ta string (1..1)\n',
      model: { namespace: 'demo', types: [{ name: 'Foo' }], enums: [], funcs: [] },
      diagnostics: []
    });
    render(<ImportDialog {...baseProps({ optionsFormsByFormat })} />);
    expect(screen.getByTestId('mock-options-form')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('mock-options-form'));
    fireEvent.change(screen.getByTestId('import-dialog__source'), { target: { value: '{}' } });
    fireEvent.click(screen.getByText('Preview'));
    await waitFor(() =>
      expect(importModel).toHaveBeenCalledWith(
        '{}',
        expect.objectContaining({ from: 'json-schema', conditions: false })
      )
    );
    const call = (importModel as any).mock.calls.at(-1)[1];
    expect(call).not.toHaveProperty('skipConditions');
  });

  it('translates the SQL options form\'s "dialect" field into importModel\'s "sqlDialect"', async () => {
    function MockSqlOptionsForm({
      onChange
    }: {
      value: Record<string, unknown>;
      onChange: (v: Record<string, unknown>) => void;
    }) {
      return (
        <button data-testid="mock-sql-options-form" onClick={() => onChange({ dialect: 'sqlserver' })}>
          form
        </button>
      );
    }

    const optionsFormsByFormat = {
      'json-schema': MockSqlOptionsForm,
      openapi: MockSqlOptionsForm,
      sql: MockSqlOptionsForm,
      xsd: MockSqlOptionsForm
    };

    (importModel as any).mockResolvedValue({
      text: 'namespace demo\n\ntype Foo:\n\ta string (1..1)\n',
      model: { namespace: 'demo', types: [{ name: 'Foo' }], enums: [], funcs: [] },
      diagnostics: []
    });
    render(<ImportDialog {...baseProps({ optionsFormsByFormat })} />);

    const user = userEvent.setup({ writeToClipboard: false });
    await user.click(screen.getByRole('combobox', { name: 'Format:' }));
    await user.click(await screen.findByRole('option', { name: 'SQL DDL' }));

    fireEvent.click(screen.getByTestId('mock-sql-options-form'));
    fireEvent.change(screen.getByTestId('import-dialog__source'), { target: { value: 'CREATE TABLE foo (id int);' } });
    fireEvent.change(screen.getByTestId('import-dialog__namespace'), { target: { value: 'test.sql' } });
    fireEvent.click(screen.getByText('Preview'));

    await waitFor(() =>
      expect(importModel).toHaveBeenCalledWith(
        'CREATE TABLE foo (id int);',
        expect.objectContaining({ from: 'sql', sqlDialect: 'sqlserver' })
      )
    );
    const call = (importModel as any).mock.calls.at(-1)[1];
    expect(call).not.toHaveProperty('dialect');
  });

  it('fetches and threads the SQL grammar WASM bytes into importModel as wasmSource (issue #385 — the browser build has no node:fs)', async () => {
    (importModel as any).mockResolvedValue({
      text: 'namespace demo\n\ntype Foo:\n\ta string (1..1)\n',
      model: { namespace: 'demo', types: [{ name: 'Foo' }], enums: [], funcs: [] },
      diagnostics: []
    });
    render(<ImportDialog {...baseProps()} />);

    const user = userEvent.setup({ writeToClipboard: false });
    await user.click(screen.getByRole('combobox', { name: 'Format:' }));
    await user.click(await screen.findByRole('option', { name: 'SQL DDL' }));

    fireEvent.change(screen.getByTestId('import-dialog__source'), { target: { value: 'CREATE TABLE foo (id int);' } });
    fireEvent.change(screen.getByTestId('import-dialog__namespace'), { target: { value: 'test.sql' } });
    fireEvent.click(screen.getByText('Preview'));

    await waitFor(() => expect(getSqlWasmBytes).toHaveBeenCalled());
    await waitFor(() =>
      expect(importModel).toHaveBeenCalledWith(
        'CREATE TABLE foo (id int);',
        expect.objectContaining({ from: 'sql', wasmSource: new Uint8Array([1, 2, 3]) })
      )
    );
  });

  it('shows a namespace-required error and never fetches SQL WASM bytes when previewing SQL with no namespace', async () => {
    // Both mocks persist call history across tests in this file (see the
    // comment on the next test) — assert on deltas, not absolute counts.
    const wasmCallsBefore = (getSqlWasmBytes as any).mock.calls.length;
    const importCallsBefore = (importModel as any).mock.calls.length;

    render(<ImportDialog {...baseProps()} />);

    const user = userEvent.setup({ writeToClipboard: false });
    await user.click(screen.getByRole('combobox', { name: 'Format:' }));
    await user.click(await screen.findByRole('option', { name: 'SQL DDL' }));

    fireEvent.change(screen.getByTestId('import-dialog__source'), { target: { value: 'CREATE TABLE foo (id int);' } });
    // Namespace field deliberately left blank.
    fireEvent.click(screen.getByText('Preview'));

    await waitFor(() => expect(screen.getByTestId('import-dialog__error')).toBeInTheDocument());
    expect(screen.getByTestId('import-dialog__error')).toHaveTextContent(/namespace/i);
    // The ~MB-scale WASM fetch and importModel() itself (which would throw
    // for this exact reason anyway) must both be skipped, not just called
    // and then have their error surfaced after the fact.
    expect((getSqlWasmBytes as any).mock.calls.length).toBe(wasmCallsBefore);
    expect((importModel as any).mock.calls.length).toBe(importCallsBefore);
  });

  it('never fetches SQL WASM bytes or passes wasmSource for a non-SQL format', async () => {
    // getSqlWasmBytes is a vi.mock()-level mock, not a vi.spyOn() — the
    // afterEach's vi.restoreAllMocks() doesn't clear its call history across
    // tests in this file, so assert on a delta rather than an absolute count.
    const callsBefore = (getSqlWasmBytes as any).mock.calls.length;

    (importModel as any).mockResolvedValue({
      text: 'namespace demo\n\ntype Foo:\n\ta string (1..1)\n',
      model: { namespace: 'demo', types: [{ name: 'Foo' }], enums: [], funcs: [] },
      diagnostics: []
    });
    render(<ImportDialog {...baseProps()} />);
    fireEvent.change(screen.getByTestId('import-dialog__source'), { target: { value: '{}' } });
    fireEvent.click(screen.getByText('Preview'));

    await waitFor(() => expect(importModel).toHaveBeenCalled());
    expect((getSqlWasmBytes as any).mock.calls.length).toBe(callsBefore);
    const call = (importModel as any).mock.calls.at(-1)[1];
    expect(call).not.toHaveProperty('wasmSource');
  });

  it('always shows the onCollision selector defaulting to skip', () => {
    render(<ImportDialog {...baseProps()} />);
    expect(screen.getByTestId('import-dialog__on-collision')).toHaveTextContent(/skip/i);
  });
});

it('keeps parser location and recovery guidance without the CLI prefix or losing source', async () => {
  vi.mocked(importModel).mockRejectedValue(new Error('rune-codegen import: input is not valid JSON: line 2 column 3'));
  const props = baseProps();
  render(<ImportDialog {...props} />);
  fireEvent.change(screen.getByTestId('import-dialog__source'), { target: { value: 'invalid source' } });
  await userEvent.click(screen.getByText('Preview', { exact: true }));
  const alert = await screen.findByTestId('import-dialog__error');
  expect(alert).toHaveTextContent('line 2 column 3');
  expect(alert).not.toHaveTextContent('rune-codegen');
  expect(alert).toHaveTextContent('Correct the source and select Preview again');
  expect(screen.getByRole('textbox', { name: 'Import source' })).toHaveValue('invalid source');
  expect(props.onFilesChange).not.toHaveBeenCalled();
});
