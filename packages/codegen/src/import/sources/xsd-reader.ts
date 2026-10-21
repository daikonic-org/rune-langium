// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Parses one XSD document into SourceModel. Rune AST construction and constraint
 * translation belong to ast-builder.ts and constraint-translator.ts.
 *
 * Parser invariants:
 * - fast-xml-parser must return element, complexType, simpleType, enumeration,
 *   and attribute nodes as arrays even for singleton occurrences. Compositors,
 *   restrictions, complexContent, and extensions retain their object shape.
 * - Resolve prefixes through the document's namespace declarations. xs:, xsd:,
 *   and other aliases for the XSD namespace must behave identically.
 *
 * Vocabulary:
 * - Named complexType becomes SourceType. sequence/choice/all elements and XML
 *   attributes become Rune attributes; the XML attribute/element distinction
 *   is not retained.
 * - Enumeration-only simpleType restrictions become SourceEnum. Other scalar
 *   facets attach to the referencing attribute, whose type uses the restriction
 *   base's Rune builtin.
 * - string → string; decimal/double/float → number; int/integer/long/short → int;
 *   boolean → boolean; date → date; dateTime → dateTime. Named type references
 *   use namespace-stripped local names.
 * - Occurrence bounds map to SourceCardinality: absent/1 → 1, 0 → 0, and
 *   unbounded or upper bounds above 1 leave sup absent.
 * - Choice members become (0..1) attributes plus a type-level condition.
 *   The group's own minOccurs determines optional choice (0) versus required
 *   oneOf (absent/1).
 * - complexContent/extension sets extends to the local base name without
 *   copying the base's attributes into the child.
 * - Range facets produce one ConstraintIR per bound, preserving exclusivity.
 *   minLength/maxLength/length produce length constraints; pattern is a stub.
 * - union, import/include, substitution groups, abstract types/elements,
 *   group/attributeGroup references, and mixed content produce diagnostics.
 *   External documents are never fetched; abstract types still emit structure.
 */

import { XMLParser } from 'fast-xml-parser';
import type {
  ConstraintIR,
  SourceAttribute,
  SourceCardinality,
  SourceEnum,
  SourceModel,
  SourceType
} from '../source-model.js';
import { sanitizeIdentifier, dedupeIdentifier, sanitizeNamespaceSegment } from '../identifiers.js';
import { pushDiagnostic, type ImportDiagnostic } from '../diagnostics.js';

// --- XSD namespace + tag resolution -----------------------------------------

const XSD_NS = 'http://www.w3.org/2001/XMLSchema';

/**
 * Tags forced to ALWAYS parse as arrays regardless of occurrence count (see
 * this module's doc, design decision 1). Declared PER-PREFIX at parse time
 * (see `buildIsArray`) since the real prefix isn't known until after a first,
 * prefix-agnostic pass reads the root element's `xmlns:*` attributes.
 */
const ALWAYS_ARRAY_LOCAL_NAMES = new Set(['element', 'complexType', 'simpleType', 'enumeration', 'attribute']);

/** A generic parsed-XML node: element children keyed by (possibly prefixed) tag name, plus `@_`-prefixed attributes. */
type XmlNode = Record<string, unknown>;

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function asNodeOrUndefined(value: unknown): XmlNode | undefined {
  if (value === undefined || value === null) return undefined;
  return value as XmlNode;
}

/**
 * Reads the root element's `xmlns:*` declarations into a prefix→URI map
 * (design decision 2). A bare `xmlns="..."` (default namespace, no prefix)
 * maps under the empty-string key.
 */
function readNamespaceMap(root: XmlNode): Map<string, string> {
  const map = new Map<string, string>();
  for (const [key, value] of Object.entries(root)) {
    if (key === '@_xmlns' && typeof value === 'string') {
      map.set('', value);
    } else if (key.startsWith('@_xmlns:') && typeof value === 'string') {
      map.set(key.slice('@_xmlns:'.length), value);
    }
  }
  return map;
}

/** Resolves the XSD namespace's own declared prefix (e.g. `'xs'`, `'xsd'`, or `''` for a default-namespace document). Throws if the document never declares the XSD namespace at all — there is no vocabulary to walk without it. */
function resolveXsdPrefix(nsMap: ReadonlyMap<string, string>): string {
  for (const [prefix, uri] of nsMap) {
    if (uri === XSD_NS) return prefix;
  }
  throw new Error(
    `rune-codegen import: no xmlns declaration for '${XSD_NS}' was found on the schema root — this does not look like an XSD document.`
  );
}

/** Builds the tag-name-keyed `isArray` predicate for the DECLARED xsd prefix (design decisions 1+2 combined). */
function buildIsArray(xsdPrefix: string): (tagName: string) => boolean {
  const qualify = (local: string): string => (xsdPrefix ? `${xsdPrefix}:${local}` : local);
  const alwaysArrayTags = new Set([...ALWAYS_ARRAY_LOCAL_NAMES].map(qualify));
  return (tagName: string) => alwaysArrayTags.has(tagName);
}

