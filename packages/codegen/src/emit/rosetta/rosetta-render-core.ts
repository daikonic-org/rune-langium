// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Whole-AST → `.rosetta` source render-core.
 *
 * `renderNode` dispatches on `$type`. Implemented constructs return structural
 * `.rosetta` text; every other `$type` returns `null`, meaning "I cannot
 * generate this — use the CST". Composite children are rendered via the caller's
 * `renderChild` policy (reuse-or-regenerate). Cross-references emit `$refText`.
 *
 * No fs / ExcelJS / generator imports — safe to import in a browser hot path via
 * the `@rune-langium/codegen/rosetta` subpath.
 */

import type { AstNode } from 'langium';
import type {
  Dehydrated,
  Data,
  Attribute,
  Choice,
  ChoiceOption,
  Schema,
  RosettaEnumeration,
  RosettaEnumValue,
  RosettaCardinality
} from '@rune-langium/core';
import { renderExpression, UnsupportedExpressionError } from './render-expression.js';
import {
  renderSynonymBody,
  renderClassSynonymValue,
  renderMetaSynonymValue,
  renderAttributeReference,
  UnsupportedSynonymBodyError
} from './render-synonym-body.js';

export type DehydratedNode = Dehydrated<AstNode>;
export type RenderChild = (child: DehydratedNode) => string;

// --- helpers --------------------------------------------------------------

export function escapeString(s: string): string {
  return JSON.stringify(s).slice(1, -1);
}

function indentBlock(text: string, level = 1): string {
  const pad = '  '.repeat(level);
  return text
    .split('\n')
    .map((line) => (line.trim() ? `${pad}${line}` : ''))
    .join('\n');
}

function formatCardinality(card: Dehydrated<RosettaCardinality>): string {
  if (card.unbounded) return `(${card.inf}..*)`;
  return `(${card.inf}..${card.sup ?? card.inf})`;
}

function refText(ref: { $refText: string } | undefined): string | undefined {
  return ref?.$refText;
}

/** Definition renders as a `<"...">` doc string in the domain surface. */
function definitionLine(def: string | undefined): string | undefined {
  return def === undefined ? undefined : `<"${escapeString(def)}">`;
}

/** Options threaded through renderNode/renderModel to the expression-body sites. */
export interface RenderOpts {
  /** Declaration-only syntax supplied by the common model builder (for example synonym sources). */
  declarations?: readonly (string | undefined)[];
  /**
   * Override expression-body rendering (called only with a non-null body;
   * return value used verbatim). The VE cst-reuse layer uses this to slice
   * unedited bodies from the original source (P2 fidelity design). Default:
   * structural renderExpression with CST-text fallback.
   */
  renderExpr?: (expr: unknown) => string;
}

/**
 * Render an expression body: structural renderExpression first; on an
 * unknown node type (future grammar additions) fall back to the CST text.
 * Fallback-not-corrupt is the render-core invariant (see PR #357 lesson:
 * a removed CST fallback corrupted non-value synonym bodies).
 */
function exprText(expr: unknown, opts?: RenderOpts): string {
  if (expr == null) return '';
  if (opts?.renderExpr) return opts.renderExpr(expr);
  try {
    return renderExpression(expr as never);
  } catch (err) {
    if (!(err instanceof UnsupportedExpressionError)) {
      const nodeType = (expr as { $type?: string })?.$type ?? 'unknown';
      // eslint-disable-next-line no-console -- browser-safe observability hook (see module doc); never-corrupt invariant: CST fallback below always still runs.
      console.warn(
        `[render-core] unexpected renderExpression failure on $type "${nodeType}" — falling back to CST text`,
        err
      );
    }
    const e = expr as { $cstText?: string; $cstNode?: { text?: string } };
    return (e.$cstText ?? e.$cstNode?.text ?? '').trim();
  }
}

/**
 * Render a parenthesized, comma-joined inline child list — type-call arguments
 * (`Type(param: value)`) and type-alias parameters (`typeAlias Foo(p int)`).
 *
 * Each child is delegated to the caller's `renderChild` policy: an unchanged
 * argument subtree (whose value is a `RosettaExpression` — a B1 leaf) rides its
 * CST slice via `$cstRange`; a structural construct like `TypeParameter` renders
 * from `renderNode`. Children that render empty (the pure `renderModel` path has
 * no CST to reuse for an expression leaf) are dropped so we never emit a
 * malformed `Type(param: )`. Returns `''` when nothing renders.
 */
