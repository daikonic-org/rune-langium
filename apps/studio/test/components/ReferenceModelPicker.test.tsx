// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryReferenceCache } from '@rune-langium/project-runtime/references';
import { referenceFixture } from '../../../../test/helpers/project-reference-fixture.js';
import { createProjectFileAdapter } from '../../src/workspace/project-file-adapter.js';
import { createProjectController } from '../../src/workspace/project-controller.js';
import { createOpfsRoot } from '../setup/opfs-mock.js';
import {
  WorkspaceActionsContext,
  type WorkspaceActions
} from '../../src/shell/perspectives/workspace-actions-context.js';
import { ReferenceModelPicker } from '../../src/components/ReferenceModelPicker.js';
async function setup(flushWorkspaceSave?: () => Promise<void>) {
  const fixture = await referenceFixture({});
  const transport = {
    ...fixture.transport,
    nightly: vi.fn(async (id: string) => {
      const release = fixture.releases.get(id)![0]!;
      return JSON.parse(new TextDecoder().decode(fixture.artifacts.get(release.manifest)!));
    })
  };
  const adapter = createProjectFileAdapter({
    workspaceId: 'p',
    root: createOpfsRoot() as unknown as FileSystemDirectoryHandle,
    privateRoot: createOpfsRoot() as unknown as FileSystemDirectoryHandle,
    isWritable: () => true
  });
  for (const [path, text] of fixture.snapshot.files) await adapter.write(path, text, null);
  const controller = createProjectController({ workspaceId: 'p', adapter, validateTarget: () => [] });
  await controller.load();
  render(
    <WorkspaceActionsContext value={{ flushWorkspaceSave } as WorkspaceActions}>
      <ReferenceModelPicker
        controller={controller}
        snapshot={controller.current()}
        transport={transport}
        cache={createMemoryReferenceCache()}
      />
    </WorkspaceActionsContext>
  );
  return { ...fixture, transport, controller, adapter, user: userEvent.setup() };
}