/**
 * Splits a `${prefix}:${local}` (or unprefixed `${local}`) tag name into its
 * local part, given the resolved xsd prefix — used to test "is this an
 * xs:foo tag" without hardcoding the prefix string.
 */
function localName(tagName: string): string {
  const idx = tagName.indexOf(':');
  return idx === -1 ? tagName : tagName.slice(idx + 1);
}

/**
 * Resolves a `@_type="prefix:LocalName"` / `@_base="prefix:LocalName"`
 * value into its LOCAL name (namespace-stripped, design decision 2) plus
 * whether that prefix resolved to the XSD namespace itself (a builtin) or
 * some other namespace (a reference to another named Rune type — including
 * an UNRESOLVED prefix, which is treated as a same-document reference
 * rather than failing outright, since real-world documents sometimes bind
 * the target namespace to no prefix or to the same prefix as another use).
 */
function resolveTypeRef(
  raw: string,
  nsMap: ReadonlyMap<string, string>,
  xsdPrefix: string
): { local: string; isBuiltin: boolean } {
  const idx = raw.indexOf(':');
  if (idx === -1) {
    // No prefix at all. In a document that always prefixes xs: types
    // (xsdPrefix !== ''), an unprefixed reference is always a local
    // same-document reference (never a builtin — a properly authored such
    // document always writes e.g. `xs:string` explicitly). In a
    // DEFAULT-namespace document (xsdPrefix === ''), an unprefixed
    // reference could be EITHER a genuine builtin (`type="string"`) OR a
    // same-document reference to a locally-declared complexType/simpleType
    // that is equally unprefixed under a default namespace — the prefix
    // style alone can't distinguish them. A prior version treated EVERY
    // unprefixed reference in a default-namespace document as a builtin,
    // silently dropping every local-type reference (`extends`, an enum
    // reference, a cross-type reference) — a real, critical bug found via
    // PR review, invisible to the test suite's only no-prefix test (which
    // happened to reference just a builtin). Resolve by checking whether
    // `raw` is actually a KNOWN XSD builtin keyword, not by prefix style.
    const isBuiltin = xsdPrefix === '' && raw in BUILTIN_TYPE_MAP;
    return { local: raw, isBuiltin };
  }
  const prefix = raw.slice(0, idx);
  const local = raw.slice(idx + 1);
  const uri = nsMap.get(prefix);
  return { local, isBuiltin: uri === XSD_NS };
}

// --- builtin type mapping ----------------------------------------------------

const BUILTIN_TYPE_MAP: Readonly<Record<string, string>> = {
  string: 'string',
  decimal: 'number',
  double: 'number',
  float: 'number',
  int: 'int',
  integer: 'int',
  long: 'int',
  short: 'int',
  boolean: 'boolean',
  date: 'date',
  dateTime: 'dateTime'
};

// --- naming ------------------------------------------------------------------

/** XSD complexType/simpleType names are used verbatim as Rune type/enum names when already ValidID-safe; sanitized otherwise. */
function toTypeName(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : sanitizeIdentifier(name, 'Type');
}

/** XSD element/attribute names are used verbatim when already ValidID-safe; sanitized otherwise (matches json-schema-reader.ts's `toAttributeName`). */
function toAttributeName(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : sanitizeIdentifier(name, 'value');
}

// --- cardinality ---------------------------------------------------------

/** `minOccurs`/`maxOccurs` → `SourceCardinality` (spec.md Phase 3's exact mapping) — `xs:element` shape. */
function readCardinality(node: XmlNode): SourceCardinality {
  const minRaw = node['@_minOccurs'];
  const maxRaw = node['@_maxOccurs'];
  const inf = minRaw === undefined || minRaw === '1' ? 1 : Number(minRaw);
  if (maxRaw === undefined || maxRaw === '1') return { inf, sup: 1 };
  if (maxRaw === 'unbounded') return { inf };
  const sup = Number(maxRaw);
  return Number.isFinite(sup) && sup > 1 ? { inf } : { inf, sup: Number.isFinite(sup) ? sup : 1 };
}

/**
 * `xs:attribute` has NO `minOccurs`/`maxOccurs` at all (that's an
 * `xs:element`-only pair) — its own occurrence marker is `use="required" |
 * "optional" | "prohibited"`, defaulting to `"optional"` per the XSD spec.
 * Not explicit in spec.md's vocabulary table (which only names
 * `minOccurs`/`maxOccurs`) — this is the natural reading of "an XSD
 * attribute maps to a SourceAttribute" applied to XSD's own real default
 * (an unmarked `xs:attribute` is optional, matching how an unmarked
 * `xs:element` is REQUIRED — the two constructs' defaults are opposite, a
 * real gap found empirically while implementing, not assumed). Always
 * `sup: 1` — attributes are never multi-valued in XSD.
 */
function readAttributeUseCardinality(node: XmlNode): SourceCardinality {
  const use = node['@_use'] as string | undefined;
  return { inf: use === 'required' ? 1 : 0, sup: 1 };
}

// --- reader options --------------------------------------------------------

import type { z } from 'zod';
import type { XsdImportOptionsSchema } from '../../options/xsd-import-options.js';

