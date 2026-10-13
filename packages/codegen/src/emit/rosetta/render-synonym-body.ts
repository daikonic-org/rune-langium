// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * render-synonym-body — structural Rune DSL renderer for the
 * `RosettaSynonymBody` / mapping grammar family (P5).
 *
 * Grammar reference: `rune-dsl.langium` L578–703. Covers:
 *
 * - `RosettaSynonymBody`: five mutually-exclusive alternatives (`value`,
 *   `hint`, `merge`, bare set-to `mappingLogic`, bare `meta`), each
 *   optionally followed by the four suffixes in grammar order:
 *   `dateFormat` → `pattern` → `removeHtml` → `mapper`.
 * - `RosettaSynonymValueBase` (`RosettaSynonymValue`/`RosettaMetaSynonymValue`/
 *   `RosettaClassSynonymValue` all `infer` this one shape): `"name"`
 *   `[tag|componentID INT]` `[path "s"]` `[maps INT]` (class-synonym values
 *   never carry `maps` — the grammar rule for that alternative has no `maps`
 *   production, so the field is simply absent there; no special-casing needed).
 * - The mapping family (`RosettaMapping`/`RosettaMappingSetTo` — the latter
 *   `infers RosettaMapping`, same AST shape, different surface grammar):
 *   `default to <primary>` · `set to <primary> [when <tests>]` (SetTo form
 *   only) · `set when <tests>` (value form only). Tests join ` and `;
 *   instances join `, `.
 * - `RosettaAttributeReference` renders recursively: `receiver` is a
 *   `RosettaDataReference` at the root (`Data.QualifiedName`) or a nested
 *   `RosettaAttributeReference` — discriminated by `$type`.
 * - `RosettaMapPrimaryExpression` = `EnumValueReference` (`Enum.Qualified ->
 *   Value`) | a `RosettaLiteralRule` $type, delegated to `renderExpression`
 *   (already covers every literal case).
 *
 * Fallback contract: THROWS `UnsupportedSynonymBodyError` on any
 * undiscriminable body or unknown `$type` inside the tree (future grammar
 * additions). Callers (render-core's three synonym renderers) catch this and
 * fall back to CST text — never corrupt, per the P3 posture.
 *
 * Browser-safe: no parser/services import — only `renderExpression` (for
 * literal primaries) and `escapeId`/`escapeString` from the sibling
 * render-* modules, both already browser-safe.
 */

import { renderExpression, escapeId, UnsupportedExpressionError } from './render-expression.js';
import { escapeString } from './rosetta-render-core.js';

/** Thrown on an unknown/undiscriminable synonym-body shape. */
export class UnsupportedSynonymBodyError extends Error {
  constructor(public readonly nodeType: string) {
    super(`renderSynonymBody: unsupported synonym-body $type '${nodeType}'`);
  }
}

type AnyNode = Record<string, unknown> & { $type?: string };

function refText(r: unknown): string {
  return escapeId((r as { $refText?: string } | undefined)?.$refText ?? '');
}

// --- value surface (RosettaSynonymValueBase) --------------------------------

interface SynonymValueBase {
  name?: string;
  refType?: string;
  value?: number;
  path?: string;
  maps?: number;
}

/** `"name" [tag|componentID INT] [path "s"] [maps INT]` (grammar order). */
function renderSynonymValue(v: SynonymValueBase): string {
  let out = `"${escapeString(v.name ?? '')}"`;
  if (v.refType !== undefined && v.value !== undefined) out += ` ${v.refType} ${v.value}`;
  if (v.path !== undefined) out += ` path "${escapeString(v.path)}"`;
  if (v.maps !== undefined) out += ` maps ${v.maps}`;
  return out;
}

/**
 * Public: render a class-synonym `value` — grammar rule
 * `RosettaClassSynonymValue` has no `maps` production (unlike
 * `RosettaSynonymValue`/`RosettaMetaSynonymValue`), so `maps` is dropped even
 * if present on the input node (defensive; a correctly-parsed node never
 * populates it here). For `metaValue` use `renderMetaSynonymValue` — that
 * grammar rule DOES allow `maps`.
 */
export function renderClassSynonymValue(v: unknown): string {
  const { maps: _maps, ...rest } = (v ?? {}) as SynonymValueBase;
  return renderSynonymValue(rest);
}

/**
 * Public: render a class-synonym `metaValue` (`RosettaMetaSynonymValue`) —
 * full value surface INCLUDING `maps` (grammar: `name (refType value)?
 * (path)? (maps)?`).
 */
export function renderMetaSynonymValue(v: unknown): string {
  return renderSynonymValue(v ?? {});
}

// --- mapping primary (RosettaMapPrimaryExpression) --------------------------

/** `Enum.QualifiedName -> Value` | literal (delegated to renderExpression). */
function renderMapPrimary(node: AnyNode): string {
  if (node.$type === 'RosettaEnumValueReference') {
    return `${refText(node['enumeration'])} -> ${refText(node['value'])}`;
  }
  try {
    return renderExpression(node as never);
  } catch (err) {
    // Only rewrap the DESIGNED unsupported signal — a genuine renderExpression
    // bug (TypeError etc.) must propagate as-is so render-core's warn path
    // surfaces it (P3 observability convention) instead of being silently
    // classified as "unsupported body".
    if (err instanceof UnsupportedExpressionError) {
      throw new UnsupportedSynonymBodyError(node.$type ?? 'unknown');
    }
    throw err;
  }
}

// --- attribute reference (recursive) ----------------------------------------

/** `Data.QualifiedName -> attr [-> attr ...]` — root is RosettaDataReference, recurse on nested RosettaAttributeReference. */
export function renderAttributeReference(node: AnyNode): string {
  if (node.$type === 'RosettaDataReference') {
    return refText(node['data']);
  }
  if (node.$type === 'RosettaAttributeReference') {
    const receiver = node['receiver'] as AnyNode;
    return `${renderAttributeReference(receiver)} -> ${refText(node['attribute'])}`;
  }
  throw new UnsupportedSynonymBodyError(node.$type ?? 'unknown');
}

// --- mapping tests (RosettaMapTest family) ----------------------------------

function renderMapTest(node: AnyNode): string {
  switch (node.$type) {
    case 'RosettaMapPath':
      return `path = "${escapeString(((node['path'] as AnyNode)['path'] as string) ?? '')}"`;
    case 'RosettaMapRosettaPath':
      return `rosettaPath = ${renderAttributeReference(node['path'] as AnyNode)}`;
    case 'RosettaMapTestExistsExpression':
      return `"${escapeString(((node['argument'] as AnyNode)['path'] as string) ?? '')}" exists`;
    case 'RosettaMapTestAbsentExpression':
      return `"${escapeString(((node['argument'] as AnyNode)['path'] as string) ?? '')}" is absent`;
    case 'RosettaMapTestEqualityOperation': {
      const left = `"${escapeString(((node['left'] as AnyNode)['path'] as string) ?? '')}"`;
      const right = renderMapPrimary(node['right'] as AnyNode);
      return `${left} ${node['operator']} ${right}`;
    }
    case 'RosettaMapTestFunc': {
      let out = `condition-func ${refText(node['func'])}`;
      const predicatePath = node['predicatePath'] as AnyNode | undefined;
      if (predicatePath) out += ` condition-path "${escapeString((predicatePath['path'] as string) ?? '')}"`;
      return out;
    }
    default:
      throw new UnsupportedSynonymBodyError(node.$type ?? 'unknown');
  }
}

function renderMappingPathTests(tests: AnyNode): string {
  const list = (tests['tests'] as AnyNode[] | undefined) ?? [];
  return list.map(renderMapTest).join(' and ');
}

// --- mapping instances (RosettaMappingInstance) -----------------------------

/**
 * `default: true` → `default to <primary>` · `set` present → `set to
 * <primary> [when <tests>]` · else (`when`-only) → `set when <tests>`.
 */
function renderMappingInstance(inst: AnyNode): string {
  const when = inst['when'] as AnyNode | undefined;
  if (inst['default']) {
    return `default to ${renderMapPrimary(inst['set'] as AnyNode)}`;
  }
  if (inst['set'] !== undefined) {
    const whenText = when ? ` when ${renderMappingPathTests(when)}` : '';
    return `set to ${renderMapPrimary(inst['set'] as AnyNode)}${whenText}`;
  }
  if (when) {
    return `set when ${renderMappingPathTests(when)}`;
  }
  throw new UnsupportedSynonymBodyError('RosettaMappingInstance');
}

function renderMapping(mapping: AnyNode): string {
  const instances = (mapping['instances'] as AnyNode[] | undefined) ?? [];
  if (instances.length === 0) throw new UnsupportedSynonymBodyError('RosettaMapping');
  return instances.map(renderMappingInstance).join(', ');
}

// --- suffixes (grammar order: dateFormat, pattern, removeHtml, mapper) ------

interface SuffixHolder {
  format?: string;
  patternMatch?: string;
  patternReplace?: string;
  removeHtml?: boolean;
  mapper?: string;
}

function renderSuffixes(body: SuffixHolder): string {
  let out = '';
  if (body.format !== undefined) out += ` dateFormat "${escapeString(body.format)}"`;
  if (body.patternMatch !== undefined && body.patternReplace !== undefined) {
    out += ` pattern "${escapeString(body.patternMatch)}" "${escapeString(body.patternReplace)}"`;
  }
  if (body.removeHtml) out += ' removeHtml';
  if (body.mapper !== undefined) out += ` mapper "${escapeString(body.mapper)}"`;
  return out;
}

// --- RosettaSynonymBody dispatch (five alternatives + suffixes) ------------

interface SynonymBodyShape extends SuffixHolder {
  values?: SynonymValueBase[];
  mappingLogic?: AnyNode;
  hints?: string[];
  merge?: { name?: string; excludePath?: string };
  metaValues?: string[];
}

/**
 * Render a full `RosettaSynonymBody` to its `.rosetta` surface text
 * (everything after the `[synonym src, src` head and before the closing
 * `]`). Throws `UnsupportedSynonymBodyError` when the body's populated
 * fields don't match any grammar alternative — callers fall back to CST.
 */
export function renderSynonymBody(body: unknown): string {
  const b = (body ?? {}) as SynonymBodyShape;
  let head: string;

  if ((b.values?.length ?? 0) > 0) {
    // value v (, v)* [mapping] [meta s (, s)*]
    head = `value ${b.values!.map(renderSynonymValue).join(', ')}`;
    if (b.mappingLogic) head += ` ${renderMapping(b.mappingLogic)}`;
    if ((b.metaValues?.length ?? 0) > 0) {
      head += ` meta ${b.metaValues!.map((s) => `"${escapeString(s)}"`).join(', ')}`;
    }
  } else if ((b.hints?.length ?? 0) > 0) {
    head = `hint ${b.hints!.map((s) => `"${escapeString(s)}"`).join(', ')}`;
  } else if (b.merge) {
    head = `merge "${escapeString(b.merge.name ?? '')}"`;
    if (b.merge.excludePath !== undefined) head += ` when path <> "${escapeString(b.merge.excludePath)}"`;
  } else if (b.mappingLogic) {
    // Bare set-to mapping (RosettaMappingSetTo) — values.length === 0, no meta suffix on this alternative.
    head = renderMapping(b.mappingLogic);
  } else if ((b.metaValues?.length ?? 0) > 0) {
    head = `meta ${b.metaValues!.map((s) => `"${escapeString(s)}"`).join(', ')}`;
  } else {
    throw new UnsupportedSynonymBodyError('RosettaSynonymBody');
  }

  return head + renderSuffixes(b);
}
