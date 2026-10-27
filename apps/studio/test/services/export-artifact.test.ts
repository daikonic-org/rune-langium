// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { expect, it } from 'vitest';
import JSZip from 'jszip';
import { runInNewContext } from 'node:vm';
import { handleCodegenDownload } from '../../src/services/codegen-download-handler.js';
import { decodeExportArtifact } from '../../src/services/export-artifact.js';

const source = `namespace test
type Address:
  city string (1..1)
type Party:
  address Address (1..1)
type Unrelated:
  ignored string (1..1)`;

it('records each namespace in a combined model and leaves support files unowned', async () => {
  const response = await handleCodegenDownload({
    request: new Request('http://localhost/api/codegen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files: [
          { path: 'party.rune', content: source },
          { path: 'other.rune', content: 'namespace other\ntype Item:\n name string (1..1)' }
        ],
        target: 'typescript',
        artifactEnvelope: 1,
        options: { typescript: { layout: 'single-file' } }
      })
    })
  });
  const artifact = await decodeExportArtifact(response);
  expect(artifact.manifest.files.find((file) => file.path === 'model.ts')?.namespaces).toEqual(
    expect.arrayContaining(['test', 'other'])
  );
  expect(artifact.manifest.files.find((file) => file.path === 'helpers.ts')?.namespaces).toEqual([]);
});

it('decodes the exact generated artifact envelope for a selected declaration', async () => {
  const response = await handleCodegenDownload({
    request: new Request('http://localhost/api/codegen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files: [{ path: 'party.rune', content: source }],
        target: 'typescript',
        artifactEnvelope: 1,
        options: { typescript: { layout: 'per-namespace' } },
        selection: { namespaces: [], declarations: [{ namespace: 'test', name: 'Party', kind: 'Data' }] }
      })
    })
  });

  expect(response.status).toBe(200);
  expect(response.headers.get('Content-Disposition')).toContain('filename="typescript-output.zip"');
  const artifact = await decodeExportArtifact(response);
  expect(artifact.manifest.files).toHaveLength(1);
  expect(artifact.manifest.files[0]?.namespaces).toEqual(['test']);
  expect(artifact.manifest.resolvedSelection?.explicit).toEqual([{ namespace: 'test', name: 'Party', kind: 'Data' }]);
  expect(artifact.manifest.resolvedSelection?.included).toEqual(
    expect.arrayContaining([
      { namespace: 'test', name: 'Party', kind: 'Data' },
      { namespace: 'test', name: 'Address', kind: 'Data' }
    ])
  );
  expect(artifact.manifest.resolvedSelection?.requiredBy).toEqual({
    '["test","Data","Address"]': ['["test","Data","Party"]']
  });
  expect(artifact.manifest.files[0]?.path).not.toBe('.rune/export.json');
  const file = artifact.manifest.files[0]!;
  const text = await artifact.readText(file.path);
  expect(text).toMatch(/(?:class|interface|type|enum)\s+Address\b/);
  expect(text).toMatch(/(?:class|interface|type|enum)\s+Party\b/);
  expect(text).not.toMatch(/(?:class|interface|type|enum)\s+Unrelated\b/);
});

it('rejects a stale namespace selection instead of returning an empty artifact', async () => {
  const response = await handleCodegenDownload({
    request: new Request('http://localhost/api/codegen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files: [{ path: 'party.rune', content: source }],
        target: 'typescript',
        artifactEnvelope: 1,
        selection: { namespaces: ['deleted.namespace'], declarations: [] }
      })
    })
  });

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toMatchObject({
    diagnostics: [
      {
        severity: 'error',
        code: 'unknown-export-selection',
        message: "Unknown namespace 'deleted.namespace'."
      }
    ]
  });
});

it('rejects manifest paths that are not listed as text files', async () => {
  const response = new Response(
    await new Blob([
      new Uint8Array([80, 75, 5, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    ]).arrayBuffer(),
    { status: 200 }
  );
  await expect(decodeExportArtifact(response)).rejects.toThrow('missing .rune/export.json');
});

it('decodes ZIP bytes returned from a different runtime realm', async () => {
  const zip = new JSZip();
  zip.file('.rune/export.json', JSON.stringify({ version: 1, target: 'typescript', files: [], diagnostics: [] }));
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  const foreignBuffer = runInNewContext('new Uint8Array(bytes).buffer', { bytes: Array.from(bytes) }) as ArrayBuffer;
  const blob = { arrayBuffer: async () => foreignBuffer } as Blob;
  const response = {
    ok: true,
    status: 200,
    headers: new Headers(),
    blob: async () => blob
  } as unknown as Response;

  await expect(decodeExportArtifact(response)).resolves.toMatchObject({
    manifest: { version: 1, files: [] }
  });
});

it('preserves structured diagnostics from a failed export response', async () => {
  const response = new Response(
    JSON.stringify({
      ok: false,
      error: 'Unknown selection',
      diagnostics: [{ severity: 'error', code: 'unknown-export-selection', message: 'Party is unavailable' }]
    }),
    { status: 400, headers: { 'Content-Type': 'application/json' } }
  );

  await expect(decodeExportArtifact(response)).rejects.toMatchObject({
    name: 'CodegenDownloadError',
    message: 'Unknown selection',
    status: 400,
    diagnostics: [{ severity: 'error', code: 'unknown-export-selection', message: 'Party is unavailable' }]
  });
});
it.each(['projectBindings', 'projectResources'])('refuses host-only %s in a JSON request', async (binding) => {
  const response = await handleCodegenDownload({
    request: new Request('https://example.com/api/codegen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files: [{ path: 'test.rosetta', content: 'namespace test\ntype Example:\n value string (1..1)' }],
        target: 'typescript',
        options: { [binding]: {} }
      })
    })
  } as never);
  expect(response.status).toBe(400);
});