/** See json-schema-reader.ts's `JsonSchemaImportOptions` for why this extends `z.input`, not `z.infer`. */
export interface XsdImportOptions extends z.input<typeof XsdImportOptionsSchema> {
  /** Overrides namespace derivation; falls back to a sanitized targetNamespace when omitted. */
  namespace?: string;
}

// --- restriction facets -----------------------------------------------------

interface RestrictionFacets {
  base?: string;
  enumerationValues?: XmlNode[];
  minInclusive?: string;
  maxInclusive?: string;
  minExclusive?: string;
  maxExclusive?: string;
  minLength?: string;
  maxLength?: string;
  length?: string;
  pattern?: string;
  hasUnion: boolean;
}

/** Reads an `xs:restriction`'s own children into a flat facet bag (a restriction has each numeric/string facet at most once — no `isArray` entry needed for these). */
function readRestriction(restriction: XmlNode, xsdPrefix: string): RestrictionFacets {
  const q = (local: string): string => (xsdPrefix ? `${xsdPrefix}:${local}` : local);
  const facetValue = (local: string): string | undefined =>
    asNodeOrUndefined(restriction[q(local)])?.['@_value'] as string | undefined;
  return {
    base: restriction['@_base'] as string | undefined,
    enumerationValues: restriction[q('enumeration')] as XmlNode[] | undefined,
    minInclusive: facetValue('minInclusive'),
    maxInclusive: facetValue('maxInclusive'),
    minExclusive: facetValue('minExclusive'),
    maxExclusive: facetValue('maxExclusive'),
    minLength: facetValue('minLength'),
    maxLength: facetValue('maxLength'),
    length: facetValue('length'),
    pattern: facetValue('pattern'),
    hasUnion: restriction[q('union')] !== undefined
  };
}

/** A restriction is enum-shaped (→ `SourceEnum`) only when it has `xs:enumeration` children and NO other facet (spec.md Phase 3: "ONLY `xs:enumeration` children, no numeric/pattern facets alongside"). */
function isEnumRestriction(facets: RestrictionFacets): boolean {
  return (
    (facets.enumerationValues?.length ?? 0) > 0 &&
    facets.minInclusive === undefined &&
    facets.maxInclusive === undefined &&
    facets.minExclusive === undefined &&
    facets.maxExclusive === undefined &&
    facets.minLength === undefined &&
    facets.maxLength === undefined &&
    facets.length === undefined &&
    facets.pattern === undefined
  );
}

/** Translates a scalar simpleType's own restriction facets into `ConstraintIR`s attached to the REFERENCING attribute (spec.md Phase 3: Rune has no first-class restricted-scalar-type concept). One `range` IR PER BOUND, never coalesced (per-bound-exclusivity discipline, matching every other reader). */
function facetsToConstraints(facets: RestrictionFacets, path: string, diagnostics: ImportDiagnostic[]): ConstraintIR[] {
  const constraints: ConstraintIR[] = [];
  if (facets.minInclusive !== undefined) {
    constraints.push({ kind: 'range', path, min: Number(facets.minInclusive) });
  }
  if (facets.maxInclusive !== undefined) {
    constraints.push({ kind: 'range', path, max: Number(facets.maxInclusive) });
  }
  if (facets.minExclusive !== undefined) {
    constraints.push({ kind: 'range', path, min: Number(facets.minExclusive), exclusive: true });
  }
  if (facets.maxExclusive !== undefined) {
    constraints.push({ kind: 'range', path, max: Number(facets.maxExclusive), exclusive: true });
  }
  if (facets.minLength !== undefined || facets.maxLength !== undefined || facets.length !== undefined) {
    const min =
      facets.length !== undefined
        ? Number(facets.length)
        : facets.minLength !== undefined
          ? Number(facets.minLength)
          : undefined;
    const max =
      facets.length !== undefined
        ? Number(facets.length)
        : facets.maxLength !== undefined
          ? Number(facets.maxLength)
          : undefined;
    constraints.push({ kind: 'length', path, ...(min !== undefined && { min }), ...(max !== undefined && { max }) });
  }
  if (facets.pattern !== undefined) {
    // Diagnostic intentionally NOT pushed here — constraint-translator.ts's
    // `translateConstraintExpression` already pushes one `untranslatable-
    // construct` warning for every `pattern` IR when it emits the stub
    // (matches json-schema-reader.ts's own `pushRangeConstraint`-adjacent
    // comment for the identical reasoning).
    constraints.push({ kind: 'pattern', path, regex: facets.pattern });
  }
  if (facets.hasUnion) {
    pushDiagnostic(diagnostics, {
      severity: 'warning',
      code: 'unsupported-xsd-union',
      message: `simpleType restriction for '${path}': xs:union has no Rune equivalent — member types ignored`
    });
  }
  return constraints;
}

// --- top-level schema walking ------------------------------------------------

interface NamedSimpleType {
  name: string;
  facets: RestrictionFacets;
  isEnum: boolean;
}

