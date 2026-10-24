// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { create } from 'zustand';
import { readWorkbenchSettings, writeWorkbenchSettings } from '../shell/workbench-settings.js';
import type { ProjectDiagnostic } from '@rune-langium/project-config';
import { withInstrumentation } from '../services/instrumentation/core.js';

export interface ObjectFormLayout {
  columns: 1 | 2 | 3;
  order: string[];
  spans: Record<string, 1 | 2 | 3 | 'full'>;
}
export interface NumericPresentation {
  style: 'decimal' | 'currency';
  currency: string;
  grouping: boolean;
  fractionDigits?: number;
}
export interface FormPreferences {
  layouts: Record<string, ObjectFormLayout>;
  formats: Record<string, NumericPresentation>;
  fieldFormats?: Record<string, Record<string, NumericPresentation>>;
}
export interface WorkspacePreferences {
  preferences: FormPreferences;
  loaded: boolean;
  revision: number;
  error?: string;
  saving?: boolean;
  editing?: boolean;
  repository?: boolean;
  legacy?: { preferences: FormPreferences; diagnostics: string[] };
  notices?: string[];
}
export interface PresentationRepository {
  load(): Promise<{ preferences: FormPreferences; hasFiles: boolean; diagnostics: readonly ProjectDiagnostic[] }>;
  save(preferences: FormPreferences): Promise<void>;
  previewLegacy(preferences: FormPreferences): { preferences: FormPreferences; diagnostics: string[] };
}
const repositories = new Map<string, PresentationRepository>();

export const canEditFormPresentation = withInstrumentation(
  function canEditFormPresentation(entry: WorkspacePreferences | undefined): boolean {
    return !!entry?.loaded && !(entry.error && entry.revision === 0);
  },
  { op: 'canEditFormPresentation', sanitize: () => ({}) }
);
interface FormPresentationStore {
  workspaces: Record<string, WorkspacePreferences>;
  load(workspaceId?: string): Promise<void>;
  setRepository(workspaceId: string, repository: PresentationRepository | undefined): Promise<void>;
  acceptLegacy(workspaceId: string): Promise<void>;
  update(workspaceId: string | undefined, change: (current: FormPreferences) => FormPreferences): void;
  retry(workspaceId?: string): Promise<void>;
  setEditing(workspaceId: string | undefined, editing: boolean): void;
}
const EMPTY: FormPreferences = { layouts: {}, formats: {} };
const SETTING = 'form-presentation';
export const formWorkspaceKey = withInstrumentation(
  function formWorkspaceKey(workspaceId?: string) {
    return workspaceId ?? ':session';
  },
  { op: 'formWorkspaceKey', sanitize: () => ({}) }
);
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const columns = (value: unknown): value is 1 | 2 | 3 => value === 1 || value === 2 || value === 3;

export const readFormPreferences = withInstrumentation(
  function readFormPreferences(value: unknown): FormPreferences {
    const layouts: FormPreferences['layouts'] = Object.create(null);
    const formats: FormPreferences['formats'] = Object.create(null);
    if (!object(value)) return { layouts, formats };
    if (object(value.layouts))
      for (const [key, layout] of Object.entries(value.layouts)) {
        if (!object(layout) || !columns(layout.columns)) continue;
        const spans: ObjectFormLayout['spans'] = Object.create(null);
        if (object(layout.spans))
          for (const [member, span] of Object.entries(layout.spans)) {
            if (columns(span) || span === 'full') spans[member] = span;
          }
        layouts[key] = {
          columns: layout.columns,
          order: Array.isArray(layout.order)
            ? [...new Set(layout.order.filter((item): item is string => typeof item === 'string'))]
            : [],
          spans
        };
      }
    if (object(value.formats))
      for (const [key, format] of Object.entries(value.formats)) {
        if (!object(format) || (format.style !== 'decimal' && format.style !== 'currency')) continue;
        if (typeof format.currency !== 'string' || !/^[A-Z]{3}$/.test(format.currency)) continue;
        formats[key] = {
          style: format.style,
          currency: format.currency,
          grouping: format.grouping !== false,
          ...(typeof format.fractionDigits === 'number' &&
          Number.isInteger(format.fractionDigits) &&
          format.fractionDigits >= 0 &&
          format.fractionDigits <= 20
            ? { fractionDigits: format.fractionDigits }
            : {})
        };
      }
    return { layouts, formats };
  },
  {
    op: 'readFormPreferences',
    sanitize: () => ({}),
    sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' })
  }
);