function renderInlineChildren(items: ReadonlyArray<unknown> | undefined, renderChild: RenderChild): string {
  const texts = (items ?? []).map((c) => renderChild(c as DehydratedNode).trim()).filter(Boolean);
  return texts.length ? `(${texts.join(', ')})` : '';
}

// --- per-construct renderers ----------------------------------------------

function renderSchema(schema: Dehydrated<Schema>, renderChild: RenderChild): string {
  return [
    `schema ${schema.name} ${refText(schema.format) ?? ''}`,
    ...schema.annotations.map((annotation) => indentBlock(renderChild(annotation)))
  ].join('\n');
}

function renderAttribute(a: Dehydrated<Attribute>, renderChild: RenderChild): string {
  const head: string[] = [];
  if (a.override) head.push('override');
  head.push(a.name);
  const type = refText(a.typeCall?.type);
  if (type) {
    // Inline type-call args live on the Attribute itself (`name Type(arg) (1..1)`),
    // NOT on typeCall — see grammar `Attribute`. Preserve them when re-rendering.
    const args = renderInlineChildren((a as { typeCallArgs?: ReadonlyArray<unknown> }).typeCallArgs, renderChild);
    head.push(`${type}${args}`);
  }
  head.push(formatCardinality(a.card));
  const lines = [head.join(' ')];
  const def = definitionLine(typeof a.definition === 'string' ? a.definition : undefined);
  if (def) lines.push(indentBlock(def));
  // Unimplemented annotation/synonym/label/ref children ride CST via renderChild.
  for (const child of childList(a.annotations, a.references, a.synonyms, a.labels, a.ruleReferences)) {
    lines.push(indentBlock(renderChild(child)));
  }
  return lines.join('\n');
}

function renderChoiceOption(o: Dehydrated<ChoiceOption>, renderChild: RenderChild): string {
  const type = refText(o.typeCall?.type) ?? 'unknown';
  // ChoiceOption type-call args live on `typeCall.arguments` (grammar `TypeCall`).
  const args = renderInlineChildren(
    (o.typeCall as { arguments?: ReadonlyArray<unknown> } | undefined)?.arguments,
    renderChild
  );
  const lines = [`${type}${args}`];
  const def = definitionLine(typeof o.definition === 'string' ? o.definition : undefined);
  if (def) lines.push(indentBlock(def));
  for (const child of childList(o.annotations, o.references, o.synonyms, o.labels, o.ruleReferences)) {
    lines.push(indentBlock(renderChild(child)));
  }
  return lines.join('\n');
}

function renderEnumValue(v: Dehydrated<RosettaEnumValue>, renderChild: RenderChild): string {
  let head = v.name;
  const display = typeof v.display === 'string' ? v.display : undefined;
  if (display) head += ` displayName "${escapeString(display)}"`;
  const lines = [head];
  const def = definitionLine(typeof v.definition === 'string' ? v.definition : undefined);
  if (def) lines.push(indentBlock(def));
  for (const child of childList(v.annotations, v.references, v.enumSynonyms)) {
    lines.push(indentBlock(renderChild(child)));
  }
  return lines.join('\n');
}

function renderData(d: Dehydrated<Data>, renderChild: RenderChild): string {
  let header = `type ${d.name}`;
  const parent = refText(d.superType);
  if (parent) header += ` extends ${parent}`;
  header += ':';
  const lines = [header];
  const def = definitionLine(typeof d.definition === 'string' ? d.definition : undefined);
  if (def) lines.push(indentBlock(def));
  // Meta block (annotations/refs/synonyms) — unimplemented, ride CST.
  for (const child of childList(d.annotations, d.references, d.synonyms)) {
    lines.push(indentBlock(renderChild(child)));
  }
  for (const attr of d.attributes ?? []) {
    lines.push(indentBlock(renderChild(attr)));
  }
  for (const cond of d.conditions ?? []) {
    lines.push('');
    lines.push(indentBlock(renderChild(cond)));
  }
  return lines.join('\n');
}

