// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Emits Rune namespaces as XSD using the vocabulary supported by xsd-reader.ts.
 *
 * Mapping:
 * - Data becomes a named xs:complexType containing an xs:sequence of elements.
 *   Cardinality maps to minOccurs/maxOccurs; default bounds of 1 are omitted,
 *   and unbounded upper bounds use maxOccurs="unbounded". Type references use
 *   local names in a single document with a fixed xs: prefix.
 * - Enumerations become named xs:simpleType restrictions on xs:string.
 *   Values use Rune identifiers, not the original literals stored in synonyms.
 * - Data.superType becomes xs:complexContent/xs:extension. Only the child's own
 *   attributes are emitted inside the extension.
 * - Required/optional choice conditions group their attributes in xs:choice.
 *   Optional groups use minOccurs="0"; required groups use the default of 1.
 *   Members retain XSD's default occurrence bounds: copying their Rune (0..1)
 *   cardinality would allow an empty member to satisfy a required group.
 * - Choice declarations also become complex types with xs:choice, but importing
 *   them yields attributes plus a condition, not a Rune Choice declaration.
 *
 * Constraint facets:
 * - Range bounds become min/maxInclusive or min/maxExclusive. Mixed bounds
 *   share one restriction. Length bounds become minLength/maxLength, or length
 *   when both bounds are equal.
 * - Each constrained attribute references a unique, named top-level simpleType
 *   via its type attribute. The reader does not recover facets from anonymous
 *   simpleTypes nested inside elements; without a type reference it falls back
 *   to string and loses those constraints.
 * - Conditions beyond choice groups and scalar facets are not represented.
 *   There is no opaque metadata sidecar. Pattern facets and funcs/operations
 *   are not emitted.
 */

import {
  isChoice,
  isData,
  type Choice,
  type Data,
  type Attribute,
  type RosettaCardinality,
  type RosettaEnumeration,
  type RosettaTypeAlias,
  type Condition,
  type TypeCall
} from '@rune-langium/core';
import type { GeneratorOptions, GeneratorOutput } from '../types.js';
import { emitNamespaceWithContract } from './namespace-emitter.js';
import type { NamespaceEmitterOptions } from './namespace-emitter.js';
import { BaseNamespaceEmitter, decodeCardinality, choiceOptionFieldName } from './base-namespace-emitter.js';
import type { NamespaceRegistry } from './namespace-registry.js';
import { getTargetRelativePath, type NamespaceWalkResult } from './namespace-walker.js';
import { recognizeCondition } from './constraint-recognizer.js';
import type { ConstraintIR } from '../import/source-model.js';
import { debug } from '../instrument.js';
import { resolveTypeCallTarget, toTypeIndexLookup, type TypeIndexLookup } from './type-ref-resolver.js';

const XSD_NS = 'http://www.w3.org/2001/XMLSchema';

/** Builtin Rune scalar → XSD builtin type name (the inverse of xsd-reader.ts's `BUILTIN_TYPE_MAP`; picks ONE canonical XSD spelling per Rune type — `decimal` for `number`, `int` for the Rune `int` family — since the reader collapses several XSD spellings onto the same Rune type). */
const XSD_BUILTIN_TYPE_MAP: Readonly<Record<string, string>> = {
  string: 'string',
  number: 'decimal',
  int: 'int',
  boolean: 'boolean',
  date: 'date',
  dateTime: 'dateTime'
};

/** Facet keywords for a single-attribute `ConstraintIR`, rendered as `<xs:FACET value="..."/>` children of a (named, top-level — see this module's doc comment for why) `xs:restriction` — the XSD-facet mirror of `constraint-recognizer.ts`'s own `constraintIRToJsonSchemaKeywords`. Type-level constructs (`oneOf`/`choice`) and every other kind return `undefined` — handled separately (`oneOf` → `xs:choice` regrouping; everything else unrepresented, per this module's own doc comment). */
export function constraintIRToXsdFacets(ir: ConstraintIR): Record<string, number> | undefined {
  switch (ir.kind) {
    case 'range': {
      const facets: Record<string, number> = {};
      if (ir.min !== undefined) facets[ir.exclusive ? 'minExclusive' : 'minInclusive'] = ir.min;
      if (ir.max !== undefined) facets[ir.exclusive ? 'maxExclusive' : 'maxInclusive'] = ir.max;
      return Object.keys(facets).length > 0 ? facets : undefined;
    }
    case 'length': {
      if (ir.min !== undefined && ir.max !== undefined && ir.min === ir.max) {
        return { length: ir.min };
      }
      const facets: Record<string, number> = {};
      if (ir.min !== undefined) facets['minLength'] = ir.min;
      if (ir.max !== undefined) facets['maxLength'] = ir.max;
      return Object.keys(facets).length > 0 ? facets : undefined;
    }
    default:
      return undefined;
  }
}

