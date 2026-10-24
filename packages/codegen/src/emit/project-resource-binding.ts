// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import type { TypeCall } from '@rune-langium/core';
import { resolveTypeCallTarget, type TypeIndexLookup, type TypeResolutionVisitor } from './type-ref-resolver.js';
import { projectCodeListForAlias, type ProjectBindingRegistry } from '../runtime/project-bindings.js';
type Codes = readonly { value: string; label: string }[];
/** Observe aliases in the existing type resolver; do not flatten away their external constraints. */
export function resolveProjectTypeCall<T>(
  call: TypeCall | undefined,
  index: TypeIndexLookup,
  visitor: TypeResolutionVisitor<T>,
  sourceUri: string,
  resources: Pick<ProjectBindingRegistry, 'codeListForType'> | undefined,
  constrain: (value: T, codes: Codes) => T
): T {
  if (!resources) return resolveTypeCallTarget(call, index, visitor, sourceUri);
  const lists: Codes[] = [];
  const value = resolveTypeCallTarget(
    call,
    index,
    {
      ...visitor,
      onAlias(alias) {
        visitor.onAlias?.(alias);
        const codes = projectCodeListForAlias(alias, resources);
        if (codes) lists.push(codes);
      }
    },
    sourceUri
  );
  return lists.reduce(constrain, value);
}
export function projectTsCodeList(value: string, codes: Codes): string {
  return `(${value}) & (${codes.map((code) => JSON.stringify(code.value)).join(' | ') || 'never'})`;
}
export function projectZodCodeList(value: string, codes: Codes): string {
  return `${value}.and(${codes.length ? `z.enum(${JSON.stringify(codes.map((code) => code.value))})` : 'z.never()'})`;
}
export function projectJsonCodeList(value: object, codes: Codes): object {
  return { allOf: [value, codes.length ? { enum: codes.map((code) => code.value) } : false] };
}
