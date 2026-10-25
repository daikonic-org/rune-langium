// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { parseInstanceRecord, sha256Hex, type InstanceRecord } from '@rune-langium/codegen/instances';
import type { ProjectDiagnostic } from '@rune-langium/project-config';
import type { OpfsFs } from './opfs-fs.js';
import { withInstrumentation, Capture } from '../services/instrumentation/core.js';

export interface InstanceIndexEntry {
  id: string;
  name: string;
  typeFqn: string;
  modifiedAt: number;
}

function instancesDir(workspaceRoot: string): string {
  return `${workspaceRoot}/.studio/instances`;
}

function instancePath(workspaceRoot: string, id: string): string {
  return `${instancesDir(workspaceRoot)}/${id}.json`;
}

function indexPath(workspaceRoot: string): string {
  return `${instancesDir(workspaceRoot)}/index.json`;
}

// `record` carries actual user-entered instance field values — never
// captured; `workspaceRoot`/`record.id` are safe structural identifiers.
export const writeInstance = withInstrumentation(
  async function writeInstance(fs: OpfsFs, workspaceRoot: string, record: InstanceRecord): Promise<void> {
    await fs.mkdir(instancesDir(workspaceRoot));
    await fs.writeFile(instancePath(workspaceRoot, record.id), JSON.stringify(record, null, 2));
  },
  {
    op: 'writeInstance',
    capture: Capture.Input,
    sanitize: (value, which) => {
      if (which !== 'input') return undefined;
      const [, workspaceRoot, record] = value as [OpfsFs, string, InstanceRecord];
      return { workspaceRoot, id: record.id };
    }
  }
);

// Output carries real instance field values — never captured.
export const readInstance = withInstrumentation(
  async function readInstance(fs: OpfsFs, workspaceRoot: string, id: string): Promise<InstanceRecord> {
    return (await readInstanceBytes(fs, workspaceRoot, id)).record;
  },
  {
    op: 'readInstance',
    capture: Capture.Input,
    sanitize: (value, which) => {
      if (which !== 'input') return undefined;
      const [, workspaceRoot, id] = value as [OpfsFs, string, string];
      return { workspaceRoot, id };
    }
  }
);

export const deleteInstance = withInstrumentation(
  async function deleteInstance(fs: OpfsFs, workspaceRoot: string, id: string): Promise<void> {
    await fs.unlink(instancePath(workspaceRoot, id));
  },
  {
    op: 'deleteInstance',
    capture: Capture.Input,
    sanitize: (value, which) => {
      if (which !== 'input') return undefined;
      const [, workspaceRoot, id] = value as [OpfsFs, string, string];
      return { workspaceRoot, id };
    }
  }
);

// Entries carry `name`/`typeFqn` — user-defined, not confidently curated —
// never captured; only a count.
export const readInstanceIndex = withInstrumentation(
  async function readInstanceIndex(fs: OpfsFs, workspaceRoot: string): Promise<InstanceIndexEntry[]> {
    try {
      const raw = await fs.readFile(indexPath(workspaceRoot), 'utf8');
      return JSON.parse(raw as string) as InstanceIndexEntry[];
    } catch {
      return [];
    }
  },
  {
    op: 'readInstanceIndex',
    capture: Capture.Output,
    sanitize: (value, which) => (which === 'output' && Array.isArray(value) ? { count: value.length } : undefined)
  }
);

export const writeInstanceIndex = withInstrumentation(
  async function writeInstanceIndex(fs: OpfsFs, workspaceRoot: string, entries: InstanceIndexEntry[]): Promise<void> {
    await fs.mkdir(instancesDir(workspaceRoot));
    await fs.writeFile(indexPath(workspaceRoot), JSON.stringify(entries, null, 2));
  },
  {
    op: 'writeInstanceIndex',
    capture: Capture.Input,
    sanitize: (value, which) => {
      if (which !== 'input') return undefined;
      const [, , entries] = value as [OpfsFs, string, InstanceIndexEntry[]];
      return { count: entries.length };
    }
  }
);

