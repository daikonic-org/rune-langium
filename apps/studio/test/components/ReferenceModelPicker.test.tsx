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
import { ReferenceModelPicker } from '../../src/components/ReferenceModelPicker.js';
async function setup() {
  const fixture = await referenceFixture({});
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
    <ReferenceModelPicker
      controller={controller}
      snapshot={controller.current()}
      transport={fixture.transport}
      cache={createMemoryReferenceCache()}
    />
  );
  return { ...fixture, controller, adapter, user: userEvent.setup() };
}
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
