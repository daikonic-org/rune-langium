// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { z } from 'zod';
import { declarationKey } from '@rune-langium/core/project-contract';
import { SymbolIdentitySchema } from './config-schema.js';
import {
  PortableProjectPathSchema as portablePath,
  portableRecordRoot,
  readPortableRecords
} from './portable-records.js';
import type { ProjectDiagnostic, ProjectSnapshot } from './types.js';

export const ExampleDescriptorSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string().min(1).max(200),
  name: z.string().min(1),
  type: SymbolIdentitySchema,
  payload: portablePath,
  codec: z.string().min(1),
  provenance: z.strictObject({ source: z.string() }).optional(),
  expected: portablePath.optional()
});
export type ExampleDescriptor = z.infer<typeof ExampleDescriptorSchema>;
export interface ExampleDocument {
  descriptorPath: string;
  descriptor: ExampleDescriptor;
  payload?: unknown;
  rawPayload?: string;
}

export function exampleRoot(snapshot: ProjectSnapshot): string | undefined {
  return portableRecordRoot(snapshot, 'examples');
}
/** Shared descriptor/path validation for readers and transactional writers. */
export function parseExampleDescriptor(snapshot: ProjectSnapshot, value: unknown): ExampleDescriptor {
  const root = exampleRoot(snapshot);
  if (!root) throw new Error('Configure a portable examples directory outside private storage.');
  const descriptor = ExampleDescriptorSchema.parse(value);
  if (!descriptor.payload.startsWith(root + '/') || descriptor.payload.endsWith('.example.json'))
    throw new Error('The payload must belong to the configured examples directory.');
  return descriptor;
}
/** Stable-ID names never depend on display names, current selection or browser state. */
export function exampleDescriptorPath(root: string, id: string): string {
  return root + '/example-' + encodeURIComponent(id) + '.example.json';
}
export function examplePayloadPath(root: string, id: string): string {
  return root + '/example-' + encodeURIComponent(id) + '.json';
}

/** Decode only typed descriptors under the configured examples root. Never inspect hidden trees. */
export function readExamples(
  snapshot: ProjectSnapshot,
  knownSymbols?: ReadonlySet<string>
): {
  examples: ExampleDescriptor[];
  documents: ExampleDocument[];
  diagnostics: ProjectDiagnostic[];
} {
  const documents: ExampleDocument[] = [];
  const typed = readPortableRecords(snapshot, {
    root: 'examples',
    extension: '.example.json',
    prefix: 'EXAMPLE',
    parse: (value) => parseExampleDescriptor(snapshot, value)
  });
  const diagnostics: ProjectDiagnostic[] = typed.diagnostics;
  const issue = (code: string, path: string, message: string) =>
    diagnostics.push({ code, path, message, severity: 'error' });
  const result = () => ({ examples: documents.map((entry) => entry.descriptor), documents, diagnostics });
  const ids = new Map<string, string>();
  const payloads = new Map<string, string>();
  for (const { path, value: descriptor } of typed.documents) {
    if (ids.has(descriptor.id))
      issue(
        'EXAMPLE_ID_DUPLICATE',
        path,
        'More than one descriptor has this example ID. Preserve both files and repair their IDs.'
      );
    ids.set(descriptor.id, path);
    const payloadKey = descriptor.payload.toLowerCase();
    if (payloads.has(payloadKey)) issue('EXAMPLE_PAYLOAD_SHARED', path, 'Examples must own separate payload files.');
    payloads.set(payloadKey, path);
    const document: ExampleDocument = { descriptorPath: path, descriptor };
    documents.push(document);
    if (knownSymbols && !knownSymbols.has(declarationKey(descriptor.type)))
      issue(
        'EXAMPLE_TYPE_UNAVAILABLE',
        path,
        `The example type ${descriptor.type.namespace}.${descriptor.type.name} (${descriptor.type.kind}, ${descriptor.type.model}) is unavailable in this project. Its saved payload is retained.`
      );
    const raw = snapshot.files.get(descriptor.payload);
    if (raw === undefined) {
      issue(
        'EXAMPLE_PAYLOAD_MISSING',
        descriptor.payload,
        'The example payload file is missing. Restore it without replacing the descriptor.'
      );
      continue;
    }
    document.rawPayload = raw;
    if (descriptor.codec !== 'JSON' && descriptor.codec !== 'json') {
      issue(
        'EXAMPLE_CODEC_UNAVAILABLE',
        path,
        'This example requires an unavailable codec. Its original payload bytes are retained.'
      );
      continue;
    }
    try {
      document.payload = JSON.parse(raw);
    } catch {
      issue(
        'EXAMPLE_PAYLOAD_INVALID',
        descriptor.payload,
        'The example payload is not valid JSON. Its original bytes are retained.'
      );
    }
  }
  return result();
}
