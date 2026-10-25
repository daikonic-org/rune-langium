// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { declarationKey } from '@rune-langium/core/project-contract';
import {
  canonicalProjectJson,
  portableRecordRoot,
  readPresentations,
  type PresentationDescriptor
} from '@rune-langium/project-config';
import type { WorkspaceState } from '../shell/providers/workspace-context.js';
import type {
  FormPreferences,
  NumericPresentation,
  ObjectFormLayout,
  PresentationRepository
} from '../store/form-presentation-store.js';
import { workspaceDeclarationIdentities, resolvePresentationType } from './example-identity.js';
import { savePresentation } from './workflow-repository.js';
import type { ProjectController } from './project-controller.js';
import { withInstrumentation } from '../services/instrumentation/core.js';
function numeric(format: PresentationDescriptor['fields'][string]['format']): NumericPresentation | undefined {
  if (!format || !['decimal', 'currency'].includes(format.kind)) return;
  if (format.kind === 'currency' && !format.currency) return;
  return {
    style: format.kind as 'decimal' | 'currency',
    currency: format.currency ?? 'USD',
    grouping: format.grouping !== false,
    ...(format.precision === undefined ? {} : { fractionDigits: format.precision })
  };
}
function portable(format: NumericPresentation) {
  return {
    kind: format.style,
    ...(format.style === 'currency' ? { currency: format.currency } : {}),
    grouping: format.grouping,
    ...(format.fractionDigits === undefined ? {} : { precision: format.fractionDigits })
  };
}
function projectPreferences(presentations: readonly PresentationDescriptor[]): FormPreferences {
  const preferences: FormPreferences = { layouts: {}, formats: {} };
  for (const descriptor of presentations) {
    const key = declarationKey(descriptor.type);
    const fields = Object.entries(descriptor.fields);
    if (
      descriptor.columns !== undefined ||
      fields.some(([, field]) => field.order !== undefined || field.span !== undefined)
    ) {
      const spans: ObjectFormLayout['spans'] = {};
      for (const [name, field] of fields)
        if (field.span === 1 || field.span === 2 || field.span === 3)
          spans[name] = field.span === 3 ? 'full' : field.span;
      preferences.layouts[key] = {
        columns: descriptor.columns === 3 ? 3 : descriptor.columns === 2 ? 2 : 1,
        order: fields
          .filter(([, field]) => field.order !== undefined)
          .sort((a, b) => a[1].order! - b[1].order!)
          .map(([name]) => name),
        spans
      };
    }
    for (const [path, field] of fields) {
      const format = numeric(field.format);
      if (!format) continue;
      if (!path) preferences.formats[key] = format;
      else {
        preferences.fieldFormats ??= {};
        preferences.fieldFormats[key] ??= {};
        preferences.fieldFormats[key][path] = format;
      }
    }
  }
  return preferences;
}
const at = (preferences: FormPreferences, key: string) => ({
  layout: preferences.layouts[key] ?? null,
  format: preferences.formats[key] ?? null,
  fields: preferences.fieldFormats?.[key] ?? null
});
/** Portable files win; browser preferences are only a reviewed migration candidate. */
export const createPresentationRepository = withInstrumentation(
  function createPresentationRepository(input: {
    controller: ProjectController;
    source(): Pick<WorkspaceState, 'files' | 'parsedModels' | 'deferredExports'>;
  }): PresentationRepository {
    let tail: Promise<unknown> = Promise.resolve();
    function enqueue<T>(operation: () => Promise<T>): Promise<T> {
      const next = tail.catch(() => undefined).then(operation);
      tail = next;
      return next;
    }
    return {
      load: () =>
        enqueue(async () => {
          const snapshot = await input.controller.recover();
          const known = new Set(workspaceDeclarationIdentities(input.source()).map(declarationKey));
          const read = readPresentations(snapshot, known);
          const root = portableRecordRoot(snapshot, 'layouts');
          return {
            preferences: projectPreferences(read.presentations),
            diagnostics: read.diagnostics,
            hasFiles:
              !!root &&
              [...snapshot.files.keys()].some((path) => path.startsWith(root + '/') && path.endsWith('.layout.json'))
          };
        }),
      save: (preferences) =>
        enqueue(async () => {
          const snapshot = input.controller
            .diagnostics()
            .some((issue) => ['SAVE_CONFLICT', 'SAVE_UNAVAILABLE'].includes(issue.code))
            ? await input.controller.recover()
            : (input.controller.current() ?? (await input.controller.load()));
          const read = readPresentations(snapshot);
          const before = projectPreferences(read.presentations);
          const types = new Map(
            workspaceDeclarationIdentities(input.source()).map((type) => [declarationKey(type), type])
          );
          for (const descriptor of read.presentations) types.set(declarationKey(descriptor.type), descriptor.type);
          const keys = new Set([
            ...read.presentations.map((entry) => declarationKey(entry.type)),
            ...Object.keys(preferences.layouts),
            ...Object.keys(preferences.formats),
            ...Object.keys(preferences.fieldFormats ?? {})
          ]);
          for (const key of keys) {
            if (canonicalProjectJson(at(before, key)) === canonicalProjectJson(at(preferences, key))) continue;
            const type = types.get(key);
            if (!type) throw new Error('The presentation type is unavailable. Its unsaved preferences are retained.');
            const previous = read.presentations.find((entry) => declarationKey(entry.type) === key);
            const fields = Object.fromEntries(
              Object.entries(previous?.fields ?? {}).map(([path, field]) => [path, { ...field }])
            );
            for (const [path, field] of Object.entries(fields)) {
              delete field.order;
              delete field.span;
              if (numeric(field.format)) delete field.format;
              fields[path] = field;
            }
            const layout = preferences.layouts[key];
            layout?.order.forEach((path, order) => {
              fields[path] = { ...fields[path], order };
            });
            for (const [path, span] of Object.entries(layout?.spans ?? {}))
              fields[path] = { ...fields[path], span: span === 'full' ? 3 : span };
            const format = preferences.formats[key];
            if (format) fields[''] = { ...fields[''], format: portable(format) };
            for (const [path, fieldFormat] of Object.entries(preferences.fieldFormats?.[key] ?? {}))
              fields[path] = { ...fields[path], format: portable(fieldFormat) };
            await savePresentation(input.controller, {
              schemaVersion: 1,
              type,
              fields,
              ...(layout ? { columns: layout.columns } : {})
            });
          }
        }),
      previewLegacy(preferences) {
        const converted: FormPreferences = { layouts: {}, formats: {} };
        const diagnostics: string[] = [];
        const symbols = new Set([...Object.keys(preferences.layouts), ...Object.keys(preferences.formats)]);
        for (const symbol of symbols) {
          const type = resolvePresentationType(input.source(), symbol);
          if (!type) {
            diagnostics.push('No unique type binding for ' + symbol + '. Its browser preference remains unchanged.');
            continue;
          }
          const key = declarationKey(type);
          if (preferences.layouts[symbol]) converted.layouts[key] = preferences.layouts[symbol]!;
          if (preferences.formats[symbol]) converted.formats[key] = preferences.formats[symbol]!;
        }
        return { preferences: converted, diagnostics };
      }
    };
  },
  {
    op: 'createPresentationRepository',
    capture: 0,
    sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' })
  }
);