/** Reads every top-level `xs:simpleType`, classifying each as enum-shaped or scalar-restricted (spec.md Phase 3's disambiguation rule). */
function collectSimpleTypes(schema: XmlNode, xsdPrefix: string): Map<string, NamedSimpleType> {
  const q = (local: string): string => (xsdPrefix ? `${xsdPrefix}:${local}` : local);
  const simpleTypes = asArray<XmlNode>(schema[q('simpleType')] as XmlNode[] | undefined);
  const byName = new Map<string, NamedSimpleType>();
  for (const st of simpleTypes) {
    const name = st['@_name'] as string | undefined;
    if (!name) continue;
    const restriction = asNodeOrUndefined(st[q('restriction')]);
    // xs:union is a SIBLING of xs:restriction under xs:simpleType (a
    // simpleType has exactly one of restriction/union/list as its child),
    // not nested inside it — a bare `<xs:union>` with no restriction at all
    // must still be detected here, not only when it happens to appear
    // alongside restriction facets (readRestriction only ever looks INSIDE
    // a restriction node).
    const bareUnion = st[q('union')] !== undefined;
    const facets = restriction ? readRestriction(restriction, xsdPrefix) : { hasUnion: bareUnion };
    byName.set(name, { name, facets, isEnum: isEnumRestriction(facets) });
  }
  return byName;
}

function buildEnumFromSimpleType(named: NamedSimpleType): SourceEnum {
  const used = new Set<string>();
  const values = (named.facets.enumerationValues ?? []).map((ev) => {
    const original = String(ev['@_value'] ?? '');
    const name = dedupeIdentifier(sanitizeIdentifier(original, 'VALUE'), used);
    return {
      name,
      sourceKey: original,
      ...(name !== original && { displayName: original })
    };
  });
  return { name: toTypeName(named.name), sourceKey: named.name, values };
}

/** Resolves a `@_type`/`@_base` reference to the Rune typeName it should become: a builtin, an enum-shaped simpleType's Rune name, a scalar-restricted simpleType's underlying builtin (with facets returned separately for the caller to attach), or (falling through) the namespace-stripped local name of another named complexType. */
function resolveElementType(
  rawType: string,
  nsMap: ReadonlyMap<string, string>,
  xsdPrefix: string,
  simpleTypes: ReadonlyMap<string, NamedSimpleType>
): { typeName: string; scalarFacets?: RestrictionFacets } {
  const { local, isBuiltin } = resolveTypeRef(rawType, nsMap, xsdPrefix);
  if (isBuiltin) {
    return { typeName: BUILTIN_TYPE_MAP[local] ?? 'string' };
  }
  const simple = simpleTypes.get(local);
  if (simple) {
    if (simple.isEnum) return { typeName: toTypeName(simple.name) };
    // Scalar-restricted simpleType: resolve to the Rune builtin matching its
    // OWN base, attach the facets to the referencing attribute instead
    // (spec.md Phase 3 — Rune has no first-class restricted-scalar type).
    const baseTypeName = simple.facets.base
      ? resolveElementType(simple.facets.base, nsMap, xsdPrefix, simpleTypes).typeName
      : 'string';
    return { typeName: baseTypeName, scalarFacets: simple.facets };
  }
  // Not a builtin, not a known simpleType — assume a reference to a named
  // complexType (resolved by `toTypeName` the same way the complexType's own
  // declaration name is sanitized, so references and declarations agree).
  return { typeName: toTypeName(local) };
}

interface ElementLike {
  name: string;
  rawType?: string;
  cardinality: SourceCardinality;
  abstract: boolean;
  substitutionGroup?: string;
  /** `@_ref` — a same-document reference to an already-declared top-level `xs:element` (name + type resolved via `topLevelElements`, see `resolveElementRef`). Mutually exclusive with `name`/`rawType` being independently meaningful: a `ref=` element has NO `@_name`/`@_type` of its own per the XSD spec. */
  ref?: string;
}

/**
 * Reads a common shape shared by `xs:element` and `xs:attribute` nodes.
 * `isAttribute` selects the cardinality rule: `xs:element`'s
 * `minOccurs`/`maxOccurs` (`readCardinality`, defaulting to REQUIRED) vs.
 * `xs:attribute`'s `use=` (`readAttributeUseCardinality`, defaulting to
 * OPTIONAL) — the two constructs' unmarked defaults are opposite, so this
 * cannot be inferred from the node's own shape alone (a plain `xs:attribute`
 * with no `use=` at all is indistinguishable, attribute-wise, from a plain
 * `xs:element` with no `minOccurs=` — both simply have neither marker
 * present); the caller already knows which XSD construct it read the node
 * from (`xs:element` vs `xs:attribute` children are collected separately in
 * `readComplexType`), so that context is threaded through explicitly here.
 */
function readElementLike(node: XmlNode, isAttribute: boolean): ElementLike {
  return {
    name: (node['@_name'] as string | undefined) ?? '',
    rawType: node['@_type'] as string | undefined,
    cardinality: isAttribute ? readAttributeUseCardinality(node) : readCardinality(node),
    abstract: node['@_abstract'] === 'true' || node['@_abstract'] === true,
    substitutionGroup: node['@_substitutionGroup'] as string | undefined,
    ref: node['@_ref'] as string | undefined
  };
}