it('saves Nightly as a moving workspace preference without creating a lockfile', async () => {
  const { user, controller, adapter } = await setup();
  await user.click(screen.getByRole('button', { name: /CDM \(Common/ }));
  await user.click(await screen.findByRole('combobox', { name: 'Release' }));
  await user.click(await screen.findByRole('option', { name: 'Nightly', exact: true }));
  await user.click(screen.getByRole('button', { name: 'Review change' }));
  await screen.findByRole('heading', { name: 'Review reference change' });
  expect(screen.getByText(/No saved pin, lock/)).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Save reference change' }));
  await waitFor(() => expect(controller.current()!.project.build.references.cdm?.release).toBe('nightly'));
  expect(controller.current()!.lock).toBeUndefined();
  expect(await adapter.read('build-config.lock.json')).toBeUndefined();
});

it('removes the tagged lock when the last pinned reference switches to Nightly', async () => {
  const { user, controller, adapter } = await setup();
  await user.click(screen.getByRole('button', { name: /CDM \(Common/ }));
  for (const release of ['1.0', 'Nightly']) {
    await user.click(await screen.findByRole('combobox', { name: 'Release' }));
    await user.click(await screen.findByRole('option', { name: release, exact: true }));
    await user.click(screen.getByRole('button', { name: 'Review change' }));
    await screen.findByRole('heading', { name: 'Review reference change' });
    await user.click(screen.getByRole('button', { name: 'Save reference change' }));
    await waitFor(() =>
      expect(controller.current()!.project.build.references.cdm?.release).toBe(
        release === 'Nightly' ? 'nightly' : release
      )
    );
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Review reference change' })).toBeNull());
  }
  expect(controller.current()!.lock).toBeUndefined();
  expect(await adapter.read('build-config.lock.json')).toBeUndefined();
});
it('requires an exact release, reviews its dependency origin, and writes only on acceptance', async () => {
  const { user, controller, adapter } = await setup();
  await user.click(screen.getByRole('button', { name: /CDM \(Common/ }));
  const review = screen.getByRole('button', { name: 'Review change' });
  expect(review).toBeDisabled();
  await user.click(await screen.findByRole('combobox', { name: 'Release' }));
  if (screen.getByRole('combobox', { name: 'Release' }).getAttribute('aria-expanded') !== 'true')
    await user.keyboard('{ArrowDown}');
  await user.click(await screen.findByRole('option', { name: '1.0', exact: true }));
  await user.click(review);
  await screen.findByRole('heading', { name: 'Review reference change' });
  expect(screen.getByText(/Required by cdm/)).toBeVisible();
  expect(await adapter.read('build-config.lock.json')).toBeUndefined();
  await user.click(screen.getByRole('button', { name: 'Save reference change' }));
  await waitFor(() => expect(controller.current()!.lock?.references.cdm!.release).toBe('1.0'));
  expect(controller.current()!.lock!.references['rune-dsl']!.release).toBe('1.0');
});
it('canceling a review preserves the old request and a failed catalog can be retried', async () => {
  const { user, controller, transport } = await setup();
  transport.catalog.mockRejectedValueOnce(new Error('Offline catalog unavailable'));
  await user.click(screen.getByRole('button', { name: /CDM \(Common/ }));
  await screen.findByText(/Offline catalog unavailable/);
  await user.click(screen.getByRole('button', { name: 'Retry releases' }));
  const chooser = await screen.findByRole('combobox', { name: 'Release' });
  await user.click(chooser);
  if (chooser.getAttribute('aria-expanded') !== 'true') await user.keyboard('{ArrowDown}');
  await user.click(await screen.findByRole('option', { name: '2.0', exact: true }));
  await user.click(screen.getByRole('button', { name: 'Review change' }));
  await screen.findByRole('heading', { name: 'Review reference change' });
  await user.click(screen.getByRole('button', { name: 'Cancel review' }));
  expect(controller.current()!.project.build.references).toEqual({});
  expect(screen.getByRole('combobox', { name: 'Release' })).toHaveTextContent('2.0');
});
it('hides filtered-out details and restores the selected model after clearing search', async () => {
  const { user } = await setup();
  await user.click(screen.getByRole('button', { name: /CDM \(Common/ }));
  await user.type(screen.getByRole('textbox', { name: 'Search reference models' }), 'missing');
  expect(screen.queryByRole('combobox', { name: 'Release' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Clear search' }));
  expect(screen.getByRole('button', { name: /CDM \(Common/ })).toHaveAttribute('aria-pressed', 'true');
});
it('offers configuration reload for an active invalid project instead of asking to create another workspace', async () => {
  const user = userEvent.setup();
  const recover = vi.fn().mockRejectedValue(new Error('Configuration still invalid. Repair build-config.yml.'));
  render(<ReferenceModelPicker controller={{ recover } as never} />);
  expect(screen.queryByText('Open or create a workspace to save pinned reference releases.')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Reload project configuration' }));
  await screen.findByRole('alert');
  expect(recover).toHaveBeenCalledOnce();
});

it('identifies affected saved files in compatibility review and retains warnings as explicit upgrade choices', async () => {
  const { ReferenceReleaseReview } = await import('../../src/components/ReferenceReleaseReview.js');
  const { snapshot } = await referenceFixture({});
  render(
    <ReferenceReleaseReview
      config={snapshot.project.build}
      lock={{ schemaVersion: 1, configHash: 'a'.repeat(64), toolchain: {}, references: {} }}
      diagnostics={[
        {
          code: 'REFERENCE_SCHEMA_CHANGED',
          severity: 'warning',
          path: 'examples/trade.example.json',
          message: 'The schema for ref.Trade changed.'
        }
      ]}
      busy={false}
      onAccept={() => {}}
      onCancel={() => {}}
    />
  );
  expect(screen.getByText('examples/trade.example.json', { exact: true })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Save reference change' })).toBeEnabled();
});

it('places catalog recovery beside the selected model and hides technical details initially', async () => {
  const fixture = await referenceFixture({});
  fixture.transport.catalog = vi
    .fn()
    .mockRejectedValueOnce(new Error('HTTP 404 /api/catalog/cdm'))
    .mockResolvedValue({ releases: [] });
  render(<ReferenceModelPicker transport={fixture.transport} cache={createMemoryReferenceCache()} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /Common Domain Model/ }));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Could not load releases');
  expect(alert).toHaveTextContent('Your workspace references are unchanged');
  expect(alert.closest('.starter-picker__detail')).toContainElement(
    screen.getByRole('button', { name: 'Retry releases' })
  );
  expect(screen.getByText('HTTP 404 /api/catalog/cdm')).not.toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Retry releases' }));
  expect(await screen.findByText(/No tagged releases/)).toBeVisible();
});

it('builds the selected release proposal from refreshed configuration without canceling its own review', async () => {
  const { user, controller, adapter } = await setup();
  const file = (await adapter.read('build-config.yml'))!;
  const updated = {
    ...controller.current()!.project.build,
    targets: { schema: { generator: 'json-schema', output: 'generated/schema', options: {} } }
  };
  await adapter.write('build-config.yml', JSON.stringify(updated), file.revision);
  await user.click(screen.getByRole('button', { name: /CDM \(Common/ }));
  await user.click(await screen.findByRole('combobox', { name: 'Release' }));
  await user.click(await screen.findByRole('option', { name: '1.0', exact: true }));
  await user.click(screen.getByRole('button', { name: 'Review change' }));
  await screen.findByRole('heading', { name: 'Review reference change' });
  await user.click(screen.getByRole('button', { name: 'Save reference change' }));
  await waitFor(() => expect(controller.current()!.lock?.references.cdm!.release).toBe('1.0'));
  expect(controller.current()!.project.build.targets.schema?.output).toBe('generated/schema');
});

it('waits for pending source Save before preparing a reference review', async () => {
  let finish!: () => void;
  const flush = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  const { user, controller, adapter } = await setup(flush);
  await user.click(screen.getByRole('button', { name: /CDM \(Common/ }));
  await user.click(await screen.findByRole('combobox', { name: 'Release' }));
  await user.click(await screen.findByRole('option', { name: '1.0', exact: true }));
  await user.click(screen.getByRole('button', { name: 'Review change' }));
  expect(screen.queryByRole('heading', { name: 'Review reference change' })).toBeNull();
  await adapter.write('model/pending.rosetta', 'namespace pending\ntype Data:\n value string (1..1)\n', null);
  finish();
  await screen.findByRole('heading', { name: 'Review reference change' });
  expect(controller.current()!.files.get('model/pending.rosetta')).toContain('value string');
});
