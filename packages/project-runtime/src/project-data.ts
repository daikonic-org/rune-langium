// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import type { LangiumDocument } from 'langium';
import { adaptPreviewData, projectRuneJsonData } from '@rune-langium/codegen/export';
import type { ProjectSnapshot } from '@rune-langium/project-config';
import { jsonCodec, runeJsonCodec } from '@rune-langium/codegen/instances';

import { projectDataFormat, serializeProjectPayload } from '@rune-langium/core/serialization';

/** Registered project data codec. No implicit substitution for unsupported formats. */
export function projectDataCodecStatus(snapshot: ProjectSnapshot, requested?: string) {
  const model = snapshot.project.rune.model as { defaultSerialisationFormat?: unknown } | undefined;
  const configured = model?.defaultSerialisationFormat ?? 'JSON';
  const selected =
    typeof configured === 'string' && projectDataFormat(configured) ? (requested ?? configured) : configured;
  const available = typeof selected === 'string' && projectDataFormat(selected) !== undefined;
  return {
    id: 'codec:' + String(selected),
    status: available ? ('available' as const) : ('unavailable' as const),
    ...(available ? {} : { reason: 'No installed codec supports this configured or requested serialization format.' })
  };
}
function requireDataCodec(snapshot: ProjectSnapshot, requested?: string) {
  const capability = projectDataCodecStatus(snapshot, requested);
  if (capability.status === 'unavailable') throw new Error(capability.reason + ' (' + capability.id + ')');
}
export interface ProjectDataContext {
  documents: LangiumDocument[];
  typeFqn: string;
  model: string;
  version: string;
}
/** Full object Rune serialization requires explicit linked type/model/version context. */
export function serializeProjectData(
  snapshot: ProjectSnapshot,
  value: unknown,
  requestedCodec?: string,
  context?: ProjectDataContext
): string {
  requireDataCodec(snapshot, requestedCodec);
  const format =
    requestedCodec ??
    (snapshot.project.rune.model as { defaultSerialisationFormat?: string } | undefined)?.defaultSerialisationFormat ??
    'JSON';
  if (projectDataFormat(format) === 'RUNE_JSON' && context) {
    const projected = projectRuneJsonData(context.documents, context.typeFqn, value);
    if (!projected || typeof projected !== 'object' || Array.isArray(projected))
      throw new Error('Rune object serialization requires a typed object.');
    return serializeProjectPayload({ ...projected, '@model': context.model, '@version': context.version }, format);
  }
  return serializeProjectPayload(value, format);
}

export function importProjectData(
  snapshot: ProjectSnapshot,
  input: string | Uint8Array,
  target: string,
  documents?: LangiumDocument[]
) {
  requireDataCodec(snapshot);
  const format =
    (snapshot.project.rune.model as { defaultSerialisationFormat?: string } | undefined)?.defaultSerialisationFormat ??
    'JSON';
  const result = (projectDataFormat(format) === 'RUNE_JSON' ? runeJsonCodec : jsonCodec).import(input, target);
  if (!documents || result.diagnostics.length) return result;
  try {
    return { ...result, data: adaptPreviewData(documents, target, result.data).data };
  } catch (error) {
    return {
      data: undefined,
      diagnostics: [
        { kind: 'identity-mismatch' as const, message: error instanceof Error ? error.message : String(error) }
      ]
    };
  }
}