/** XML-escapes a string for use as element/attribute text content or a quoted attribute value. */
function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function indentLines(lines: readonly string[], depth: number): string[] {
  const pad = '  '.repeat(depth);
  return lines.map((l) => (l.length > 0 ? `${pad}${l}` : l));
}

/** One resolved attribute's element shape: name, `type="..."` value (a builtin, another named type, OR — when facets are present — a synthesized named restricted-simpleType name), and cardinality attrs. */
interface ResolvedElement {
  name: string;
  typeName: string;
  minOccurs?: string;
  maxOccurs?: string;
}

/** A synthesized named `xs:simpleType` restricting a builtin base type with recognized facets — emitted as a top-level sibling of the owning complexType, referenced from the element via `@_type` (see this module's doc comment for why: the reader only resolves scalar facets through a NAMED top-level simpleType, never an inline nested one). */
interface RestrictedSimpleType {
  name: string;
  base: string;
  facets: Record<string, number>;
}

function cardinalityAttrs(card: RosettaCardinality): { minOccurs?: string; maxOccurs?: string } {
  const { lower, upper } = decodeCardinality(card);
  const out: { minOccurs?: string; maxOccurs?: string } = {};
  if (lower !== 1) out.minOccurs = String(lower);
  if (upper === null) out.maxOccurs = 'unbounded';
  else if (upper !== 1) out.maxOccurs = String(upper);
  return out;
}

/** Renders one `xs:element` as a plain self-closing tag with a `type="..."` attribute (the type may be a builtin, another named type, or a synthesized named restricted-simpleType — indistinguishable at this call site, by design: the reader resolves all three identically via `@_type`). */
function renderElement(el: ResolvedElement, depth: number): string[] {
  const attrParts = [`name="${escapeXml(el.name)}"`];
  if (el.minOccurs !== undefined) attrParts.push(`minOccurs="${el.minOccurs}"`);
  if (el.maxOccurs !== undefined) attrParts.push(`maxOccurs="${el.maxOccurs}"`);
  attrParts.push(`type="${escapeXml(el.typeName)}"`);
  return indentLines([`<xs:element ${attrParts.join(' ')}/>`], depth);
}

/** Renders one synthesized named restricted-simpleType as a top-level `xs:simpleType`/`xs:restriction` block. */
function renderRestrictedSimpleType(rt: RestrictedSimpleType): string {
  const lines = [
    `<xs:simpleType name="${escapeXml(rt.name)}">`,
    `  <xs:restriction base="${escapeXml(rt.base)}">`,
    ...Object.entries(rt.facets).map(([facet, value]) => `    <xs:${facet} value="${value}"/>`),
    `  </xs:restriction>`,
    `</xs:simpleType>`
  ];
  return lines.join('\n');
}

export function emitNamespace(
  model: NamespaceWalkResult,
  options: GeneratorOptions,
  registry: NamespaceRegistry = { namespaces: new Map() }
): GeneratorOutput {
  return emitNamespaceWithContract(model, options, registry, XsdNamespaceEmitter);
}

export class XsdNamespaceEmitter extends BaseNamespaceEmitter {
  private readonly relativePath: string;
  private readonly complexTypeBlocks: string[] = [];
  private readonly simpleTypeBlocks: string[] = [];
  /** Every top-level `xs:simpleType` name emitted so far in this namespace (enum names + synthesized restricted-simpleType names share one name space) — guards against `synthesizeRestrictedSimpleType` colliding with an enum or another attribute's synthesized type. */
  private readonly usedSimpleTypeNames = new Set<string>();
  /** A real document URI (`model.docs[0]?.uri`) — unlike `NamespaceWalkResult` itself, which has no `sourceUri` field — used both as the shared `sourceUri` for `toTypeIndexLookup`'s wrapped entries and as `resolveTypeCallTarget`'s own `fallbackSourceUri` argument. Mirrors json-schema-emitter.ts's identically-named field. */
  private readonly fallbackSourceUri: string;
  private readonly typeIndex: TypeIndexLookup;