// Filenames are `<ulid>.json` — structural ids, safe.
export const listInstanceFiles = withInstrumentation(
  async function listInstanceFiles(fs: OpfsFs, workspaceRoot: string): Promise<string[]> {
    try {
      return (await fs.readdir(instancesDir(workspaceRoot))).filter(
        (name) => name.endsWith('.json') && name !== 'index.json'
      );
    } catch {
      return [];
    }
  },
  {
    op: 'listInstanceFiles',
    capture: Capture.Output,
    sanitize: (value, which) => (which === 'output' ? value : undefined)
  }
);

async function readInstanceBytes(fs: OpfsFs, workspaceRoot: string, id: string) {
  if (!id || /[/\\]/.test(id) || id === '.' || id === '..') throw new Error('Invalid example ID.');
  const bytes = (await fs.readFile(instancePath(workspaceRoot, id))) as Uint8Array;
  const record = parseInstanceRecord(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (record.id !== id) throw new Error('The example ID does not match its legacy file.');
  return { record, bytes };
}
async function readInstanceSnapshot(fs: OpfsFs, workspaceRoot: string, id: string) {
  const { record, bytes } = await readInstanceBytes(fs, workspaceRoot, id);
  return { record, revision: await sha256Hex(bytes) };
}

export interface LegacyExampleStorage {
  load(): Promise<{ records: InstanceRecord[]; migratedIds: ReadonlySet<string>; diagnostics: ProjectDiagnostic[] }>;
  markMigrated(id: string): Promise<void>;
}

/** Read only the old typed records. Migration never copies private workspace trees. */
export const createLegacyExampleStorage = withInstrumentation(
  function createLegacyExampleStorage(
    fs: OpfsFs,
    workspaceRoot: string,
    ownsWorkspace: () => boolean
  ): LegacyExampleStorage {
    const inspected = new Map<string, string>();
    const markerPath = `${workspaceRoot}/.studio/example-migrations.json`;
    async function readMarker(): Promise<Set<string>> {
      try {
        const parsed: unknown = JSON.parse((await fs.readFile(markerPath, 'utf8')) as string);
        if (
          !parsed ||
          typeof parsed !== 'object' ||
          !('schemaVersion' in parsed) ||
          parsed.schemaVersion !== 1 ||
          !('migratedIds' in parsed) ||
          !Array.isArray(parsed.migratedIds) ||
          parsed.migratedIds.some((id: unknown) => typeof id !== 'string')
        )
          throw new Error('Invalid example migration marker.');
        return new Set(parsed.migratedIds as string[]);
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return new Set();
        throw error;
      }
    }
    return {
      async load() {
        inspected.clear();
        const records: InstanceRecord[] = [];
        const diagnostics: ProjectDiagnostic[] = [];
        const migratedIds = await readMarker();
        let names: string[];
        try {
          names = await fs.readdir(instancesDir(workspaceRoot));
        } catch (error) {
          if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') names = [];
          else throw error;
        }
        for (const file of names.filter((name) => name.endsWith('.json') && name !== 'index.json')) {
          try {
            const id = file.slice(0, -5);
            const result = await readInstanceSnapshot(fs, workspaceRoot, id);
            inspected.set(id, result.revision);
            records.push(result.record);
          } catch {
            diagnostics.push({
              code: 'legacy-example-invalid',
              severity: 'warning',
              path: `${instancesDir(workspaceRoot)}/${file}`,
              message: 'This legacy example could not be decoded. Its original file has been retained.'
            });
          }
        }
        return { records, migratedIds, diagnostics };
      },
      async markMigrated(id) {
        if (!ownsWorkspace()) throw new Error('The example workspace is no longer active.');
        const original = inspected.get(id);
        if (!original || (await readInstanceSnapshot(fs, workspaceRoot, id)).revision !== original) {
          throw new Error('The legacy example changed during migration.');
        }
        const migratedIds = await readMarker();
        migratedIds.add(id);
        if (!ownsWorkspace()) throw new Error('The example workspace is no longer active.');
        await fs.writeFile(markerPath, JSON.stringify({ schemaVersion: 1, migratedIds: [...migratedIds].sort() }));
        if (!ownsWorkspace() || !(await readMarker()).has(id))
          throw new Error('The example migration marker was not saved.');
      }
    };
  },
  {
    op: 'createLegacyExampleStorage',
    capture: 0,
    sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' })
  }
);