export const useFormPresentationStore = create<FormPresentationStore>((set, get) => {
  const persist = async (workspaceId: string, entry: WorkspacePreferences) => {
    const repository = repositories.get(workspaceId);
    try {
      if (repository) await repository.save(entry.preferences);
      else await writeWorkbenchSettings(workspaceId, SETTING, entry.preferences);
      if (repositories.get(workspaceId) === repository && get().workspaces[workspaceId]?.revision === entry.revision)
        set((state) => ({
          workspaces: {
            ...state.workspaces,
            [workspaceId]: { ...state.workspaces[workspaceId]!, error: undefined, saving: false }
          }
        }));
    } catch {
      if (repositories.get(workspaceId) === repository && get().workspaces[workspaceId]?.revision === entry.revision)
        set((state) => ({
          workspaces: {
            ...state.workspaces,
            [workspaceId]: {
              ...state.workspaces[workspaceId]!,
              saving: false,
              error: 'Layout and format changes could not be saved. Retry to keep them in this workspace.'
            }
          }
        }));
    }
  };
  return {
    workspaces: {},
    async setRepository(workspaceId, repository) {
      if (repositories.get(workspaceId) === repository) return;
      if (repository) repositories.set(workspaceId, repository);
      else repositories.delete(workspaceId);
      set((state) => {
        const workspaces = { ...state.workspaces };
        delete workspaces[workspaceId];
        return { workspaces };
      });
      if (repository) await get().load(workspaceId);
    },
    async acceptLegacy(workspaceId) {
      const current = get().workspaces[workspaceId];
      if (!current?.legacy || !repositories.has(workspaceId) || !canEditFormPresentation(current)) return;
      const entry = {
        ...current,
        preferences: current.legacy.preferences,
        revision: current.revision + 1,
        saving: true
      };
      set((state) => ({ workspaces: { ...state.workspaces, [workspaceId]: entry } }));
      await persist(workspaceId, entry);
      const saved = get().workspaces[workspaceId];
      if (saved?.revision === entry.revision && !saved.error)
        set((state) => ({ workspaces: { ...state.workspaces, [workspaceId]: { ...saved, legacy: undefined } } }));
    },
    async load(workspaceId) {
      const key = formWorkspaceKey(workspaceId);
      if (get().workspaces[key]) return;
      const repository = workspaceId ? repositories.get(workspaceId) : undefined;
      const entry: WorkspacePreferences = {
        preferences: EMPTY,
        loaded: !workspaceId,
        revision: 0,
        ...(repository ? { repository: true } : {})
      };
      set((state) => ({ workspaces: { ...state.workspaces, [key]: entry } }));
      if (!workspaceId) return;
      try {
        let restored: FormPreferences;
        let legacy: WorkspacePreferences['legacy'];
        let notices: string[] | undefined;
        if (repository) {
          const result = await repository.load();
          restored = result.preferences;
          notices = result.diagnostics.map((issue) => issue.message);
          if (!result.hasFiles) {
            try {
              const local = readFormPreferences(await readWorkbenchSettings<unknown>(workspaceId, SETTING, EMPTY));
              if (Object.keys(local.layouts).length || Object.keys(local.formats).length)
                legacy = repository.previewLegacy(local);
            } catch {
              notices.push('Browser presentation could not be inspected. Its private settings remain unchanged.');
            }
          }
        } else restored = readFormPreferences(await readWorkbenchSettings<unknown>(workspaceId, SETTING, EMPTY));
        if (get().workspaces[key] === entry)
          set((state) => ({
            workspaces: {
              ...state.workspaces,
              [key]: { ...entry, preferences: restored, legacy, notices, loaded: true }
            }
          }));
      } catch {
        if (get().workspaces[key] === entry)
          set((state) => ({
            workspaces: {
              ...state.workspaces,
              [key]: {
                ...entry,
                loaded: true,
                error: 'Saved form preferences could not be loaded. Retry before editing to restore them.'
              }
            }
          }));
      }
    },
    update(workspaceId, change) {
      const key = formWorkspaceKey(workspaceId);
      const current = get().workspaces[key];
      if (!current || !canEditFormPresentation(current)) return;
      const entry = {
        ...current,
        preferences: change(current.preferences),
        loaded: true,
        revision: current.revision + 1,
        saving: !!workspaceId
      };
      set((state) => ({ workspaces: { ...state.workspaces, [key]: entry } }));
      if (workspaceId) void persist(workspaceId, entry);
    },
    setEditing(workspaceId, editing) {
      const key = formWorkspaceKey(workspaceId);
      const current = get().workspaces[key];
      if (current && canEditFormPresentation(current))
        set((state) => ({ workspaces: { ...state.workspaces, [key]: { ...current, editing } } }));
    },
    async retry(workspaceId) {
      const key = formWorkspaceKey(workspaceId);
      const entry = get().workspaces[key];
      if (!workspaceId || !entry) return;
      // A load failure has no local edits to save; retry the read instead.
      if (entry.revision === 0) {
        set((state) => {
          const workspaces = { ...state.workspaces };
          delete workspaces[key];
          return { workspaces };
        });
        await get().load(workspaceId);
      } else await persist(workspaceId, entry);
    }
  };
});

export const formatPreviewNumber = withInstrumentation(
  function formatPreviewNumber(value: unknown, format: NumericPresentation | undefined): string {
    if ((typeof value !== 'number' && typeof value !== 'string') || value === '') return '';
    if (!format || !Number.isFinite(Number(value))) return String(value);
    return new Intl.NumberFormat(undefined, {
      style: format.style,
      ...(format.style === 'currency' ? { currency: format.currency } : {}),
      useGrouping: format.grouping,
      ...(format.fractionDigits === undefined
        ? {}
        : { minimumFractionDigits: format.fractionDigits, maximumFractionDigits: format.fractionDigits })
    }).format(value as number);
  },
  {
    op: 'formatPreviewNumber',
    sanitize: () => ({}),
    sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' })
  }
);
