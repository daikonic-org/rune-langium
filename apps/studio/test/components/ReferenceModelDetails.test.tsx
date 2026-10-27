// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { afterEach, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type { CuratedManifest } from '@rune-langium/curated-schema';
import { ReferenceModelDetails } from '../../src/components/ReferenceModelDetails.js';
import { referenceFixture } from '../../../../test/helpers/project-reference-fixture.js';
import { projectBytesRevision } from '@rune-langium/project-config';
import { resolveProjectReferences } from '@rune-langium/project-runtime/references';

afterEach(() => vi.unstubAllGlobals());

async function releaseCohorts() {
  const fixture = await referenceFixture();
  const locked = await resolveProjectReferences(fixture.snapshot, fixture.transport, new AbortController().signal);
  expect(locked.diagnostics).toEqual([]);
  const original = fixture.releases.get('cdm')![0]!;
  const variant = {
    ...original,
    cohort: 'cohort-' + 'f'.repeat(64),
    manifest: 'https://mirror.example/curated/cdm/artifacts/cohort-' + 'f'.repeat(64) + '/manifest.json'
  };
  const manifest = {
    ...JSON.parse(new TextDecoder().decode(fixture.artifacts.get(original.manifest)!)),
    cohort: variant.cohort,
    version: '2026-10-24'
  };
  const bytes = new TextEncoder().encode(JSON.stringify(manifest));
  variant.checksum = await projectBytesRevision(bytes);
  fixture.releases.get('cdm')!.push(variant);
  fixture.artifacts.set(variant.manifest, bytes);
  fixture.transport.catalog.mockClear();
  fixture.transport.artifact.mockClear();
  return { ...fixture, lock: locked.lock!, original, variant };
}

it('shows the installed cohort inventory when the same release has newer published cohorts', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({}))
  );
  const fixture = await releaseCohorts();
  render(
    <ReferenceModelDetails
      repository="https://github.com/org/cdm"
      modelId="cdm"
      release="1.0"
      catalog={{ schemaVersion: 1, releases: fixture.releases.get('cdm')! }}
      transport={fixture.transport}
      lock={fixture.lock}
    />
  );
  expect(await screen.findByText('2026-10-23')).toBeVisible();
  expect(screen.queryByText('2026-10-24')).toBeNull();
  expect(fixture.transport.catalog).not.toHaveBeenCalled();
  expect(fixture.transport.artifact.mock.calls.map(([url]) => url)).toEqual([fixture.original.manifest]);
});

it('uses canonical cohort selection for a proposed release with multiple variants without fetching bundles', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({}))
  );
  const fixture = await releaseCohorts();
  render(
    <ReferenceModelDetails
      repository="https://github.com/org/cdm"
      modelId="cdm"
      release="1.0"
      catalog={{ schemaVersion: 1, releases: fixture.releases.get('cdm')! }}
      transport={fixture.transport}
    />
  );
  expect(await screen.findByText('2026-10-24')).toBeVisible();
  expect(fixture.transport.artifact.mock.calls.every(([url]) => url.endsWith('/manifest.json'))).toBe(true);
});

it('shows a public repository description and publication inventory without loading model bytes', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({ description: 'A shared financial domain model.', license: { spdx_id: 'Apache-2.0' } })
    )
  );
  const fixture = await referenceFixture({});
  const manifest = JSON.parse(
    new TextDecoder().decode(fixture.artifacts.get(fixture.releases.get('cdm')![0]!.manifest)!)
  ) as CuratedManifest;
  manifest.namespaces = {
    demo: {
      deps: [],
      exports: [
        { type: 'Data', name: 'Trade' },
        { type: 'RosettaFunction', name: 'Price' }
      ],
      artifact: 'demo.json'
    }
  } as CuratedManifest['namespaces'];
  const nightly = vi.fn(async () => manifest);
  render(
    <ReferenceModelDetails
      repository="https://github.com/org/cdm"
      modelId="cdm"
      release="nightly"
      transport={{ ...fixture.transport, nightly }}
    />
  );
  expect(await screen.findByText('A shared financial domain model.')).toBeVisible();
  expect(await screen.findByText('Namespaces')).toBeVisible();
  expect(screen.getByText('Apache-2.0')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Repository & README' })).toHaveAttribute(
    'href',
    'https://github.com/org/cdm#readme'
  );
  expect(fixture.transport.artifact).not.toHaveBeenCalled();
  expect(nightly).toHaveBeenCalledOnce();
});

it('rejects tampered release inventory through the canonical checksum reader', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({}))
  );
  const fixture = await referenceFixture({});
  const releases = fixture.releases.get('cdm')!;
  fixture.artifacts.set(releases[0]!.manifest, new TextEncoder().encode('{}'));
  render(
    <ReferenceModelDetails
      repository="https://github.com/org/cdm"
      modelId="cdm"
      release={releases[0]!.tag}
      catalog={{ schemaVersion: 1, releases }}
      transport={fixture.transport}
    />
  );
  expect(await screen.findByText('Published inventory is unavailable.')).toBeVisible();
  expect(screen.queryByText('Namespaces')).toBeNull();
});

it('ignores abandoned repository and inventory responses after a selection change', async () => {
  const oldRepository = Promise.withResolvers<Response>();
  const oldInventory = Promise.withResolvers<CuratedManifest>();
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      url.endsWith('/cdm') ? oldRepository.promise : Promise.resolve(Response.json({ description: 'New repository' }))
    )
  );
  const fixture = await referenceFixture({});
  const transport = {
    ...fixture.transport,
    nightly: vi.fn((id: string) => (id === 'cdm' ? oldInventory.promise : Promise.resolve(undefined as never)))
  };
  const { rerender } = render(
    <ReferenceModelDetails
      repository="https://github.com/org/cdm"
      modelId="cdm"
      release="nightly"
      transport={transport}
    />
  );
  rerender(
    <ReferenceModelDetails
      repository="https://github.com/org/other"
      modelId="other"
      release="nightly"
      transport={transport}
    />
  );
  expect(await screen.findByText('New repository')).toBeVisible();
  await act(async () => {
    oldRepository.resolve(Response.json({ description: 'Old repository' }));
    oldInventory.resolve({ modelId: 'cdm', version: 'old-publication' } as CuratedManifest);
  });
  expect(screen.queryByText('Old repository')).toBeNull();
  expect(screen.queryByText('old-publication')).toBeNull();
});