function renderChoice(c: Dehydrated<Choice>, renderChild: RenderChild): string {
  const lines = [`choice ${c.name}:`];
  const def = definitionLine(typeof c.definition === 'string' ? c.definition : undefined);
  if (def) lines.push(indentBlock(def));
  for (const child of childList(c.annotations, c.synonyms)) {
    lines.push(indentBlock(renderChild(child)));
  }
  for (const opt of c.attributes ?? []) {
    lines.push(indentBlock(renderChild(opt)));
  }
  return lines.join('\n');
}

function renderEnum(e: Dehydrated<RosettaEnumeration>, renderChild: RenderChild): string {
  let header = `enum ${e.name}`;
  const parent = refText(e.parent);
  if (parent) header += ` extends ${parent}`;
  header += ':';
  const lines = [header];
  const def = definitionLine(typeof e.definition === 'string' ? e.definition : undefined);
  if (def) lines.push(indentBlock(def));
  for (const child of childList(e.annotations, e.references, e.synonyms)) {
    lines.push(indentBlock(renderChild(child)));
  }
  for (const val of e.enumValues ?? []) {
    lines.push(indentBlock(renderChild(val)));
  }
  return lines.join('\n');
}

function renderSegment(seg: unknown): string {
  let out = '';
  let s = seg as { feature?: { $refText?: string }; next?: unknown } | undefined;
  while (s) {
    const f = s.feature?.$refText;
    if (f) out += ` -> ${f}`;
    s = s.next as typeof s;
  }
  return out;
}

function renderOperation(o: DehydratedNode, opts?: RenderOpts): string {
  const op = o as unknown as {
    add?: boolean;
    assignRoot?: { $refText?: string };
    path?: unknown;
    definition?: string;
    expression?: unknown;
  };
  const kw = op.add ? 'add' : 'set';
  const root = op.assignRoot?.$refText;
  if (!root) {
    // Guard: no assignRoot (or empty $refText) — skip this operation entirely
    // rather than emitting an invalid "set :" head that fails re-parse.
    return '';
  }
  const head = `${kw} ${root}${renderSegment(op.path)}:`;
  const lines = [head];
  const def = definitionLine(op.definition);
  if (def) lines.push(indentBlock(def, 2));
  const body = exprText(op.expression, opts);
  if (body) lines.push(indentBlock(body, 2));
  return lines.join('\n');
}

function renderShortcut(s: DehydratedNode, opts?: RenderOpts): string {
  const sc = s as unknown as { name?: string; definition?: string; expression?: unknown };
  const lines = [`alias ${sc.name ?? ''}:`];
  const def = definitionLine(sc.definition);
  if (def) lines.push(indentBlock(def, 2));
  const body = exprText(sc.expression, opts);
  if (body) lines.push(indentBlock(body, 2));
  return lines.join('\n');
}

function renderFunction(f: DehydratedNode, renderChild: RenderChild): string {
  const fn = f as unknown as {
    name?: string;
    definition?: string;
    superFunction?: { $refText?: string };
    dispatchAttribute?: { $refText?: string };
    dispatchValue?: { enumeration?: { $refText?: string }; value?: { $refText?: string } };
    annotations?: unknown[];
    references?: unknown[];
    inputs?: unknown[];
    output?: unknown;
    shortcuts?: unknown[];
    conditions?: unknown[];
    operations?: unknown[];
    postConditions?: unknown[];
  };
  let header = `func ${fn.name}`;
  // Optional dispatch selector — `func F(attr: Enum -> Value):` (grammar). This
  // is overload/dispatch semantics, so it MUST survive a function-body edit. The
  // grammar requires both the attribute and a full enum-value reference inside
  // the parens, so emit only when every part is present.
  const dispAttr = fn.dispatchAttribute?.$refText;
  const dispEnum = fn.dispatchValue?.enumeration?.$refText;
  const dispVal = fn.dispatchValue?.value?.$refText;
  if (dispAttr && dispEnum && dispVal) header += `(${dispAttr}: ${dispEnum} -> ${dispVal})`;
  const sup = fn.superFunction?.$refText;
  if (sup) header += ` extends ${sup}`;
  header += ':';
  const lines = [header];
  const def = definitionLine(fn.definition);
  if (def) lines.push(indentBlock(def));
  for (const child of childList(fn.annotations, fn.references)) lines.push(indentBlock(renderChild(child)));
  if ((fn.inputs ?? []).length > 0) {
    lines.push(indentBlock('inputs:'));
    for (const i of fn.inputs!) lines.push(indentBlock(renderChild(i as DehydratedNode), 2));
  }
  if (fn.output) {
    lines.push(indentBlock('output:'));
    lines.push(indentBlock(renderChild(fn.output as DehydratedNode), 2));
  }
  for (const sc of fn.shortcuts ?? []) lines.push(indentBlock(renderChild(sc as DehydratedNode)));
  for (const c of fn.conditions ?? []) {
    lines.push('');
    lines.push(indentBlock(renderChild(c as DehydratedNode)));
  }
  for (const op of fn.operations ?? []) {
    lines.push('');
    lines.push(indentBlock(renderChild(op as DehydratedNode)));
  }
  for (const pc of fn.postConditions ?? []) {
    lines.push('');
    lines.push(indentBlock(renderChild(pc as DehydratedNode)));
  }
  return lines.join('\n');
}