/**
 * Resolves an `xs:element ref="..."` against the document's OWN
 * already-collected top-level `xs:element` declarations (`topLevelElements`,
 * keyed by LOCAL name — same-document resolution only, per XSD's `ref=`
 * semantics; multi-file `xs:import`/`xs:include` resolution is out of MVP
 * scope, handled separately). Returns the resolved `{name, rawType}` pair
 * when found; `undefined` (with a diagnostic already pushed by the caller)
 * when the reference cannot be resolved in this document — NEVER fabricates
 * a placeholder attribute, since a silent empty-name/empty-type fallback is
 * data corruption, not graceful degradation.
 */
function resolveElementRef(
  ref: string,
  nsMap: ReadonlyMap<string, string>,
  xsdPrefix: string,
  topLevelElements: ReadonlyMap<string, ElementLike>
): ElementLike | undefined {
  const { local } = resolveTypeRef(ref, nsMap, xsdPrefix);
  return topLevelElements.get(local);
}

function buildAttributeFromElementLike(
  el: ElementLike,
  nsMap: ReadonlyMap<string, string>,
  xsdPrefix: string,
  simpleTypes: ReadonlyMap<string, NamedSimpleType>,
  diagnostics: ImportDiagnostic[],
  skipConditions: boolean,
  topLevelElements: ReadonlyMap<string, ElementLike>,
  cardinalityOverride?: SourceCardinality
): SourceAttribute | undefined {
  if (el.ref) {
    const resolved = resolveElementRef(el.ref, nsMap, xsdPrefix, topLevelElements);
    if (!resolved) {
      pushDiagnostic(diagnostics, {
        severity: 'warning',
        code: 'unresolved-element-ref',
        message: `xs:element ref="${el.ref}" could not be resolved against any top-level xs:element declaration in this document — skipped (multi-file resolution is out of scope)`
      });
      return undefined;
    }
    // The referencing site's OWN minOccurs/maxOccurs (cardinality) still
    // applies — only name/type come from the referenced top-level element
    // (an xs:element with ref= has no @_name/@_type of its own per the XSD
    // spec, so el.name/el.rawType are always empty here).
    el = { ...resolved, cardinality: el.cardinality };
  }
  if (el.substitutionGroup) {
    pushDiagnostic(diagnostics, {
      severity: 'warning',
      code: 'unsupported-substitution-group',
      message: `element '${el.name}': substitutionGroup ('${el.substitutionGroup}') has no Rune equivalent — imported structurally, without substitution-group semantics`
    });
  }
  const attrName = toAttributeName(el.name);
  const resolved = el.rawType ? resolveElementType(el.rawType, nsMap, xsdPrefix, simpleTypes) : { typeName: 'string' };
  const constraints: ConstraintIR[] = [];
  if (!skipConditions && resolved.scalarFacets) {
    // Use the SANITIZED attribute name (attrName), not the original XML
    // element name (el.name), as the ConstraintIR's path — the emitted
    // condition references the actual Rune attribute, which is always
    // attrName. Passing el.name here would break the grammar outright for
    // any XSD element name needing sanitization (e.g. a hyphenated name),
    // since the rendered condition would reference a nonexistent path.
    constraints.push(...facetsToConstraints(resolved.scalarFacets, attrName, diagnostics));
  }
  return {
    name: attrName,
    typeName: resolved.typeName,
    cardinality: cardinalityOverride ?? el.cardinality,
    sourceKey: el.name,
    constraints
  };
}

interface ComplexTypeShape {
  name: string;
  abstract: boolean;
  extendsRaw?: string;
  /** Attribute-like elements from xs:sequence/xs:all (in document order). */
  memberElements: ElementLike[];
  /** xs:choice member elements, if a top-level (non-nested) xs:choice is present. */
  choiceElements: ElementLike[];
  /** The xs:choice element's OWN `@_minOccurs` ('0' -> optional; default/absent/'1' -> mandatory), per XSD's own minOccurs default semantics — read only when `choiceElements` is non-empty. */
  choiceMinOccurs?: string;
  /** xs:attribute children (complexType's own, or the xs:extension's own). */
  attributeElements: ElementLike[];
  hasMixedContent: boolean;
  hasGroupRef: boolean;
  hasAttributeGroupRef: boolean;
}

