// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { declarationKey } from '@rune-langium/core/project-contract';
import { serializeProjectData } from '@rune-langium/project-runtime/data';
import {
  canonicalProjectJson,
  exampleRoot,
  exampleDescriptorPath,
  examplePayloadPath,
  parseExampleDescriptor,
  readExamples,
  type ExampleDescriptor,
  type ProjectChange,
  type ProjectDiagnostic,
  type ProjectSnapshot,
  type SymbolIdentity
} from '@rune-langium/project-config';
import type { InstanceRecord } from '@rune-langium/codegen/instances';
import type { ProjectController } from './project-controller.js';
import {
  projectRevisionAt as revision,
  projectConfigurationPreconditions as configurationPreconditions
} from './project-save-inputs.js';
import type { LegacyExampleStorage } from '../opfs/instances-fs.js';
import type { ExampleRepository } from '../store/instance-persistence.js';
import { withInstrumentation } from '../services/instrumentation/core.js';

export const saveExample = withInstrumentation(
  async function saveExample(
    controller: ProjectController,
    input: ExampleDescriptor,
    payload: unknown
  ): Promise<ProjectSnapshot> {
    const snapshot = controller.current() ?? (await controller.load());
    const example = parseExampleDescriptor(snapshot, input);
    const text = serializeProjectData(snapshot, payload, example.codec) + '\n';
    const read = readExamples(snapshot);
    const existing = read.documents.filter((entry) => entry.descriptor.id === example.id);
    if (existing.length > 1) throw new Error('Repair duplicate example IDs before saving.');
    const previous = existing[0];
    const path = previous?.descriptorPath ?? exampleDescriptorPath(exampleRoot(snapshot)!, example.id);
    if (!previous && snapshot.files.has(path))
      throw new Error('The descriptor destination already belongs to another file.');
    if (
      read.documents.some(
        (entry) =>
          entry.descriptor.id !== example.id && entry.descriptor.payload.toLowerCase() === example.payload.toLowerCase()
      )
    )
      throw new Error('Another example owns this payload file.');
    if (snapshot.files.has(example.payload) && previous?.descriptor.payload !== example.payload)
      throw new Error('The payload destination already belongs to another file.');
    const changes: ProjectChange[] = [
      { path: example.payload, text, expectedRevision: await revision(snapshot, example.payload) },
      { path, text: JSON.stringify(example, null, 2) + '\n', expectedRevision: await revision(snapshot, path) }
    ];
    if (previous && previous.descriptor.payload !== example.payload) {
      const oldRevision = await revision(snapshot, previous.descriptor.payload);
      if (oldRevision) changes.push({ path: previous.descriptor.payload, remove: true, expectedRevision: oldRevision });
    }
    return controller.save(changes, await configurationPreconditions(snapshot));
  },
  { op: 'saveExample', capture: 0, sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' }) }
);

export const removeExample = withInstrumentation(
  async function removeExample(controller: ProjectController, id: string): Promise<ProjectSnapshot> {
    const snapshot = controller.current() ?? (await controller.load());
    const read = readExamples(snapshot);
    const entries = read.documents.filter((entry) => entry.descriptor.id === id);
    if (!entries.length) return snapshot;
    if (entries.length !== 1) throw new Error('Repair duplicate example IDs before removing an example.');
    const entry = entries[0]!;
    if (
      read.documents.some(
        (other) =>
          other.descriptor.id !== id &&
          other.descriptor.payload.toLowerCase() === entry.descriptor.payload.toLowerCase()
      )
    )
      throw new Error('Another example shares this payload. Repair the ownership before removing it.');
    const changes: ProjectChange[] = [];
    for (const path of [entry.descriptorPath, entry.descriptor.payload]) {
      const expectedRevision = await revision(snapshot, path);
      if (expectedRevision) changes.push({ path, remove: true, expectedRevision });
    }
    return controller.save(changes, await configurationPreconditions(snapshot));
  },
  { op: 'removeExample', capture: 0, sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' }) }
);

export const migrateLegacyExamples = withInstrumentation(
  async function migrateLegacyExamples(
    controller: ProjectController,
    records: readonly InstanceRecord[],
    options: {
      resolveType(record: InstanceRecord): SymbolIdentity | undefined;
      migratedIds?: ReadonlySet<string>;
      markMigrated(id: string): Promise<void>;
    }
  ): Promise<{ migratedIds: string[]; diagnostics: ProjectDiagnostic[] }> {
    const migratedIds: string[] = [];
    const diagnostics: ProjectDiagnostic[] = [];
    for (const record of records) {
      if (options.migratedIds?.has(record.id)) continue;
      const type = options.resolveType(record);
      if (!type) {
        diagnostics.push({
          code: 'EXAMPLE_TYPE_UNAVAILABLE',
          path: 'legacy:' + record.id,
          severity: 'warning',
          message: 'The saved example type cannot be identified uniquely. Its legacy payload is retained.'
        });
        continue;
      }
      try {
        const snapshot = controller.current() ?? (await controller.load());
        const current = readExamples(snapshot).documents.filter((entry) => entry.descriptor.id === record.id);
        if (current.length) {
          const existing = current[0]!;
          if (
            current.length !== 1 ||
            declarationKey(existing.descriptor.type) !== declarationKey(type) ||
            existing.descriptor.name !== record.name ||
            canonicalProjectJson(existing.payload) !== canonicalProjectJson(record.data)
          )
            throw new Error(
              'A repository example with this ID differs from its legacy record. Both copies are retained.'
            );
        } else {
          const root = exampleRoot(snapshot);
          if (!root) throw new Error('The examples directory is unavailable.');
          await saveExample(
            controller,
            {
              schemaVersion: 1,
              id: record.id,
              name: record.name,
              type,
              payload: examplePayloadPath(root, record.id),
              codec: 'JSON',
              ...(record.provenance?.source
                ? {
                    provenance: {
                      source: record.provenance.source,
                      ...(record.provenance.reference ? { reference: record.provenance.reference } : {})
                    }
                  }
                : {})
            },
            record.data
          );
        }
        // The transaction has completed its payload/descriptor readback before this callback.
        await options.markMigrated(record.id);
        migratedIds.push(record.id);
      } catch (error) {
        diagnostics.push({
          code: 'EXAMPLE_MIGRATION_UNAVAILABLE',
          path: 'legacy:' + record.id,
          severity: 'warning',
          message:
            error instanceof Error ? error.message : 'The legacy example could not be converted. Its data is retained.'
        });
      }
    }
    return { migratedIds, diagnostics };
  },
  {
    op: 'migrateLegacyExamples',
    capture: 0,
    sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' })
  }
);

/** Preserve the internal record API while storing descriptor/payload pairs in the working copy. */
export const createExampleRepository = withInstrumentation(
  function createExampleRepository(input: {
    workspaceId: string;
    controller: ProjectController;
    resolveType(record: InstanceRecord): SymbolIdentity | undefined;
    legacy?: LegacyExampleStorage;
  }): ExampleRepository {
    let tail: Promise<unknown> = Promise.resolve();
    function enqueue<T>(operation: () => Promise<T>): Promise<T> {
      const next = tail.catch(() => undefined).then(operation);
      tail = next;
      return next;
    }
    const snapshot = () =>
      input.controller.diagnostics().some((issue) => ['SAVE_CONFLICT', 'SAVE_UNAVAILABLE'].includes(issue.code))
        ? input.controller.recover()
        : (input.controller.current() ?? input.controller.load());
    return {
      workspaceId: input.workspaceId,
      write: (record) =>
        enqueue(async () => {
          const current = await snapshot();
          const type = record.typeIdentity ?? input.resolveType(record);
          if (!type) throw new Error('This example type is unavailable or ambiguous. Its unsaved data is retained.');
          const previousDocument = readExamples(current).documents.find((entry) => entry.descriptor.id === record.id);
          if (previousDocument && previousDocument.payload === undefined)
            throw new Error('Repair or restore this example payload before saving. Its original bytes are retained.');
          const previous = previousDocument?.descriptor;
          const root = exampleRoot(current);
          if (!root) throw new Error('The examples directory is unavailable.');
          await saveExample(
            input.controller,
            {
              schemaVersion: 1,
              id: record.id,
              name: record.name,
              type,
              payload: previous?.payload ?? examplePayloadPath(root, record.id),
              codec: previous?.codec ?? 'JSON',
              ...(previous?.expected ? { expected: previous.expected } : {}),
              ...(record.provenance?.source
                ? {
                    provenance: {
                      source: record.provenance.source,
                      ...(record.provenance.reference ? { reference: record.provenance.reference } : {})
                    }
                  }
                : {})
            },
            record.data
          );
        }),
      remove: (id) =>
        enqueue(async () => {
          await removeExample(input.controller, id);
        }),
      load: () =>
        enqueue(async () => {
          await input.controller.recover();
          const diagnostics: ProjectDiagnostic[] = [];
          const failures: Record<string, string> = {};
          let legacyRecords: InstanceRecord[] = [];
          let migratedIds: ReadonlySet<string> = new Set();
          if (input.legacy) {
            try {
              const loaded = await input.legacy.load();
              diagnostics.push(...loaded.diagnostics);
              legacyRecords = loaded.records;
              const result = await migrateLegacyExamples(input.controller, legacyRecords, {
                resolveType: (record) => record.typeIdentity ?? input.resolveType(record),
                migratedIds: loaded.migratedIds,
                markMigrated: (id) => input.legacy!.markMigrated(id)
              });
              diagnostics.push(...result.diagnostics);
              migratedIds = new Set([...loaded.migratedIds, ...result.migratedIds]);
            } catch {
              diagnostics.push({
                code: 'LEGACY_EXAMPLES_UNAVAILABLE',
                severity: 'warning',
                path: 'legacy:',
                message:
                  'Legacy example storage is unavailable. Its private files remain unchanged; portable examples are shown.'
              });
            }
          }
          const read = readExamples(await snapshot());
          diagnostics.push(...read.diagnostics);
          const records = new Map<string, InstanceRecord>();
          for (const entry of read.documents) {
            const descriptor = entry.descriptor;
            const type = descriptor.type;
            const typeFqn = type.namespace + '.' + type.name;
            const record: InstanceRecord = {
              id: descriptor.id,
              name: descriptor.name,
              typeFqn,
              typeIdentity: type,
              data: entry.payload,
              createdAt: 0,
              modifiedAt: 0,
              ...(descriptor.provenance
                ? {
                    provenance: {
                      codec: descriptor.codec,
                      source: descriptor.provenance.source,
                      importedAt: 0,
                      ...(descriptor.provenance.reference ? { reference: descriptor.provenance.reference } : {})
                    }
                  }
                : {})
            };
            if (entry.payload === undefined)
              failures[record.id] =
                'Repair or restore this example payload before saving. Its original bytes are retained.';
            const resolved = input.resolveType(record);
            if (!resolved || declarationKey(resolved) !== declarationKey(type))
              diagnostics.push({
                code: 'EXAMPLE_TYPE_UNAVAILABLE',
                severity: 'warning',
                path: entry.descriptorPath,
                message: 'This example type is unavailable. Its saved payload is retained.'
              });
            if (!records.has(record.id)) records.set(record.id, record);
            else failures[record.id] = 'Repair duplicate example IDs before saving.';
          }
          for (const record of legacyRecords) {
            if (migratedIds.has(record.id)) continue;
            if (!records.has(record.id)) records.set(record.id, record);
            failures[record.id] = 'This legacy example has not been converted. Its original data is retained.';
          }
          return { records: [...records.values()], diagnostics, failures };
        })
    };
  },
  {
    op: 'createExampleRepository',
    capture: 0,
    sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' })
  }
);