/** A generic type parameter: `name TypeName` (grammar `TypeParameter`). */
function renderTypeParameter(p: DehydratedNode): string {
  const tp = p as unknown as { name?: string; typeCall?: { type?: { $refText?: string } } };
  const ty = tp.typeCall?.type?.$refText;
  return ty ? `${tp.name ?? ''} ${ty}` : `${tp.name ?? ''}`;
}

function renderTypeAlias(t: DehydratedNode, renderChild: RenderChild): string {
  const ta = t as unknown as {
    name?: string;
    definition?: string;
    parameters?: ReadonlyArray<unknown>;
    typeCall?: { type?: { $refText?: string }; arguments?: ReadonlyArray<unknown> };
    conditions?: unknown[];
  };
  // Generic parameters render BEFORE the colon: `typeAlias Foo(p int):` (grammar
  // `TypeParameters`). The wrapped type may itself carry type-call arguments.
  const params = renderInlineChildren(ta.parameters, renderChild);
  let wrapped = ta.typeCall?.type?.$refText ?? '';
  if (wrapped) wrapped += renderInlineChildren(ta.typeCall?.arguments, renderChild);
  const def = definitionLine(ta.definition);
  if (!def && (ta.conditions ?? []).length === 0) return `typeAlias ${ta.name}${params}: ${wrapped}`;
  const lines = [`typeAlias ${ta.name}${params}:`];
  if (def) lines.push(indentBlock(def));
  lines.push(indentBlock(wrapped));
  for (const c of ta.conditions ?? []) {
    lines.push('');
    lines.push(indentBlock(renderChild(c as DehydratedNode)));
  }
  return lines.join('\n');
}

function renderCondition(c: DehydratedNode, renderChild: RenderChild, opts?: RenderOpts): string {
  const cc = c as unknown as {
    name?: string;
    definition?: string;
    postCondition?: boolean;
    expression?: unknown;
    annotations?: readonly unknown[];
    references?: readonly unknown[];
  };
  const head = cc.postCondition ? 'post-condition' : 'condition';
  const lines = [cc.name ? `${head} ${cc.name}:` : `${head}:`];
  const def = definitionLine(cc.definition);
  if (def) lines.push(indentBlock(def));
  // Delegate annotation/doc-ref children so an edited condition keeps its
  // annotations and references (mirrors renderData/renderAttribute).
  for (const child of childList(cc.annotations, cc.references)) {
    lines.push(indentBlock(renderChild(child)));
  }
  const body = exprText(cc.expression, opts);
  if (body) lines.push(indentBlock(body));
  return lines.join('\n');
}

