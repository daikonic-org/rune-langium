// SPDX-License-Identifier: MIT

import type { z } from 'zod';
import type { ValidationDiagnostic } from './bundle.js';

export function formatIssuePath(path: ReadonlyArray<PropertyKey>): string {
  return path
    .filter((segment): segment is string | number => typeof segment === 'string' || typeof segment === 'number')
    .map((part) => (typeof part === 'number' ? `[${part}]` : String(part)))
    .join('.')
    .replace(/\.\[/g, '[');
}

/** Keep the validator's alternatives; a failed union is one issue, not many guessed failures. */
export function translateValidationIssues(
  issues: z.ZodError['issues'],
  activeConditionNames: readonly string[] = []
): ValidationDiagnostic[] {
  const names = new Set(activeConditionNames);
  return issues.map((issue) => {
    const first = issue.path[0];
    const conditionName =
      issue.path.length === 0
        ? activeConditionNames.length === 1
          ? activeConditionNames[0]
          : undefined
        : typeof first === 'string' && names.has(first)
          ? first
          : undefined;
    if (conditionName && issue.message.startsWith(conditionName))
      return { path: conditionName, message: issue.message, conditionName };
    const alternatives =
      issue.code === 'invalid_union'
        ? issue.errors.map((branch) =>
            branch.flatMap((nested) => {
              // Zod union branch paths are relative to the failed union's path.
              const translated = translateValidationIssues([{ ...nested, path: [...issue.path, ...nested.path] }]);
              return translated.flatMap(
                (diagnostic) =>
                  diagnostic.alternatives?.flat() ?? [{ path: diagnostic.path, message: diagnostic.message }]
              );
            })
          )
        : undefined;
    return { path: formatIssuePath(issue.path), message: issue.message, ...(alternatives && { alternatives }) };
  });
}
