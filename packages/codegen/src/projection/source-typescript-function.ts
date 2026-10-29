// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { isCondition, isRosettaExpression, isSwitchOperation } from '@rune-langium/core';
import type { RuneFunc } from '../types/func.js';
import { nativeImplementationExpression, resolveNativeImplementation } from '../implementations/index.js';
import { SourceExpressionRenderer } from './source-typescript-expression.js';
import { expressionIsMany } from '../expr/navigation.js';
import type { ProjectionOrigin, ProjectionImplementation } from './types.js';

export interface SourceFunctionProjection {
  code: string;
  implementation?: ProjectionImplementation;
  origins?: ProjectionOrigin[];
}

/** Render authored function structure independently of executable boundary adapters. */
export function renderSourceTypeScriptFunction(
  func: RuneFunc,
  projectImplementation?: { key: string }
): SourceFunctionProjection {
  const renderer = new SourceExpressionRenderer({ owner: func.source, trackOrigins: false });
  const lines: string[] = [];
  const origins: ProjectionOrigin[] = [];
  const append = (node: unknown): string => {
    if (!isRosettaExpression(node)) throw new Error(`Function ${func.name} has an invalid expression.`);
    const projection = renderer.render(node);
    lines.push(...projection.statements);
    origins.push(projection.origin);
    return projection.code;
  };
  const contracts = (conditions: readonly unknown[]) => {
    for (const condition of conditions) {
      if (!isCondition(condition)) throw new Error(`Function ${func.name} has an invalid condition.`);
      const predicate = append(condition.expression);
      const name = condition.name ? `, ${JSON.stringify(condition.name)}` : '';
      const shadowed = [...func.inputs, ...func.aliases].some((binding) => binding.name === 'assert');
      const runeShadowed = [...func.inputs, ...func.aliases].some((binding) => binding.name === 'rune');
      lines.push(`${shadowed ? (runeShadowed ? '$rune.assert' : 'rune.assert') : 'assert'}(${predicate}${name});`);
    }
  };

  for (const alias of func.aliases) lines.push(`const ${alias.name} = ${append(alias.exprNode)};`);
  contracts(func.preConditions);
  const output = func.output.name;
  if (func.isAbstract) {
    const native =
      !projectImplementation && func.source ? resolveNativeImplementation(func.source, 'typescript') : undefined;
    if (native?.status === 'available') {
      lines.push(
        `const ${output} = ${nativeImplementationExpression(
          native.body,
          func.inputs.map((input) => input.name)
        )};`
      );
      contracts(func.postConditions);
      lines.push(`return ${output};`);
      return {
        code: lines.join('\n'),
        origins,
        implementation: {
          status: 'available',
          language: 'typescript',
          label: 'Bundled TypeScript implementation',
          reference: native.id
        }
      };
    }
    contracts(func.postConditions);
    return {
      code: lines.join('\n'),
      origins,
      implementation: {
        status: projectImplementation ? 'available' : 'unavailable',
        language: 'typescript',
        label: projectImplementation ? 'Project TypeScript implementation' : 'No TypeScript implementation available',
        ...(projectImplementation ? { reference: projectImplementation.key } : {})
      }
    };
  }
  const rootSets = func.assignments.filter(
    (assignment) =>
      assignment.kind === 'set' && !assignment.path?.length && (!assignment.target || assignment.target === output)
  );
  const only = func.assignments[0];
  if (
    func.assignments.length === 1 &&
    only?.kind === 'set' &&
    !only.path?.length &&
    (!only.target || only.target === output) &&
    isSwitchOperation(only.exprNode) &&
    !func.postConditions.length
  ) {
    lines.push(...renderer.switchStatements(only.exprNode));
    return { code: lines.join('\n'), origins };
  }
  const initial = rootSets[0];
  const immediate = initial === only && initial && !isSwitchOperation(initial.exprNode);
  let declared = false;
  if (!immediate) {
    lines.push(`let ${output};`);
    declared = true;
  }
  for (const assignment of func.assignments) {
    if (!isRosettaExpression(assignment.exprNode)) throw new Error(`Function ${func.name} has an invalid assignment.`);
    const root = assignment.target ?? output;
    const path = assignment.path ?? [];
    const target = [root, ...path.map((part) => part.name)].join('.');
    if (assignment.kind === 'set' && isSwitchOperation(assignment.exprNode)) {
      lines.push(...renderer.switchStatements(assignment.exprNode, target));
      continue;
    }
    const expression = append(assignment.exprNode);
    if (assignment.kind === 'add') {
      lines.push(`${target}.push(${expressionIsMany(assignment.exprNode) ? '...' : ''}${expression});`);
    } else if (!declared && !path.length && root === output) {
      lines.push(`${rootSets.length > 1 ? 'let' : 'const'} ${output} = ${expression};`);
      declared = true;
    } else {
      lines.push(`${target} = ${expression};`);
    }
  }
  contracts(func.postConditions);
  lines.push(`return ${output};`);
  return { code: lines.join('\n'), origins };
}