/** Reads one top-level `xs:complexType`'s structural shape (sequence/choice/all + attributes + optional extension), handling both the plain and `xs:complexContent`/`xs:extension` forms. */
function readComplexType(ct: XmlNode, xsdPrefix: string): ComplexTypeShape {
  const q = (local: string): string => (xsdPrefix ? `${xsdPrefix}:${local}` : local);
  const name = (ct['@_name'] as string | undefined) ?? '';
  const abstract = ct['@_abstract'] === 'true' || ct['@_abstract'] === true;
  const mixed = ct['@_mixed'] === 'true' || ct['@_mixed'] === true;

  const complexContent = asNodeOrUndefined(ct[q('complexContent')]);
  const extension = complexContent ? asNodeOrUndefined(complexContent[q('extension')]) : undefined;
  const body = extension ?? ct;
  const extendsRaw = extension?.['@_base'] as string | undefined;
  const bodyMixed = complexContent ? complexContent['@_mixed'] === 'true' || complexContent['@_mixed'] === true : mixed;

  const sequence = asNodeOrUndefined(body[q('sequence')]);
  const all = asNodeOrUndefined(body[q('all')]);
  const choice = asNodeOrUndefined(body[q('choice')]);
  const container = sequence ?? all;

  const memberElements = asArray<XmlNode>(container?.[q('element')] as XmlNode[] | undefined).map((n) =>
    readElementLike(n, false)
  );
  // A nested xs:choice inside the sequence (the common shape) is ALSO
  // recognized, not only a bare top-level xs:choice replacing the sequence
  // entirely — both are real XSD shapes.
  const nestedChoice = container ? asNodeOrUndefined(container[q('choice')]) : undefined;
  const effectiveChoice = choice ?? nestedChoice;
  const choiceElements = asArray<XmlNode>(effectiveChoice?.[q('element')] as XmlNode[] | undefined).map((n) =>
    readElementLike(n, false)
  );
  const choiceMinOccurs = effectiveChoice?.['@_minOccurs'] as string | undefined;

  const attributeElements = asArray<XmlNode>(body[q('attribute')] as XmlNode[] | undefined).map((n) =>
    readElementLike(n, true)
  );

  const hasGroupRef = (container?.[q('group')] ?? body[q('group')]) !== undefined;
  const hasAttributeGroupRef = body[q('attributeGroup')] !== undefined;

  return {
    name,
    abstract,
    extendsRaw,
    memberElements,
    choiceElements,
    choiceMinOccurs,
    attributeElements,
    hasMixedContent: bodyMixed,
    hasGroupRef,
    hasAttributeGroupRef
  };
}

/** Builds one `SourceType` from a complexType's structural shape. */
function buildType(
  shape: ComplexTypeShape,
  nsMap: ReadonlyMap<string, string>,
  xsdPrefix: string,
  simpleTypes: ReadonlyMap<string, NamedSimpleType>,
  diagnostics: ImportDiagnostic[],
  skipConditions: boolean,
  topLevelElements: ReadonlyMap<string, ElementLike>
): SourceType {
  const typeName = toTypeName(shape.name);

  if (shape.abstract) {
    pushDiagnostic(diagnostics, {
      severity: 'info',
      code: 'unsupported-abstract-type',
      message: `complexType '${shape.name}': abstract="true" has no Rune equivalent — imported as a normal (non-abstract) type`
    });
  }
  if (shape.hasMixedContent) {
    pushDiagnostic(diagnostics, {
      severity: 'warning',
      code: 'unsupported-mixed-content',
      message: `complexType '${shape.name}': mixed content has no Rune equivalent — text content alongside child elements is not imported`
    });
  }
  if (shape.hasGroupRef) {
    pushDiagnostic(diagnostics, {
      severity: 'warning',
      code: 'unsupported-xsd-group-ref',
      message: `complexType '${shape.name}': xs:group reference has no Rune equivalent — skipped (group contents are not inlined)`
    });
  }
  if (shape.hasAttributeGroupRef) {
    pushDiagnostic(diagnostics, {
      severity: 'warning',
      code: 'unsupported-xsd-attribute-group-ref',
      message: `complexType '${shape.name}': xs:attributeGroup reference has no Rune equivalent — skipped`
    });
  }

  let extendsName: string | undefined;
  if (shape.extendsRaw) {
    const { local, isBuiltin } = resolveTypeRef(shape.extendsRaw, nsMap, xsdPrefix);
    if (isBuiltin) {
      pushDiagnostic(diagnostics, {
        severity: 'warning',
        code: 'unsupported-builtin-extension',
        message: `complexType '${shape.name}': xs:extension base '${shape.extendsRaw}' is an XSD builtin, not another named complexType — extends omitted`
      });
    } else {
      extendsName = toTypeName(local);
    }
  }

  // buildAttributeFromElementLike returns undefined for an unresolvable
  // xs:element ref= (diagnostic already pushed there) — filtered out here
  // rather than fabricated as a garbage attribute.
  const memberAttributes = shape.memberElements
    .map((el) =>
      buildAttributeFromElementLike(el, nsMap, xsdPrefix, simpleTypes, diagnostics, skipConditions, topLevelElements)
    )
    .filter((a): a is SourceAttribute => a !== undefined);
  const choiceAttributes = shape.choiceElements
    .map((el) =>
      // Every choice member becomes a (0..1) attribute regardless of its own
      // minOccurs/maxOccurs (spec.md Phase 3's exact rule).
      buildAttributeFromElementLike(el, nsMap, xsdPrefix, simpleTypes, diagnostics, skipConditions, topLevelElements, {
        inf: 0,
        sup: 1
      })
    )
    .filter((a): a is SourceAttribute => a !== undefined);
  const attributeAttributes = shape.attributeElements
    .map((el) =>
      buildAttributeFromElementLike(el, nsMap, xsdPrefix, simpleTypes, diagnostics, skipConditions, topLevelElements)
    )
    .filter((a): a is SourceAttribute => a !== undefined);

  const attributes: SourceAttribute[] = [...memberAttributes, ...choiceAttributes, ...attributeAttributes];

  const constraints: ConstraintIR[] = [];
  if (!skipConditions && choiceAttributes.length > 0) {
    // Use the RESOLVED attribute names (post ref= resolution + sanitization),
    // not shape.choiceElements' own raw el.name — a ref= choice member has an
    // empty el.name (an xs:element with ref= carries no @_name of its own),
    // so deriving paths from choiceAttributes keeps this correct for both
    // plain and ref= choice members.
    const paths = choiceAttributes.map((a) => a.name);
    // The xs:choice element's OWN @_minOccurs decides mandatory vs optional
    // (XSD default, when absent, is "1" — a bare <xs:choice> is mandatory):
    // minOccurs="0" -> a legitimately OPTIONAL group -> {kind: 'choice'}
    // (Rune's "at most one, optional" idiom); absent/"1" -> the established
    // MANDATORY {kind: 'oneOf'} default. Never inferred from the members'
    // own occurrence markers — those are independently normalized to
    // (0..1) regardless (see buildAttributeFromElementLike's cardinality
    // override above).
    constraints.push(shape.choiceMinOccurs === '0' ? { kind: 'choice', paths } : { kind: 'oneOf', paths });
  }

  return {
    name: typeName,
    sourceKey: shape.name,
    ...(extendsName !== undefined && { extends: extendsName }),
    attributes,
    constraints
  };
}

