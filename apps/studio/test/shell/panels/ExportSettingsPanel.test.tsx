// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { ExportSettingsPanel } from '../../../src/shell/panels/ExportSettingsPanel.js';

vi.mock('../../../src/codegen-forms/ExcelOptionsFormAdapter.js', () => ({
  ExcelOptionsFormAdapter: () => <div data-testid="excel-options-form" />
}));

const config = {
  target: 'typescript' as const,
  selection: { namespaces: [], declarations: [{ namespace: 'test', name: 'Party', kind: 'Data' }] },
  options: { typescript: { layout: 'barrel' } }
};

it('keeps target-specific layout settings and generates only with selected roots', async () => {
  const onChange = vi.fn();
  const onGenerate = vi.fn();
  render(
    <ExportSettingsPanel config={config} onChange={onChange} onGenerate={onGenerate} onCancel={vi.fn()} status="idle" />
  );

  await userEvent.selectOptions(screen.getByLabelText('Export layout'), 'single-file');
  expect(onChange).toHaveBeenLastCalledWith({
    ...config,
    options: { typescript: { layout: 'single-file' } }
  });
  await userEvent.click(screen.getByRole('button', { name: 'Generate 1 selected' }));
  expect(onGenerate).toHaveBeenCalledOnce();
});

it('disables generation until the explorer supplies an export root', () => {
  render(
    <ExportSettingsPanel
      config={{ ...config, selection: { namespaces: [], declarations: [] } }}
      onChange={vi.fn()}
      onGenerate={vi.fn()}
      onCancel={vi.fn()}
      status="idle"
    />
  );
  expect(screen.getByRole('button', { name: 'Generate 0 selected' })).toBeDisabled();
});

it('offers cancellation while generating and retry after an error', async () => {
  const onCancel = vi.fn();
  const { rerender } = render(
    <ExportSettingsPanel
      config={config}
      onChange={vi.fn()}
      onGenerate={vi.fn()}
      onCancel={onCancel}
      status="generating"
    />
  );
  await userEvent.click(screen.getByRole('button', { name: 'Cancel generation' }));
  expect(onCancel).toHaveBeenCalledOnce();

  rerender(
    <ExportSettingsPanel config={config} onChange={vi.fn()} onGenerate={vi.fn()} onCancel={vi.fn()} status="failed" />
  );
  expect(screen.getByRole('button', { name: 'Retry 1 selected' })).toBeEnabled();
});

it('reuses the target options form registry for Excel exports', () => {
  render(
    <ExportSettingsPanel
      config={{ ...config, target: 'excel', options: {} }}
      onChange={vi.fn()}
      onGenerate={vi.fn()}
      onCancel={vi.fn()}
      status="idle"
    />
  );

  expect(screen.getByTestId('export-target-options')).toBeInTheDocument();
  expect(screen.getByTestId('excel-options-form')).toBeInTheDocument();
});

it('identifies an unavailable imported generator rather than displaying another generator selection', () => {
  render(
    <ExportSettingsPanel
      config={{ ...config, target: 'java' as never }}
      onChange={vi.fn()}
      onGenerate={vi.fn()}
      onCancel={vi.fn()}
      status="idle"
    />
  );
  expect(screen.getByRole('option', { name: 'java — provider unavailable' })).toBeDisabled();
  expect(screen.getByRole('combobox', { name: 'Export target' })).toHaveValue('java');
});

it('keeps unavailable imported targets separate from usable native targets and shows persisted evidence', async () => {
  const { createProjectSnapshot } = await import('@rune-langium/project-config');
  const { validateProjectTarget } = await import('@rune-langium/project-runtime/browser');
  const snapshot = await createProjectSnapshot(
    'imported',
    new Map([
      ['rune-config.yml', 'model: {name: Imported}'],
      [
        'build-config.yml',
        JSON.stringify({
          schemaVersion: 1,
          importReport: 'build-config.import.json',
          targets: {
            java: { generator: 'java', output: 'generated/java' },
            types: { generator: 'json-schema', output: 'generated/types' }
          }
        })
      ],
      [
        'build-config.import.json',
        JSON.stringify({
          schemaVersion: 1,
          provenance: { pomPath: 'pom.xml', profiles: ['pricing'], documents: ['pom.xml'] },
          dependencies: [],
          report: [
            {
              code: 'JAVA_UNAVAILABLE',
              path: 'pom.xml#java',
              message: 'Java SDK provider is unavailable.',
              status: 'unsupported',
              targets: ['java'],
              capabilities: ['java']
            }
          ]
        })
      ]
    ]),
    validateProjectTarget
  );
  const build = vi.fn();
  render(
    <ExportSettingsPanel
      config={config}
      onChange={vi.fn()}
      onGenerate={vi.fn()}
      onCancel={vi.fn()}
      status="idle"
      selectedTargetName="types"
      onBuildTargets={build}
      projectEnabled
      projectSnapshot={snapshot}
      projectDiagnostics={snapshot.project.diagnostics}
    />
  );
  expect(screen.getByRole('tab', { name: 'java', exact: true })).toBeEnabled();
  expect(screen.getByRole('tab', { name: 'types', exact: true })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('button', { name: 'Generate all' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Generate target' })).toBeEnabled();
  await userEvent.click(screen.getByRole('button', { name: 'Generate target' }));
  expect(build).toHaveBeenCalledWith(['types']);
  await userEvent.click(screen.getByText('Saved initialization report', { exact: true }));
  expect(screen.getByText('Java SDK provider is unavailable.')).toBeVisible();
  expect(screen.getByText('Profiles: pricing')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Import Maven' })).not.toBeInTheDocument();
});

for (const selectedTargetName of [undefined, 'b'])
  it(`unblocks Generate all after a dirty target is removed (${selectedTargetName ?? 'one-off'})`, async () => {
    const { createProjectSnapshot } = await import('@rune-langium/project-config');
    const { validateProjectTarget } = await import('@rune-langium/project-runtime/browser');
    const snapshot = (targets: Record<string, unknown>) =>
      createProjectSnapshot(
        'targets',
        new Map([
          ['rune-config.yml', 'model: {name: Targets}'],
          ['build-config.yml', JSON.stringify({ schemaVersion: 1, targets })]
        ]),
        validateProjectTarget
      );
    const a = { generator: 'typescript', output: 'generated/a' };
    const b = { generator: 'typescript', output: 'generated/b' };
    const build = vi.fn();
    const ui = (projectSnapshot: Awaited<ReturnType<typeof snapshot>>) => (
      <ExportSettingsPanel
        config={config}
        onChange={vi.fn()}
        onGenerate={vi.fn()}
        onCancel={vi.fn()}
        status="idle"
        projectEnabled
        projectSnapshot={projectSnapshot}
        selectedTargetName={selectedTargetName}
        dirtyTargets={['a']}
        onBuildTargets={build}
      />
    );
    const view = render(ui(await snapshot({ a, b })));
    expect(screen.getByRole('button', { name: 'Generate all' })).toBeDisabled();
    view.rerender(ui(await snapshot({ b })));
    expect(screen.queryByRole('tab', { name: /a \*/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate all' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Generate all' }));
    expect(build).toHaveBeenCalledWith('all');
  });
