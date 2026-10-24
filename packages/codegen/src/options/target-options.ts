// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { IMPLEMENTED_TARGETS } from '../generator.js';
import { TARGET_DESCRIPTORS } from '../types.js';
import { TARGET_LAYOUT_SCHEMAS, TARGET_OPTIONS_SCHEMAS } from './target-options-schema.js';

export { TARGET_OPTIONS_SCHEMAS } from './target-options-schema.js';
export function getGeneratorCapabilities(): ReadonlyArray<{ id: string; available: boolean }> {
  const implemented = new Set<string>(IMPLEMENTED_TARGETS);
  return Object.keys(TARGET_DESCRIPTORS).map((id) => ({ id, available: implemented.has(id) }));
}
export function getTargetLayouts(target: string): readonly string[] {
  if (!Object.prototype.hasOwnProperty.call(TARGET_LAYOUT_SCHEMAS, target)) return [];
  return TARGET_LAYOUT_SCHEMAS[target as keyof typeof TARGET_LAYOUT_SCHEMAS].options;
}
export function validateTargetOptions(
  target: string,
  options: unknown
): { value?: Record<string, unknown>; errors: string[] } {
  if (!getGeneratorCapabilities().some((entry) => entry.id === target && entry.available))
    return { errors: ['Generator is not available: ' + target] };
  const schema = TARGET_OPTIONS_SCHEMAS[target as keyof typeof TARGET_OPTIONS_SCHEMAS];
  const result = schema.strict().safeParse(options);
  return result.success
    ? { value: result.data, errors: [] }
    : { errors: result.error.issues.map((issue) => (issue.path.join('.') || 'options') + ': ' + issue.message) };
}