  constructor(
    model: NamespaceWalkResult,
    options: NamespaceEmitterOptions,
    registry: NamespaceRegistry = { namespaces: new Map() }
  ) {
    super(model, options, registry);
    this.relativePath = getTargetRelativePath(model.namespace, 'xsd');
    this.fallbackSourceUri = model.docs[0]?.uri?.toString() ?? '';
    this.typeIndex = toTypeIndexLookup(model, this.fallbackSourceUri);
  }

  @debug()
  emitEnumeration(enumNode: RosettaEnumeration): void {
    this.usedSimpleTypeNames.add(enumNode.name);
    this.simpleTypeBlocks.push(XsdNamespaceEmitter.renderEnumSimpleType(enumNode));
  }

  @debug()
  emitTypeAlias(_typeAlias: RosettaTypeAlias): void {
    // No XSD equivalent for a Rune type alias in spec.md's Phase 3 vocabulary
    // (the reader never produces one either) — silently no-op, matching
    // json-schema-emitter's own scope (a type alias with no XSD-native
    // shape has no established "opaque fallback" convention here since the
    // whole document has no per-property metadata sidecar to attach one to).
  }

  @debug()
  emitData(data: Data): void {
    this.complexTypeBlocks.push(this.renderDataComplexType(data));
  }

  @debug()
  emitChoice(choice: Choice): void {
    this.complexTypeBlocks.push(this.renderChoiceComplexType(choice));
  }