// --- namespace derivation ----------------------------------------------------

const NAMESPACE_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

function isValidNamespace(ns: string): boolean {
  return NAMESPACE_RE.test(ns);
}

/** Derives a Rune-safe dotted namespace from `--namespace` (always wins) or `targetNamespace` (best-effort sanitization — XSD's targetNamespace is typically a bare URN/URL with no guaranteed reverse-DNS structure, unlike JSON Schema's `$id`). */
function deriveNamespace(schema: XmlNode, options: XsdImportOptions): string {
  if (options.namespace !== undefined) {
    if (!isValidNamespace(options.namespace)) {
      throw new Error(
        `rune-codegen import: the supplied --namespace override ('${options.namespace}') is not a valid Rune namespace (expected dot-separated identifiers, e.g. 'com.example.trade').`
      );
    }
    return options.namespace;
  }
  const targetNamespace = schema['@_targetNamespace'] as string | undefined;
  if (targetNamespace) {
    let candidate: string | undefined;
    try {
      const url = new URL(targetNamespace);
      const hostSegments = url.hostname.split('.').filter(Boolean).reverse();
      const pathSegments = url.pathname.split('/').filter(Boolean);
      const segments = [...hostSegments, ...pathSegments].map(sanitizeNamespaceSegment).filter(Boolean);
      candidate = segments.length > 0 ? segments.join('.') : undefined;
    } catch {
      const segments = targetNamespace
        .split(/[:/.]+/)
        .map(sanitizeNamespaceSegment)
        .filter(Boolean);
      candidate = segments.length > 0 ? segments.join('.') : undefined;
    }
    if (candidate && isValidNamespace(candidate)) return candidate;
  }
  throw new Error(
    `rune-codegen import: unable to derive a Rune namespace from targetNamespace ('${targetNamespace ?? '<absent>'}') — supply --namespace explicitly.`
  );
}

// --- top-level entry point ---------------------------------------------------

