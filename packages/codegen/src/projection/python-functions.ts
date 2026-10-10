// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { AstUtils, type AstNode, type LangiumDocument } from 'langium';
import {
  isCondition,
  isData,
  isChoice,
  isRosettaEnumeration,
  isRosettaModel,
  isRosettaFunction,
  type RosettaFunction,
  type Condition,
  type RosettaExpression,
  type Attribute
} from '@rune-langium/core';
import {
  extractFuncs,
  functionInputs,
  functionOutput,
  functionSignature,
  type RuneFuncAssignment
} from '../types/func.js';
import { expressionMetadataKind } from '../expr/metadata-type.js';
import { declaredScalarKind, requiredScalarKind } from '../expr/scalar-operators.js';
import { expressionFitsCardinality } from '../expr/cardinality.js';
import { fieldMetadataKind, metadataPropertyPath } from '../expr/metadata-runtime.js';
import { typeFeatures, featureName, resolveType, type ExpressionType } from '../expr/navigation.js';
import { recordedProjection, findProjectionFragment } from './provenance.js';
import { renderPythonExpression } from './python.js';
import {
  pythonRead,
  pythonUnwrap,
  pythonHelperDependencies,
  pyString,
  pyBool,
  type PythonRenderContext
} from './python-operations.js';
import { pythonFieldType, pythonFieldNormalizer, pythonTypedDict, pythonTypeDeclarations } from './python-types.js';
import { PYTHON_RUNTIME_SOURCE } from './python-runtime.js';
import type { PythonProjectionContext } from './context.js';
import type { EmittedProjection, GeneratedProjection, ProjectionSubject } from './types.js';

export interface PythonModule {
  code: string;
  projections: EmittedProjection[];
  bindings: ReadonlyMap<string, string>;
}

