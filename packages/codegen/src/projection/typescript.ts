// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import type { GeneratorOutput } from '../types.js';
import { RUNTIME_HELPER_JS_SOURCE } from '../helpers.js';
import type { EmittedProjection, GeneratedProjection, ProjectionSubject } from './types.js';
import { findProjectionFragment } from './provenance.js';
export { recordedProjection as emittedTypeScriptProjection } from './provenance.js';

const runtimeNames = [
  ...new Set(Array.from(RUNTIME_HELPER_JS_SOURCE.matchAll(/\b(?:const|function) (rune\w*)/g), (match) => match[1]!))
];

/** Select recorded output; display availability is independent of inverse-lens coverage. */
export function selectTypeScriptProjection(
  outputs: readonly GeneratorOutput[],
  subject: ProjectionSubject,
  kind: EmittedProjection['kind'],
  form: 'declaration' | 'body' = 'declaration'
): GeneratedProjection {
  const fragment = findProjectionFragment(
    outputs.flatMap((output) => output.projections ?? []),
    subject,
    kind
  );
  if (!fragment) {
    const error = outputs.flatMap((output) => output.diagnostics).find((entry) => entry.severity === 'error');
    throw new Error(error?.message ?? `No generated ${kind} matches the current source region.`);
  }
  const selected = form === 'body' ? fragment.body : fragment;
  if (!selected) throw new Error(`No generated ${kind} body matches the current source region.`);
  return {
    language: 'typescript',
    subject,
    code: selected.code,
    sourceMap: selected.sourceMap,
    requiredHelpers: runtimeNames.filter((name) => new RegExp(`\\b${name}\\b`).test(selected.code))
  };
}