function renderAnnotationRef(a: DehydratedNode): string {
  const ar = a as unknown as {
    annotation?: { $refText?: string };
    attribute?: { $refText?: string };
    qualifiers?: unknown[];
  };
  const parts = [ar.annotation?.$refText ?? ''];
  if (ar.attribute?.$refText) parts.push(ar.attribute.$refText);
  for (const q of ar.qualifiers ?? []) {
    const qq = q as {
      qualName?: string;
      qualValue?: string;
      qualPath?: Parameters<typeof renderAttributeReference>[0];
    };
    if (qq.qualName === undefined) continue;
    const name = `"${escapeString(qq.qualName)}"`;
    if (qq.qualValue !== undefined) parts.push(`${name}="${escapeString(qq.qualValue)}"`);
    else if (qq.qualPath) parts.push(`${name}=${renderAttributeReference(qq.qualPath)}`);
  }
  return `[${parts.join(' ')}]`;
}

function synonymSources(sources: unknown[] | undefined): string {
  return (sources ?? [])
    .map((s) => (s as { $refText?: string }).$refText ?? '')
    .filter(Boolean)
    .join(', ');
}

// Sources are upstream-guaranteed (z2f picker + grammar). The three synonym
// renderers below render the FULL `RosettaClassSynonym`/`RosettaSynonym`/
// `RosettaEnumSynonym` grammar surface (P5), delegating body/value rendering
// to render-synonym-body.ts. They stay `string | null`: a body-render throw
// (UnsupportedSynonymBodyError for a designed-unsupported shape, anything
// else via P3's warn-on-unexpected convention) is caught here and mapped to
// `null` so renderNode falls back to CST — never corrupt, per the P3 posture
// carried over from exprText.

/** Catch a body/value-render throw and fall back to `null` (CST). Mirrors `exprText`'s convention. */
function trySynonymRender(render: () => string): string | null {
  try {
    return render();
  } catch (err) {
    if (!(err instanceof UnsupportedSynonymBodyError)) {
      // eslint-disable-next-line no-console -- browser-safe observability hook (see module doc); never-corrupt invariant: CST fallback below always still runs.
      console.warn('[render-core] unexpected synonym render failure — falling back to CST text', err);
    }
    return null;
  }
}

function renderClassSynonym(s: DehydratedNode): string | null {
  const cs = s as unknown as { sources?: unknown[]; value?: unknown; metaValue?: unknown };
  const sources = synonymSources(cs.sources);
  return trySynonymRender(() => {
    const parts: string[] = [];
    // `value` is optional (grammar `('value' value=RosettaClassSynonymValue)?`).
    if (cs.value !== undefined) parts.push(`value ${renderClassSynonymValue(cs.value)}`);
    // metaValue is a RosettaMetaSynonymValue — its grammar rule ALLOWS `maps`
    // (unlike RosettaClassSynonymValue) — render the full surface.
    if (cs.metaValue !== undefined) parts.push(`meta ${renderMetaSynonymValue(cs.metaValue)}`);
    const suffix = parts.length > 0 ? ` ${parts.join(' ')}` : '';
    return `[synonym ${sources}${suffix}]`;
  });
}

function renderSynonym(s: DehydratedNode): string | null {
  const sy = s as unknown as { sources?: unknown[]; body?: unknown };
  const sources = synonymSources(sy.sources);
  return trySynonymRender(() => `[synonym ${sources} ${renderSynonymBody(sy.body)}]`);
}

function renderEnumSynonym(s: DehydratedNode): string | null {
  const es = s as unknown as {
    sources?: unknown[];
    synonymValue?: string;
    definition?: string;
    patternMatch?: string;
    patternReplace?: string;
    removeHtml?: boolean;
  };
  const sourcesList = es.sources ?? [];
  const sources = synonymSources(sourcesList);
  return trySynonymRender(() => {
    // synonymValue is a required field on RosettaEnumSynonym (grammar: `'value' synonymValue=STRING`,
    // no `?`) — absence means an undiscriminable/malformed node, so throw to trigger CST fallback.
    if (es.synonymValue === undefined) throw new UnsupportedSynonymBodyError('RosettaEnumSynonym');
    let out = `value "${escapeString(es.synonymValue)}"`;
    if (es.definition !== undefined) out += ` definition "${escapeString(es.definition)}"`;
    if (es.patternMatch !== undefined && es.patternReplace !== undefined) {
      out += ` pattern "${escapeString(es.patternMatch)}" "${escapeString(es.patternReplace)}"`;
    }
    // `RosettaExternalEnumSynonym` (the external-block sibling grammar rule —
    // `'[' 'value' synonymValue=STRING ('definition' ...)? ('pattern' ...)? ']'`,
    // no `synonym` keyword, no sources) `infers RosettaEnumSynonym`: SAME
    // `$type` as the normal `[synonym src, ... value "s" ...]` form, structurally
    // distinguished only by an empty `sources` array (corpus-sweep finding —
    // 354/532 unique corpus RosettaEnumSynonym nodes are this external shape,
    // e.g. currency-code enum externals). The external rule also has no
    // `removeHtml` production, so it never applies here.
    if (sourcesList.length === 0) return `[${out}]`;
    if (es.removeHtml) out += ' removeHtml';
    return `[synonym ${sources} ${out}]`;
  });
}