const reserved = new Set(
  'False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case type Any Callable TypedDict NotRequired Literal math re calendar date time datetime timedelta timezone ZoneInfo reduce cmp_to_key input bool float int str list dict len sum min max sorted range enumerate map set tuple all any next isinstance globals ValueError TypeError OverflowError abs callable divmod reversed repr staticmethod'.split(
    ' '
  )
);
for (const match of PYTHON_RUNTIME_SOURCE.matchAll(/^def (\w+)\(/gm)) reserved.add(match[1]!);
for (const match of PYTHON_RUNTIME_SOURCE.matchAll(/^class (\w+)(?:[[(]|:)/gm)) reserved.add(match[1]!);

function identifier(name: string, used: Set<string>): string {
  let base = name.replace(/[^a-zA-Z0-9_]/g, '_');
  if (!/^[a-zA-Z_]/.test(base) || reserved.has(base) || base.startsWith('_rune')) base = `rune_decl_${base}`;
  let candidate = base,
    index = 2;
  while (used.has(candidate)) candidate = `${base}_${index++}`;
  used.add(candidate);
  return candidate;
}

function qualified(node: AstNode & { name: string }): string {
  const model = AstUtils.getContainerOfType(node, isRosettaModel);
  return `${model?.name ?? ''}.${node.name}`;
}

export function createPythonProjectionContext(
  documents: readonly LangiumDocument[],
  subject: ProjectionSubject
): PythonProjectionContext {
  const names = new Map<AstNode, string>(),
    groups = new Map<string, string>(),
    used = new Set(reserved),
    inputs = new Map<string, string>();
  const name = (node: AstNode) => {
    const known = names.get(node);
    if (known) return known;
    if (isCondition(node)) {
      const allocated = identifier(
        `${name(node.$container)}_${node.name ?? 'condition'}_${node.$containerProperty}_${node.$containerIndex ?? 0}`,
        used
      );
      names.set(node, allocated);
      return allocated;
    }
    if (!('name' in node) || typeof node.name !== 'string') throw new Error(`Unnamed Python declaration ${node.$type}`);
    const key = `${node.$type}:${qualified(node as AstNode & { name: string })}`;
    const allocated = groups.get(key) ?? identifier(node.name, used);
    groups.set(key, allocated);
    names.set(node, allocated);
    return allocated;
  };
  for (const document of documents) {
    const model = document.parseResult.value;
    if (isRosettaModel(model)) for (const node of model.elements) if ('name' in node) name(node);
  }
  const namespaces = new Map<string, LangiumDocument[]>();
  for (const document of documents) {
    const model = document.parseResult.value;
    if (isRosettaModel(model)) namespaces.set(model.name, [...(namespaces.get(model.name) ?? []), document]);
  }
  const functionFacts = new Map<RosettaFunction, ReturnType<typeof extractFuncs>[number]>();
  for (const [namespace, docs] of namespaces)
    for (const facts of extractFuncs(docs, namespace, [])) if (facts.source) functionFacts.set(facts.source, facts);
  return {
    documents,
    subject,
    self: 'input',
    locals: new Map(),
    name,
    globalNames: used,
    functionFacts,
    functions: [...functionFacts.keys()],
    inputName(func) {
      const key = qualified(func);
      const allocated = inputs.get(key) ?? identifier(`${name(func)}_Input`, used);
      inputs.set(key, allocated);
      return allocated;
    }
  };
}

function projection(
  node: AstNode,
  context: PythonProjectionContext,
  code: string,
  kind: EmittedProjection['kind'],
  body?: string
): GeneratedProjection {
  const recorded = recordedProjection(node, code, kind, body);
  if (!recorded) throw new Error('Python projection requires original source coordinates.');
  return {
    language: 'python',
    subject: context.subject,
    code,
    sourceMap: recorded.sourceMap,
    body: recorded.body,
    requiredHelpers: pythonHelperDependencies(code)
  };
}

function assignmentLines(
  assignment: RuneFuncAssignment,
  context: PythonRenderContext,
  roots: ReadonlyMap<string, string>
): string[] {
  const expression = assignment.exprNode as RosettaExpression;
  const many = assignment.targetMany ?? false;
  const value = renderPythonExpression(expression, { ...context, preserveMetadata: true });
  const root = roots.get(assignment.target ?? '');
  if (!root) throw new Error(`Unresolved Python assignment root '${assignment.target ?? ''}'`);
  const bounds = assignment.targetCardinality;
  const normalized =
    !many && !assignment.metadataKind && requiredScalarKind(expression)
      ? value
      : `rune.assignmentValue(${value}, ${pyString(expressionMetadataKind(expression) ?? 'value')}, ${pyString(assignment.metadataKind ?? 'value')}, ${pyBool(many)})`;
  const path = assignment.path ?? [];
  if (!path.length)
    return [`${root} = ${assignment.kind === 'add' ? `rune.list(${root}) + rune.list(${normalized})` : normalized}`];
  const segments = path.map(
    (segment) =>
      `{${[
        `"name": ${pyString(segment.name)}`,
        `"many": ${pyBool(segment.many)}`,
        `"kind": ${pyString(segment.metadataKind ?? 'value')}`,
        ...(segment.metadataEntry
          ? [`"metadata": [${metadataPropertyPath(segment.metadataEntry).map(pyString).join(', ')}]`]
          : [])
      ].join(', ')}}`
  );
  return [
    `${root} = rune.assign(${root}, [${segments.join(', ')}], ${normalized}, ${pyBool(assignment.kind === 'add')}, ${pyBool(assignment.rootMany ?? false)}, ${pyString(assignment.rootMetadataKind ?? 'value')}, ${bounds?.lower ?? 0}, ${bounds?.upper ?? 'None'}, ${pyString(`Assignment '${assignment.target}'`)})`
  ];
}

function normalizeInput(inputs: readonly Attribute[], context: PythonProjectionContext): string {
  return `input = rune.normalizeObject(input, {${inputs.map((input) => `${pyString(input.name)}: ${pythonFieldNormalizer(input, context)}`).join(', ')}})`;
}

function inputsRequiringNormalization(inputs: readonly Attribute[]): Attribute[] {
  return inputs.filter((input) => !declaredScalarKind(input.typeCall) || fieldMetadataKind(input));
}

/** Complete implementation; the inverse Python lens retains its narrower expression contract. */
export function projectPythonFunction(func: RosettaFunction, context: PythonProjectionContext): GeneratedProjection {
  const model = AstUtils.getContainerOfType(func, isRosettaModel);
  const declarations =
    context.functions ??
    context.documents.flatMap((document) =>
      isRosettaModel(document.parseResult.value) ? document.parseResult.value.elements.filter(isRosettaFunction) : []
    );
  const signature = functionSignature(func, declarations),
    inputs = functionInputs(signature),
    output = functionOutput(signature);
  if (!output) throw new Error(`Function '${func.name}' has no output declaration.`);
  const facts =
    context.functionFacts?.get(func) ??
    extractFuncs(
      context.documents.filter((document) => document.parseResult.value === model),
      model?.name ?? '',
      []
    ).find((entry) => entry.source === func);
  if (!facts) throw new Error(`Function '${func.name}' is not in the projection workspace.`);
  const name = context.name(func),
    locals = new Map(context.locals),
    roots = new Map<string, string>();
  const used = new Set(context.globalNames ?? [...reserved, ...declarations.map((node) => context.name(node))]);
  const result = identifier(output.name, used),
    outputMany = output.card.unbounded || (output.card.sup ?? 1) > 1;
  locals.set(output, result);
  roots.set(output.name, result);
  for (const input of inputs) {
    const read =
      declaredScalarKind(input.typeCall) && !fieldMetadataKind(input)
        ? input.card.inf > 0
          ? `input[${pyString(input.name)}]`
          : `input.get(${pyString(input.name)})`
        : pythonRead('input', [input.name]);
    locals.set(input, read);
    roots.set(input.name, `input[${pyString(input.name)}]`);
  }
  const renderContext: PythonRenderContext = {
    ...context,
    locals,
    self: 'input',
    resultMode: 'function',
    superFunction: func.superFunction?.ref,
    state: { next: 0 }
  };
  const normalizedInputs = inputsRequiringNormalization(inputs);
  const finish = (lines: string[]) => {
    const code = `def ${name}(input: ${context.inputName?.(func) ?? name + '_Input'}) -> ${pythonFieldType(output, context)}:\n${lines.map((line) => '    ' + line).join('\n')}\n`;
    return projection(func, context, code, 'function', lines.join('\n'));
  };
  const single = facts.assignments[0];
  if (
    !facts.isAbstract &&
    !normalizedInputs.length &&
    facts.assignments.length === 1 &&
    single?.kind === 'set' &&
    !single.path?.length &&
    (!single.target || single.target === output.name) &&
    !fieldMetadataKind(output) &&
    !func.shortcuts.length &&
    !func.conditions.length &&
    !func.postConditions.length &&
    expressionFitsCardinality(single.exprNode as RosettaExpression, facts.output.cardinality)
  ) {
    return finish([`return ${renderPythonExpression(single.exprNode as RosettaExpression, renderContext)}`]);
  }
  const lines: string[] = normalizedInputs.length ? [normalizeInput(normalizedInputs, context)] : [];
  for (const input of normalizedInputs)
    lines.push(
      `input[${pyString(input.name)}] = rune.cardinality(input.get(${pyString(input.name)}), ${input.card.inf}, ${input.card.unbounded ? 'None' : (input.card.sup ?? 1)}, ${pyString(`Argument '${input.name}'`)})`
    );
  const outputType = pythonFieldType(output, context);
  const accumulatorType = outputMany || outputType.includes(' | None') ? outputType : `${outputType} | None`;
  lines.push(`${result}: ${accumulatorType} = ${outputMany ? '[]' : 'None'}`);
  for (const alias of func.shortcuts) {
    const local = identifier(alias.name, used);
    const text = renderPythonExpression(alias.expression, { ...renderContext, preserveMetadata: true });
    lines.push(`${local} = ${text}`);
    locals.set(alias, local);
    roots.set(alias.name, local);
  }
  const check = (condition: Condition) => {
    const predicate = renderPythonExpression(condition.expression, {
      ...renderContext,
      preserveMetadata: false,
      resultMode: 'condition'
    });
    const guard = [
      `if not (${predicate}):`,
      `    raise ValueError(${pyString(`Diagnostic: ${condition.name ?? func.name}`)})`
    ];
    lines.push(...guard);
    context.onConditionProjection?.(condition, guard.join('\n'), predicate);
  };
  func.conditions.forEach(check);
  if (facts.isAbstract) lines.push(`${result} = rune.native(${pyString(qualified(func))}, input)`);
  else for (const assignment of facts.assignments) lines.push(...assignmentLines(assignment, renderContext, roots));
  lines.push(
    `${result} = rune.cardinality(${result}, ${output.card.inf}, ${output.card.unbounded ? 'None' : (output.card.sup ?? 1)}, ${pyString(`Function '${func.name}' produced`)})`
  );
  func.postConditions.forEach(check);
  lines.push(`return ${result}`);
  return finish(lines);
}

function pythonDataContext(context: PythonProjectionContext, type: ExpressionType | undefined): PythonRenderContext {
  const locals = new Map(context.locals);
  for (const field of typeFeatures(type)) locals.set(field, pythonRead('data', [featureName(field)]));
  return {
    ...context,
    locals,
    self: 'data',
    implicit: { name: 'data', type },
    resultMode: 'condition',
    state: { next: 0 }
  };
}

export function projectPythonCondition(condition: Condition, context: PythonProjectionContext): GeneratedProjection {
  const owner = condition.$container;
  if (isRosettaFunction(owner)) {
    let guard: string | undefined, predicate: string | undefined;
    projectPythonFunction(owner, {
      ...context,
      onConditionProjection(node, code, expression) {
        if (node === condition) {
          guard = code;
          predicate = expression;
        }
      }
    });
    if (guard === undefined) throw new Error('Condition is not in its function implementation.');
    return projection(condition, context, guard, 'condition', predicate);
  }
  if (!isData(owner) && !isChoice(owner)) throw new Error(`Unsupported Python condition owner '${owner.$type}'.`);
  const code = renderPythonExpression(condition.expression, pythonDataContext(context, owner));
  const name = context.name(condition);
  return projection(
    condition,
    context,
    `def ${name}(data: ${isData(owner) || isChoice(owner) ? context.name(owner) : 'dict[str, Any]'}) -> bool:\n    return ${code}\n`,
    'condition',
    code
  );
}

/** Standalone browser-safe Python source plus source-addressed display fragments. */
export function generatePythonModule(documents: readonly LangiumDocument[]): PythonModule {
  const context = createPythonProjectionContext(documents, { uri: '', nodeId: '', region: { from: 0, to: 0 } });
  const elements = documents.flatMap((document) =>
    isRosettaModel(document.parseResult.value) ? document.parseResult.value.elements : []
  );
  const types = elements.filter((node) => isData(node) || isChoice(node) || isRosettaEnumeration(node));
  const sections = [PYTHON_RUNTIME_SOURCE, 'from typing import Literal', ...pythonTypeDeclarations(types, context)];
  const projections: EmittedProjection[] = [],
    bindings = new Map<string, string>();
  context.onConditionProjection = (condition, code, predicate) => {
    const recorded = recordedProjection(condition, code, 'condition', predicate);
    if (recorded) projections.push(recorded);
  };
  const record = (node: AstNode, generated: GeneratedProjection, kind: EmittedProjection['kind']) => {
    const recorded = recordedProjection(node, generated.code, kind, generated.body?.code);
    if (recorded) projections.push(recorded);
  };
  const funcs = elements.filter(isRosettaFunction),
    grouped = new Map<string, RosettaFunction[]>();
  for (const func of funcs) {
    const key = qualified(func);
    grouped.set(key, [...(grouped.get(key) ?? []), func]);
  }
  for (const [key, group] of grouped) {
    const base = group.find((func) => !func.dispatchAttribute) ?? group[0]!,
      name = context.name(base);
    bindings.set(key, name);
    sections.push(pythonTypedDict(context.inputName!(base), functionInputs(functionSignature(base, funcs)), context));
    const variants = group.filter((func) => func.dispatchAttribute);
    const bodies = new Map<RosettaFunction, string>();
    let code: string;
    if (!variants.length) {
      const generated = projectPythonFunction(base, context);
      code = generated.code;
      bodies.set(base, generated.body!.code);
    } else {
      const chunks: string[] = [],
        calls: string[] = [];
      for (const [index, func] of group.entries()) {
        const implementation = `_rune_impl_${name}_${index}`;
        const generated = projectPythonFunction(func, context);
        bodies.set(func, generated.body!.code);
        const body = generated.code.replace(`def ${name}(`, `def ${implementation}(`);
        chunks.push(body);
        if (func.dispatchAttribute) {
          const parameter = functionInputs(functionSignature(base, funcs)).find(
            (input) => input.name === (func.dispatchAttribute!.ref?.name ?? func.dispatchAttribute!.$refText)
          );
          const selector = pythonUnwrap(
            `input.get(${pyString(func.dispatchAttribute.ref?.name ?? func.dispatchAttribute.$refText)})`,
            fieldMetadataKind(parameter)
          );
          const expected = pyString(func.dispatchValue?.value.ref?.name ?? func.dispatchValue?.value.$refText ?? '');
          calls.push(`    if ${selector} == ${expected}:\n        return ${implementation}(input)`);
        }
      }
      const baseIndex = group.indexOf(base);
      const output = functionOutput(functionSignature(base, funcs));
      if (!output) throw new Error(`Function '${base.name}' has no output declaration.`);
      const inputs = inputsRequiringNormalization(functionInputs(functionSignature(base, funcs)));
      const normalize = inputs.length ? `    ${normalizeInput(inputs, context)}\n` : '';
      chunks.push(
        `def ${name}(input: ${context.inputName!(base)}) -> ${pythonFieldType(output, context)}:\n${normalize}${calls.join('\n')}\n    return _rune_impl_${name}_${baseIndex}(input)\n`
      );
      code = chunks.join('\n');
    }
    sections.push(code);
    for (const func of group) record(func, projection(func, context, code, 'function', bodies.get(func)), 'function');
  }
  for (const node of elements) {
    if (isData(node))
      for (const condition of node.conditions) {
        const generated = projectPythonCondition(condition, context);
        sections.push(generated.code);
        record(condition, generated, 'condition');
      }
    if (node.$type === 'RosettaRule') {
      const name = context.name(node),
        code = renderPythonExpression(node.expression, pythonDataContext(context, resolveType(node.input)));
      sections.push(`def ${name}(data=None):\n    return ${code}\n`);
    }
    if (node.$type === 'RosettaExternalFunction')
      sections.push(`def ${context.name(node)}(*args):\n    return rune.native(${pyString(qualified(node))}, *args)\n`);
  }
  return { code: sections.join('\n\n'), projections, bindings };
}

export function selectPythonProjection(
  module: PythonModule,
  subject: ProjectionSubject,
  kind: EmittedProjection['kind'],
  form: 'declaration' | 'body' = 'declaration'
): GeneratedProjection {
  const fragment = findProjectionFragment(module.projections, subject, kind);
  if (!fragment) throw new Error(`No generated ${kind} matches the current source region.`);
  const selected = form === 'body' ? fragment.body : fragment;
  if (!selected) throw new Error(`No generated ${kind} body matches the current source region.`);
  return {
    language: 'python',
    subject,
    code: selected.code,
    sourceMap: selected.sourceMap,
    requiredHelpers: pythonHelperDependencies(selected.code)
  };
}