  finalize(): GeneratorOutput {
    const body = [...this.simpleTypeBlocks, ...this.complexTypeBlocks].join('\n\n');
    // Bind the target namespace as the schema's DEFAULT namespace (xmlns=),
    // not just as targetNamespace with no prefix bound to it. In XSD,
    // type=/base= attribute VALUES are QNames resolved via in-scope
    // namespace bindings — they do NOT automatically inherit targetNamespace
    // the way local element names do under elementFormDefault="qualified".
    // Without a default-namespace binding, every bare `type="Party"` is an
    // UNQUALIFIED, no-namespace reference that cannot resolve against the
    // real (namespace-qualified) top-level `Party` declaration under any
    // standards-compliant XSD validator — this reader's own default-
    // namespace resolution path is lenient and tolerates it, but the
    // document is not valid XSD without this binding. Binding xmlns= to the
    // SAME URI as targetNamespace makes the default namespace equal the
    // target namespace, so bare type="Party" now correctly resolves.
    const content =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<xs:schema xmlns:xs="${XSD_NS}" xmlns="urn:rune:${this.model.namespace}" targetNamespace="urn:rune:${this.model.namespace}" elementFormDefault="qualified">\n\n` +
      (body.length > 0 ? `${body}\n\n` : '') +
      `</xs:schema>\n`;

    return {
      relativePath: this.relativePath,
      content,
      sourceMap: [],
      diagnostics: this.diagnostics,
      funcs: []
    };
  }

  // ---------------------------------------------------------------------------
  // Private instance methods
  // ---------------------------------------------------------------------------

  /**
   * Shared body behind `resolveAttributeType` (a Data attribute's `typeCall`)
   * and `renderChoiceComplexType`'s per-option type resolution (a Choice
   * option's `typeCall` — same `TypeCall` shape, but `ChoiceOption` has no
   * `name` field of its own to report in a diagnostic, hence the separate
   * `diagnosticLabel` parameter rather than reading `attr.name` directly).
   * Resolves to the XSD type name (builtin, enum, Data, or Choice reference —
   * transparently chasing any `RosettaTypeAlias` chain in between).
   */
  private resolveTypeCallToXsdType(typeCall: TypeCall | undefined, diagnosticLabel: string): string {
    return resolveTypeCallTarget(
      typeCall,
      this.typeIndex,
      {
        onPrimitive: (basicTypeName) => {
          const mapped = XSD_BUILTIN_TYPE_MAP[basicTypeName];
          if (mapped) return `xs:${mapped}`;
          this.diagnostics.push({
            severity: 'warning',
            code: 'unmapped-builtin',
            message: `Builtin type '${basicTypeName}' has no XSD mapping; emitting xs:string`
          });
          return 'xs:string';
        },
        onEnum: (node) => node.name,
        onData: (node) => node.name,
        onChoice: (node) => node.name,
        onUnresolved: (refText) => {
          if (refText) {
            this.reportUnresolvedReference(diagnosticLabel, refText, 'xs:string');
          } else {
            // No `refText` at all — preserve the original wording exactly
            // (no "; emitting xs:string" suffix); `reportUnresolvedReference`'s
            // no-refText branch WOULD add that suffix, silently changing this
            // case's message, so it is not used here.
            this.diagnostics.push({
              severity: 'warning',
              code: 'unresolved-ref',
              message: `Attribute '${diagnosticLabel}' has an unresolved type reference`
            });
          }
          return 'xs:string';
        }
      },
      this.fallbackSourceUri
    );
  }

  /** Resolves an attribute's XSD type name (builtin, enum, Data, or Choice reference — transparently chasing any `RosettaTypeAlias` chain in between) and any recognized scalar facets attached to it via its owning Data's conditions. */
  private resolveAttributeType(attr: Attribute): string {
    return this.resolveTypeCallToXsdType(attr.typeCall, attr.name);
  }

  /**
   * Recognizes every condition on `data` via `constraint-recognizer.ts`,
   * splitting into per-attribute facet maps (`range`/`length`) and the set
   * of attribute names participating in an `xs:choice` group, if any
   * (spec.md Phase 3: at most a SINGLE `xs:choice` group per complexType is
   * representable — the reader itself only ever produces one `oneOf`/
   * `choice` constraint per type, from one `xs:choice`). Recognizes BOTH a
   * `required choice` (`{kind: 'oneOf', paths}` — a MANDATORY group, the
   * wrapping `xs:choice` gets no `minOccurs` of its own, defaulting to
   * exactly-one-occurrence) and an `optional choice`/`choice`
   * (`{kind: 'choice', paths}` — an OPTIONAL group, `xs:choice
   * minOccurs="0"`) — the inverse of `xsd-reader.ts`'s own reading of the
   * `xs:choice` element's `@_minOccurs` attribute (Finding 5's coupled
   * reader-side fix: `minOccurs="0"` → `choice`, absent/`"1"` → `oneOf`).
   */
  private recognizeAttributeFacets(conditions: readonly Condition[]): {
    facetsByPath: Map<string, Record<string, number>>;
    choicePaths?: string[];
    choiceRequired: boolean;
  } {
    const facetsByPath = new Map<string, Record<string, number>>();
    let choicePaths: string[] | undefined;
    let choiceRequired = true;

    for (const condition of conditions) {
      if (condition.expression == null) continue;
      const ir = recognizeCondition(condition.expression);
      if (!ir) continue;

      if (ir.kind === 'oneOf' || ir.kind === 'choice') {
        // Only the FIRST recognized choice-shaped condition becomes an
        // xs:choice group — a second one has no representable second
        // choice-group slot in this MVP mapping (documented limitation,
        // mirrors the reader's own single-choice-per-xs:choice production).
        if (!choicePaths) {
          choicePaths = ir.paths;
          choiceRequired = ir.kind === 'oneOf';
        }
        continue;
      }

      if (!('path' in ir)) continue; // conditional/etc — not a per-attribute facet shape
      const facets = constraintIRToXsdFacets(ir);
      if (!facets) continue;
      const existing = facetsByPath.get(ir.path);
      facetsByPath.set(ir.path, existing ? { ...existing, ...facets } : facets);
    }

    return { facetsByPath, choicePaths, choiceRequired };
  }

  /**
   * Resolves every one of `data`'s OWN attributes (not inherited ones —
   * `extends` puts only the child's new attributes in its own
   * `xs:extension`/`xs:sequence`, matching the reader's `buildType` which
   * never re-attaches a base type's attributes to the extending type) into
   * `ResolvedElement`s, honoring a recognized `oneOf`/`choice` group by
   * splitting them into (plain sequence members, choice members). A
   * facet-bearing attribute's `type="..."` is redirected to a freshly
   * synthesized named restricted-simpleType (pushed onto
   * `this.simpleTypeBlocks` as a top-level sibling) rather than an inline
   * nested restriction — see this module's doc comment for why.
   *
   * Choice members deliberately carry NO `minOccurs`/`maxOccurs` of their
   * own (Finding 4: carrying over the Rune attribute's own `(0..1)`
   * cardinality onto each `<xs:element>` inside `<xs:choice>` would let XSD
   * accept the group with ZERO members present, contradicting `required
   * choice` semantics) — XSD's own defaults (`minOccurs="1"
   * maxOccurs="1"`) combined with the wrapping `<xs:choice>`'s own
   * (possibly `minOccurs="0"`, for an optional choice) occurrence marker
   * correctly express "exactly one of these, if the group is present at
   * all" / "at most one, and possibly none".
   */
  private resolveElements(data: Data): {
    plain: ResolvedElement[];
    choiceMembers: ResolvedElement[];
    choiceRequired: boolean;
  } {
    const { facetsByPath, choicePaths, choiceRequired } = this.recognizeAttributeFacets(data.conditions ?? []);
    const choiceNameSet = new Set(choicePaths ?? []);

    const plain: ResolvedElement[] = [];
    const choiceMembers: ResolvedElement[] = [];

    for (const attr of data.attributes) {
      const baseTypeName = this.resolveAttributeType(attr);
      const facets = facetsByPath.get(attr.name);
      const typeName = facets ? this.synthesizeRestrictedSimpleType(attr.name, baseTypeName, facets) : baseTypeName;
      const isChoiceMember = choiceNameSet.has(attr.name);
      const element: ResolvedElement = {
        name: attr.name,
        typeName,
        // Choice members omit cardinalityAttrs entirely (Finding 4, see
        // this method's own doc comment); plain sequence members keep
        // their real cardinality.
        ...(isChoiceMember ? {} : cardinalityAttrs(attr.card))
      };
      if (isChoiceMember) {
        choiceMembers.push(element);
      } else {
        plain.push(element);
      }
    }

    return { plain, choiceMembers, choiceRequired };
  }

  /** Synthesizes a uniquely-named top-level restricted `xs:simpleType` (`<AttributeName>Type`, de-duplicated against every prior simpleType name in this namespace — enum names included, since both share the same top-level simpleType name space) for a facet-bearing attribute, pushes its rendering onto `this.simpleTypeBlocks`, and returns the synthesized name for the owning element's `type="..."` attribute. */
  private synthesizeRestrictedSimpleType(attrName: string, base: string, facets: Record<string, number>): string {
    const capitalized = attrName.charAt(0).toUpperCase() + attrName.slice(1);
    let candidate = `${capitalized}Type`;
    let suffix = 2;
    while (this.usedSimpleTypeNames.has(candidate)) {
      candidate = `${capitalized}Type${suffix}`;
      suffix += 1;
    }
    this.usedSimpleTypeNames.add(candidate);
    this.simpleTypeBlocks.push(renderRestrictedSimpleType({ name: candidate, base, facets }));
    return candidate;
  }

  /** Renders one `Data` node as a top-level named `xs:complexType`. */
  private renderDataComplexType(data: Data): string {
    const { plain, choiceMembers, choiceRequired } = this.resolveElements(data);
    const bodyLines: string[] = [];
    for (const el of plain) bodyLines.push(...renderElement(el, 0));
    if (choiceMembers.length > 0) {
      // A required choice (oneOf) -> a bare <xs:choice> (no minOccurs of its
      // own, defaulting to exactly-one-occurrence-of-the-group); an optional
      // choice -> <xs:choice minOccurs="0"> marking the WHOLE group
      // optional (Finding 5, emitter side) — the members themselves never
      // carry their own minOccurs/maxOccurs either way (Finding 4).
      bodyLines.push(choiceRequired ? '<xs:choice>' : '<xs:choice minOccurs="0">');
      for (const el of choiceMembers) bodyLines.push(...renderElement(el, 1));
      bodyLines.push('</xs:choice>');
    }

    const superTypeRef = data.superType?.ref;
    const parentName = superTypeRef && (isData(superTypeRef) || isChoice(superTypeRef)) ? superTypeRef.name : undefined;

    if (parentName) {
      const inner = indentLines(['<xs:sequence>', ...indentLines(bodyLines, 1), '</xs:sequence>'], 3);
      const lines = [
        `<xs:complexType name="${escapeXml(data.name)}">`,
        `  <xs:complexContent>`,
        `    <xs:extension base="${escapeXml(parentName)}">`,
        ...inner,
        `    </xs:extension>`,
        `  </xs:complexContent>`,
        `</xs:complexType>`
      ];
      return lines.join('\n');
    }

    if (bodyLines.length === 0) {
      return `<xs:complexType name="${escapeXml(data.name)}"/>`;
    }

    const lines = [
      `<xs:complexType name="${escapeXml(data.name)}">`,
      `  <xs:sequence>`,
      ...indentLines(bodyLines, 2),
      `  </xs:sequence>`,
      `</xs:complexType>`
    ];
    return lines.join('\n');
  }

  /**
   * Renders a genuine Rune `Choice` DECLARATION as a top-level named
   * `xs:complexType` wrapping a plain `xs:choice` of its options — a
   * best-effort structural emission with NO reader-side inverse (see this
   * file's module doc: `xsd-reader.ts` never produces a Rune `Choice`
   * declaration from any XSD construct), so this path is not exercised by
   * the round-trip oracle.
   */
  private renderChoiceComplexType(choice: Choice): string {
    const elements = choice.attributes.map((option): ResolvedElement => {
      // A Choice option has no `name` of its own, so ELEMENT NAME and TYPE
      // are two distinct values, per the FIELD-KEY-vs-RESOLVED-VALUE split
      // convention ts-emitter's emitChoiceTypeDeclaration and zod-emitter's
      // emitChoiceSchema already establish: the name is derived from the
      // DIRECT/immediate reference (never the alias-chased terminal target,
      // via the shared `choiceOptionFieldName` convention), while the type
      // chases through any RosettaTypeAlias chain to the terminal resolved
      // XSD type. Using the resolved TYPE for both — as this line used to —
      // breaks for a primitive option (`choice Asset: string` resolves to
      // `xs:string`, and `xs:` is not a valid NCName prefix for an element
      // `name` attribute).
      const optionTypeRef = option.typeCall?.type;
      const directName = optionTypeRef?.ref?.name ?? optionTypeRef?.$refText ?? '?';
      const elementName = choiceOptionFieldName(directName);
      const typeName = this.resolveTypeCallToXsdType(option.typeCall, `${choice.name} option`);
      return { name: elementName, typeName, minOccurs: '0', maxOccurs: '1' };
    });

    const bodyLines: string[] = ['<xs:choice>'];
    for (const el of elements) bodyLines.push(...indentLines(renderElement(el, 0), 1));
    bodyLines.push('</xs:choice>');

    const lines = [
      `<xs:complexType name="${escapeXml(choice.name)}">`,
      ...indentLines(bodyLines, 1),
      `</xs:complexType>`
    ];
    return lines.join('\n');
  }

  /**
   * Renders a `RosettaEnumeration` as a top-level named `xs:simpleType` +
   * `xs:restriction base="xs:string"` + one `xs:enumeration` per value.
   *
   * Uses `enumValue.name` (the Rune-safe identifier) as the literal
   * `value="..."` — NOT a synonym-recorded original source literal. This
   * mirrors json-schema-emitter.ts's own `emitEnumDef`, which likewise uses
   * `v.name` (never reads `v.synonyms`/a `[synonym ... value "..."]`
   * annotation back out) — no emitter in this codebase currently reads an
   * enum value's recorded synonym when EMITTING (only the INBOUND readers
   * ever WRITE one, via `synonym-builder.ts`, to preserve a non-ValidID-safe
   * original literal). Consistent with that established convention (DRY);
   * see this module's own top-of-file doc note for the full finding.
   */
  private static renderEnumSimpleType(enumNode: RosettaEnumeration): string {
    const lines = [
      `<xs:simpleType name="${escapeXml(enumNode.name)}">`,
      `  <xs:restriction base="xs:string">`,
      ...enumNode.enumValues.map((v) => `    <xs:enumeration value="${escapeXml(v.name)}"/>`),
      `  </xs:restriction>`,
      `</xs:simpleType>`
    ];
    return lines.join('\n');
  }
}