/** Flatten present child arrays into one ordered list of DehydratedNodes. */
function childList(...arrays: Array<ReadonlyArray<unknown> | undefined>): DehydratedNode[] {
  const out: DehydratedNode[] = [];
  for (const arr of arrays) {
    if (!arr) continue;
    for (const item of arr) out.push(item as DehydratedNode);
  }
  return out;
}

// --- dispatcher -----------------------------------------------------------

export function renderNode(node: DehydratedNode, renderChild: RenderChild, opts?: RenderOpts): string | null {
  switch ((node as { $type: string }).$type) {
    case 'Schema':
      return renderSchema(node as Dehydrated<Schema>, renderChild);
    case 'Data':
      return renderData(node as Dehydrated<Data>, renderChild);
    case 'Attribute':
      return renderAttribute(node as Dehydrated<Attribute>, renderChild);
    case 'Choice':
      return renderChoice(node as Dehydrated<Choice>, renderChild);
    case 'ChoiceOption':
      return renderChoiceOption(node as Dehydrated<ChoiceOption>, renderChild);
    case 'RosettaEnumeration':
      return renderEnum(node as Dehydrated<RosettaEnumeration>, renderChild);
    case 'RosettaEnumValue':
      return renderEnumValue(node as Dehydrated<RosettaEnumValue>, renderChild);
    case 'Condition':
      return renderCondition(node, renderChild, opts);
    case 'RosettaFunction':
      return renderFunction(node, renderChild);
    case 'Operation':
      return renderOperation(node, opts);
    case 'ShortcutDeclaration':
      return renderShortcut(node, opts);
    case 'RosettaTypeAlias':
      return renderTypeAlias(node, renderChild);
    case 'TypeParameter':
      return renderTypeParameter(node);
    case 'AnnotationRef':
      return renderAnnotationRef(node);
    case 'RosettaClassSynonym':
      return renderClassSynonym(node);
    case 'RosettaSynonym':
      return renderSynonym(node);
    case 'RosettaEnumSynonym':
      return renderEnumSynonym(node);
    default:
      return null; // unimplemented → caller uses CST
  }
}

// --- full-model renderer --------------------------------------------------

/**
 * Render a complete namespace model to `.rosetta` source text.
 *
 * Emits `namespace <name>`, `version "<version>"`, then each element via
 * `renderNode`. Elements whose `renderNode` returns `null` (unimplemented `$type`)
 * are silently skipped. Elements are separated by blank lines; the output ends
 * with a trailing newline.
 *
 * Browser-safe: no fs / ExcelJS / generator imports.
 */
function modelName(name: unknown): string {
  if (typeof name === 'string') return name;
  if (name && typeof name === 'object' && 'segments' in name)
    return (name as { segments: string[] }).segments.join('.');
  return String(name ?? '');
}

export function renderModel(
  model: { name: unknown; version?: string; elements: unknown[] },
  opts?: RenderOpts
): string {
  const renderChild: RenderChild = (c: DehydratedNode) => renderNode(c, renderChild, opts) ?? '';
  const lines: string[] = [];
  lines.push(`namespace ${modelName(model.name)}`);
  lines.push(`version "${model.version ?? '0.0.0'}"`);
  for (const declaration of opts?.declarations ?? []) if (declaration !== undefined) lines.push('', declaration);
  for (const element of model.elements) {
    const text = renderNode(element as DehydratedNode, renderChild, opts);
    if (text !== null) {
      lines.push('');
      lines.push(text);
    }
  }
  lines.push('');
  return lines.join('\n');
}
