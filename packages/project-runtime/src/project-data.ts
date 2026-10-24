// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import type { ProjectSnapshot } from '@rune-langium/project-config';
import { jsonCodec } from '@rune-langium/codegen/instances';

/** Initial registered project data codec. No implicit substitution for unsupported formats. */
export function projectDataCodecStatus(snapshot: ProjectSnapshot, requested?: string) {
  const model = snapshot.project.rune.model as { defaultSerialisationFormat?: unknown } | undefined;
  const configured = model?.defaultSerialisationFormat ?? 'JSON';
  const selected = configured === 'JSON' || configured === 'json' ? (requested ?? configured) : configured;
  const available = selected === 'JSON' || selected === 'json';
  return {
    id: 'codec:' + String(selected),
    status: available ? ('available' as const) : ('unavailable' as const),
    ...(available ? {} : { reason: 'No installed codec supports this configured or requested serialization format.' })
  };
}
function requireJsonCodec(snapshot: ProjectSnapshot, requested?: string) {
  const capability = projectDataCodecStatus(snapshot, requested);
  if (capability.status === 'unavailable') throw new Error(capability.reason + ' (' + capability.id + ')');
}
export function serializeProjectData(snapshot: ProjectSnapshot, value: unknown, requestedCodec?: string): string {
  requireJsonCodec(snapshot, requestedCodec);
  const text = JSON.stringify(value, null, 2);
  if (text === undefined) throw new Error('The JSON codec cannot serialize this value.');
  return text;
}
export function importProjectData(snapshot: ProjectSnapshot, input: string | Uint8Array, target: string) {
  requireJsonCodec(snapshot);
  return jsonCodec.import(input, target);
}