/** Reads a full XSD document (a single `xs:schema` root) into a `SourceModel`. */
export function readXsd(
  xmlText: string,
  options: XsdImportOptions = {}
): { model: SourceModel; diagnostics: ImportDiagnostic[] } {
  const diagnostics: ImportDiagnostic[] = [];

  // First pass: prefix-agnostic parse (no isArray forcing yet) purely to
  // read the root element's xmlns:* declarations — cheap, since we only
  // look at attributes here, never at repeated-tag children.
  const probeParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  const probed = probeParser.parse(xmlText) as XmlNode;
  const rootKey = Object.keys(probed).find((k) => k !== '?xml' && localName(k) === 'schema');
  if (!rootKey) {
    throw new Error(`rune-codegen import: no 'schema' root element found (expected an xs:schema/xsd:schema document).`);
  }
  const rootProbe = probed[rootKey] as XmlNode;
  const nsMap = readNamespaceMap(rootProbe);
  const xsdPrefix = resolveXsdPrefix(nsMap);

  // Second pass: full parse with the isArray predicate configured for the
  // document's OWN declared xsd prefix (design decisions 1+2 combined).
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    isArray: buildIsArray(xsdPrefix)
  });
  const parsed = parser.parse(xmlText) as XmlNode;
  const schema = parsed[rootKey] as XmlNode;

  const q = (local: string): string => (xsdPrefix ? `${xsdPrefix}:${local}` : local);

  for (const importTag of asArray<XmlNode>(schema[q('import')] as XmlNode | XmlNode[] | undefined)) {
    pushDiagnostic(diagnostics, {
      severity: 'warning',
      code: 'unsupported-xsd-import',
      message: `xs:import (namespace '${importTag['@_namespace'] ?? '<none>'}', schemaLocation '${importTag['@_schemaLocation'] ?? '<none>'}') — multi-file schema composition is not supported; only this single document was read`
    });
  }
  for (const includeTag of asArray<XmlNode>(schema[q('include')] as XmlNode | XmlNode[] | undefined)) {
    pushDiagnostic(diagnostics, {
      severity: 'warning',
      code: 'unsupported-xsd-include',
      message: `xs:include (schemaLocation '${includeTag['@_schemaLocation'] ?? '<none>'}') — multi-file schema composition is not supported; only this single document was read`
    });
  }
  for (const groupDecl of asArray<XmlNode>(schema[q('group')] as XmlNode | XmlNode[] | undefined)) {
    pushDiagnostic(diagnostics, {
      severity: 'warning',
      code: 'unsupported-xsd-group-decl',
      message: `top-level xs:group '${groupDecl['@_name'] ?? '<anonymous>'}' has no Rune equivalent — skipped`
    });
  }
  for (const attrGroupDecl of asArray<XmlNode>(schema[q('attributeGroup')] as XmlNode | XmlNode[] | undefined)) {
    pushDiagnostic(diagnostics, {
      severity: 'warning',
      code: 'unsupported-xsd-attribute-group-decl',
      message: `top-level xs:attributeGroup '${attrGroupDecl['@_name'] ?? '<anonymous>'}' has no Rune equivalent — skipped`
    });
  }

  const namespace = deriveNamespace(schema, options);
  const simpleTypesByName = collectSimpleTypes(schema, xsdPrefix);

  const enums: SourceEnum[] = [];
  for (const named of simpleTypesByName.values()) {
    if (named.isEnum) {
      enums.push(buildEnumFromSimpleType(named));
    } else if (named.facets.hasUnion) {
      pushDiagnostic(diagnostics, {
        severity: 'warning',
        code: 'unsupported-xsd-union',
        message: `simpleType '${named.name}': xs:union has no Rune equivalent — not imported as a standalone type`
      });
    }
  }

  // Top-level xs:element declarations, collected BEFORE buildType runs so
  // `ref=` resolution (Finding 2: same-document `xs:element ref="..."`
  // resolution) can look them up — reused for both that purpose AND the
  // pre-existing abstract/substitutionGroup diagnostics below (a single
  // collection, not two — the diagnostics loop previously built its own
  // separate list after buildType had already run).
  const topLevelElementList = asArray<XmlNode>(schema[q('element')] as XmlNode | XmlNode[] | undefined)
    .map((n) => readElementLike(n, false))
    .filter((el) => el.name.length > 0);
  const topLevelElementsByName = new Map(topLevelElementList.map((el) => [el.name, el]));

  const complexTypes = asArray<XmlNode>(schema[q('complexType')] as XmlNode | XmlNode[] | undefined).filter(
    (ct) => typeof ct['@_name'] === 'string' && ct['@_name'].length > 0
  );
  const types: SourceType[] = complexTypes.map((ct) =>
    buildType(
      readComplexType(ct, xsdPrefix),
      nsMap,
      xsdPrefix,
      simpleTypesByName,
      diagnostics,
      options.skipConditions ?? false,
      topLevelElementsByName
    )
  );

  if (options.importTopLevelElements) {
    for (const el of topLevelElementList) {
      const typeName = toTypeName(el.name);
      if (types.some((t) => t.name === typeName)) continue;
      // A bare top-level xs:element (no inline complexType, just type=) has
      // no attributes of its own in this reader's object-shaped SourceType
      // model — wrap its resolved type as a single 'value' attribute, the
      // same buildAttributeFromElementLike pipeline buildType's own
      // member/choice/attribute branches already use for every other
      // element-to-attribute conversion in this file.
      const attribute = buildAttributeFromElementLike(
        { ...el, name: 'value' },
        nsMap,
        xsdPrefix,
        simpleTypesByName,
        diagnostics,
        options.skipConditions ?? false,
        topLevelElementsByName
      );
      types.push({
        name: typeName,
        sourceKey: el.name,
        attributes: attribute ? [attribute] : [],
        constraints: []
      });
    }
  }

  for (const el of topLevelElementList) {
    if (el.abstract) {
      pushDiagnostic(diagnostics, {
        severity: 'info',
        code: 'unsupported-abstract-element',
        message: `top-level element '${el.name}': abstract="true" has no Rune equivalent — not imported as a distinct construct`
      });
    }
    if (el.substitutionGroup) {
      pushDiagnostic(diagnostics, {
        severity: 'warning',
        code: 'unsupported-substitution-group',
        message: `top-level element '${el.name}': substitutionGroup ('${el.substitutionGroup}') has no Rune equivalent — not imported as a distinct construct`
      });
    }
  }

  return {
    model: { namespace, sourceName: 'Xsd', types, enums, funcs: [] },
    diagnostics
  };
}
