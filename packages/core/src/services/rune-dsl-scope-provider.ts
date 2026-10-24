// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { redirectProjectScope } from '../references/project-resolution.js';
import { buildImportAliasMap, buildImportScope, importScopeCandidates } from '../naming/import-aliases.js';
import type { AstNode, AstNodeDescription, ReferenceInfo, Scope, LangiumCoreServices } from 'langium';
import { AstUtils, EMPTY_SCOPE, DefaultScopeProvider, MapScope, stream } from 'langium';
import {
  getFunctionSignature,
  getFunctionInputs,
  getFunctionOutput,
  getOperationArgument,
  resolveOperationType,
  resolveTypeAliases
} from '../utils/expression-utils.js';
import { getEnumValues } from '../utils/enum-utils.js';
import { qualifiedExportPath } from '../naming/qualified-export-path.js';
import { getChoiceOptionPaths, choiceOptionFieldName } from '../utils/choice-utils.js';
import {
  isAsOperation,
  isEqualityOperation,
  isData,
  isRosettaFunction,
  isRosettaRule,
  isRosettaEnumeration,
  isRosettaEnumValue,
  isRosettaBasicType,
  isRosettaTypeAlias,
  isAttribute,
  isOperation,
  isShortcutDeclaration,
  isRosettaFeatureCall,
  isRosettaDeepFeatureCall,
  isSegment,
  isConstructorKeyValuePair,
  isRosettaConstructorExpression,
  isRosettaEnumValueReference,
  isTypeCallArgument,
  isTypeCall,
  isWithMetaEntry,
  isRosettaExternalRegularAttribute,
  isRosettaExternalClass,
  isAnnotationRef,
  isRosettaSymbolReference,
  isRosettaRecordType,
  isRosettaRecordFeature,
  isChoice,
  isChoiceOption,
  isAnnotation,
  isInlineFunction,
  isRosettaExpression,
  isSwitchCaseOrDefault,
  isClosureParameter,
  isRosettaImplicitVariable,
  isRosettaAttributeReference,
  isRosettaDataReference,
  isAnnotationPath,
  isAnnotationDeepPath,
  isAnnotationPathAttributeReference,
  isChoiceOperation,
  isSwitchOperation,
  isRosettaMetaType
} from '../generated/ast.js';
import type {
  Data,
  Attribute,
  ShortcutDeclaration,
  RosettaExpression,
  RosettaModel,
  RosettaFeatureCall,
  RosettaDeepFeatureCall,
  Segment,
  TypeCall,
  TypeCallArgument,
  Operation,
  RosettaRecordType,
  RosettaFunction,
  RosettaRecordFeature,
  Choice,
  ChoiceOption,
  AnnotationPathExpression,
  AnnotationRef,
  RosettaType
} from '../generated/ast.js';

/**
 * A Scope wrapper that expands import aliases when looking up qualified names.
 *
 * If a lookup for `fpml.Leg` fails in the base scope, and the alias map contains
 * `{ fpml: ["fpml.consolidated.shared"] }`, it tries `fpml.consolidated.shared.Leg`
 * in the base scope and returns that result.
 */
class AliasResolvingScope implements Scope {
  constructor(
    private readonly base: Scope,
    private readonly aliasMap: ReadonlyMap<string, readonly string[]>,
    private readonly namespaces: readonly string[] = [],
    private readonly imports: ReadonlyMap<string, string> = new Map()
  ) {}

  getElement(name: string): AstNodeDescription | undefined {
    for (const candidate of this.candidateNames(name)) {
      const result = this.base.getElement(candidate);
      if (result) return result;
    }
    return undefined;
  }

  getElements(name: string): import('langium').Stream<AstNodeDescription> {
    return stream(this.candidateNames(name))
      .flatMap((candidate) => this.base.getElements(candidate))
      .distinct((description) => JSON.stringify([description.documentUri.toString(), description.path]));
  }

  getAllElements(): import('langium').Stream<AstNodeDescription> {
    return this.base.getAllElements();
  }

  private candidateNames(name: string): string[] {
    return importScopeCandidates(name, {
      aliases: this.aliasMap,
      namespaces: this.namespaces,
      explicitImports: this.imports
    });
  }
}

/**
 * Custom scope provider for the Rune DSL.
 *
 * Handles the 21 cross-reference patterns from the original Xtext implementation:
 * - Cases 1-3: Feature calls (-> and ->>)
 * - Cases 4-8: Operation assign root, segments, constructor keys
 * - Case 9-11: Switch case guards, enum values
 * - Case 12: Symbol references (most complex — context-dependent)
 * - Cases 13-21: Annotation paths, external refs, etc.
 */
export class RuneDslScopeProvider extends DefaultScopeProvider {
  private readonly projectServices: LangiumCoreServices;
  private readonly documents: LangiumCoreServices['shared']['workspace']['LangiumDocuments'];
  private readonly locator: LangiumCoreServices['workspace']['AstNodeLocator'];

  constructor(services: LangiumCoreServices) {
    super(services);
    this.projectServices = services;
    this.documents = services.shared.workspace.LangiumDocuments;
    this.locator = services.workspace.AstNodeLocator;
  }

  override getScope(context: ReferenceInfo): Scope {
    return redirectProjectScope(this.projectServices, this.getSourceScope(context));
  }

  private getSourceScope(context: ReferenceInfo): Scope {
    const container = context.container;
    const property = context.property;

    if (isAsOperation(container) && property === 'type') {
      const argument = getOperationArgument(container);
      const input = argument ? this.resolveExpressionType(argument) : undefined;
      if (isChoice(input)) {
        return this.getChoiceTypeScope(input, context);
      }
    }

    // Case 1: RosettaFeatureCall.feature — resolve to attributes of receiver type
    if (isRosettaFeatureCall(container) && property === 'feature') {
      return this.getFeatureCallScope(container);
    }

    // Case 2: RosettaDeepFeatureCall.feature — resolve to all transitive attributes
    if (isRosettaDeepFeatureCall(container) && property === 'feature') {
      return this.getDeepFeatureCallScope(container);
    }

    // Case 3: Segment.feature — resolve to features of the segment's context type
    if (isSegment(container) && property === 'feature') {
      return this.getSegmentScope(container);
    }

    // Case 4: Operation.assignRoot — resolve to function inputs/output/shortcuts
    if (isOperation(container) && property === 'assignRoot') {
      return this.getOperationAssignScope(container);
    }

    // Case 4b: RosettaFunction.dispatchAttribute — resolve to inputs of the base function
    // (dispatch overloads reference an input from the base function with the same name)
    if (isRosettaFunction(container) && property === 'dispatchAttribute') {
      return this.getDispatchAttributeScope(container);
    }

    // Case 5: ConstructorKeyValuePair.key — resolve to features of the constructed type
    if (isConstructorKeyValuePair(container) && property === 'key') {
      return this.getConstructorKeyScope(container);
    }

    // Case 6: WithMetaEntry.key — resolve to meta features
    if (isWithMetaEntry(container) && property === 'key') {
      return this.getWithMetaKeyScope(container);
    }

    // Basic, record, enum and alias types are switch targets only through declared Choice options.
    if (container.$type === 'SwitchCaseGuard' && property === 'referenceGuard') {
      const operation = AstUtils.getContainerOfType(container, isSwitchOperation);
      const argument = operation ? getOperationArgument(operation) : undefined;
      const inputType = argument ? this.resolveExpressionType(argument) : undefined;
      if (isData(inputType) || isChoice(inputType)) {
        const globalScope = this.getGlobalScope('DataOrChoice', context);
        if (!isChoice(inputType)) return globalScope;
        return this.getChoiceTypeScope(inputType, context, globalScope);
      }
      return this.getGlobalScope('RosettaEnumValue', context);
    }

    // Case 8: EnumValueReference.value — resolve to enum values of the specified enum
    if (isRosettaEnumValueReference(container) && property === 'value') {
      return this.getEnumValueScope(container);
    }

    // RosettaAttributeReference.attribute — scope is attributes of the receiver Data type
    // Used in: [metadata address "pointsTo"=PriceQuantity->price]
    if (isRosettaAttributeReference(container) && !isRosettaDataReference(container) && property === 'attribute') {
      return this.getRosettaAttributeRefScope(container);
    }

    // AnnotationPath.attribute — scope is attributes of the receiver's resolved type
    if (isAnnotationPath(container) && property === 'attribute') {
      return this.getAnnotationPathScope(container.receiver);
    }

    // AnnotationDeepPath.attribute — deep features of the receiver's resolved type
    if (isAnnotationDeepPath(container) && property === 'attribute') {
      return this.getAnnotationDeepPathScope(container.receiver);
    }

    // AnnotationPathAttributeReference.attribute — attributes of enclosing Data type
    if (isAnnotationPathAttributeReference(container) && property === 'attribute') {
      return this.getAnnotationPathAttributeRefScope(container);
    }

    // ChoiceOperation.attributes — attributes of the argument type or enclosing Data type
    // Used in: `optional choice field1, field2` conditions
    if (isChoiceOperation(container) && property === 'attributes') {
      return this.getChoiceOperationAttributeScope(container);
    }

    // Case 9a: AnnotationRef.annotation — resolved via global scope
    if (isAnnotationRef(container) && property === 'annotation') {
      return super.getScope(context);
    }

    // Case 9b: AnnotationRef.attribute — resolved to attributes of the specified annotation
    if (isAnnotationRef(container) && property === 'attribute') {
      return this.getAnnotationAttributeScope(container);
    }

    // Case 10: ExternalRegularAttribute.attributeRef — resolve to features of the external class's data type
    if (isRosettaExternalRegularAttribute(container) && property === 'attributeRef') {
      return this.getExternalAttributeScope(container);
    }

    // Case 11: TypeCallArgument.parameter — resolve to TypeParameters of the referenced type
    if (isTypeCallArgument(container) && property === 'parameter') {
      return this.getTypeCallArgumentScope(container);
    }

    // Case 12: RosettaSymbolReference.symbol — add inherited attributes from supertype chain
    if (isRosettaSymbolReference(container) && property === 'symbol') {
      return this.getSymbolReferenceScope(container, context);
    }

    // Cases 13+: Default to standard scope resolution
    return super.getScope(context);
  }

  // ── Type-aware scoping ──────────────────────────────────────────────

  private getChoiceTypeScope(input: Choice, context: ReferenceInfo, base: Scope = EMPTY_SCOPE): Scope {
    const options = getChoiceOptionPaths(input).flatMap((path) => {
      const type = path[path.length - 1]!.typeCall.type.ref;
      if (!type) return [];
      const model = AstUtils.getContainerOfType(type, (node): node is RosettaModel => node.$type === 'RosettaModel');
      return [
        this.createDescription(type, type.name),
        this.createDescription(type, qualifiedExportPath(model?.name ?? '', type.name))
      ];
    });
    const model = AstUtils.getContainerOfType(
      context.container,
      (node): node is RosettaModel => node.$type === 'RosettaModel'
    );
    return new AliasResolvingScope(new MapScope(options, base), buildImportAliasMap(model?.imports ?? []));
  }

  /**
   * Resolve the type produced by an expression.
   * Returns a Data, RosettaRecordType, or Choice node if the expression's type can be determined.
   */
  private readonly resolvingExpressionTypes = new Set<RosettaExpression>();

  private resolveExpressionType(expr: RosettaExpression): Data | RosettaRecordType | Choice | undefined {
    if (this.resolvingExpressionTypes.has(expr)) return undefined;
    this.resolvingExpressionTypes.add(expr);
    try {
      return this.inferExpressionType(expr);
    } finally {
      this.resolvingExpressionTypes.delete(expr);
    }
  }

  private inferExpressionType(expr: RosettaExpression): Data | RosettaRecordType | Choice | undefined {
    // Symbol reference → look up the symbol to determine its type
    if (isRosettaSymbolReference(expr)) {
      const sym = expr.symbol?.ref;
      if (!sym) {
        // Fallback: look up by $refText in global index (e.g. when .ref is not yet linked)
        // Prefer Choice over Data when both exist (e.g. CDM `choice Index` vs FpML `type Index`)
        const refText = expr.symbol?.$refText;
        if (refText) {
          const choiceType = this.resolveChoiceByName(refText);
          if (choiceType) return choiceType;
          return this.resolveDataByName(refText);
        }
        return undefined;
      }

      // Attribute → its typeCall determines the type
      if (isAttribute(sym) || isChoiceOption(sym) || isRosettaRecordFeature(sym)) {
        return this.resolveTypeCallToData(sym.typeCall);
      }

      // Aliases and rules infer their result type through the same cycle guard.
      if (isShortcutDeclaration(sym) || isRosettaRule(sym)) {
        return sym.expression ? this.resolveExpressionType(sym.expression) : undefined;
      }

      // Function → type comes from output attribute's typeCall
      if (isRosettaFunction(sym)) {
        return sym.output ? this.resolveTypeCallToData(sym.output.typeCall) : undefined;
      }

      // Data or Choice type referenced directly.
      // When a Data is resolved but a same-named Choice exists, prefer the Choice
      // (e.g. CDM `choice Index` vs FpML `type Index`).
      if (isData(sym)) {
        const refText = expr.symbol?.$refText;
        if (refText) {
          const choiceType = this.resolveChoiceByName(refText);
          if (choiceType) return choiceType;
        }
        return sym;
      }
      if (isChoice(sym) || isRosettaRecordType(sym)) {
        return sym;
      }

      // ClosureParameter: its type is the element type of the collection it iterates over.
      // e.g. `list extract q1 [q1 -> value]` — q1's type = element type of `list`.
      if (isClosureParameter(sym)) {
        const inlineFunc = sym.$container;
        if (isInlineFunction(inlineFunc)) {
          const op = inlineFunc.$container;
          const argument = isRosettaExpression(op) ? getOperationArgument(op) : undefined;
          if (argument) {
            return this.resolveCollectionElementType(argument);
          }
        }
        return undefined;
      }

      return undefined;
    }

    // Feature call → resolve the feature to get its type
    if (isRosettaFeatureCall(expr)) {
      const feature = expr.feature?.ref;
      if (feature && (isAttribute(feature) || isRosettaRecordFeature(feature) || isChoiceOption(feature))) {
        return this.resolveTypeCallToData(feature.typeCall);
      }
      return undefined;
    }

    // Deep feature call → same logic
    if (isRosettaDeepFeatureCall(expr)) {
      const feature = expr.feature?.ref;
      if (feature && (isAttribute(feature) || isRosettaRecordFeature(feature) || isChoiceOption(feature))) {
        return this.resolveTypeCallToData(feature.typeCall);
      }
      return undefined;
    }

    // Constructor expression → resolve the typeRef
    if (isRosettaConstructorExpression(expr)) {
      return this.resolveExpressionType(expr.typeRef);
    }

    // RosettaImplicitVariable (`item`) → element type of the enclosing collection operation.
    // e.g. `after extract [item -> trade]` — `item` has the element type of `after` (TradeState).
    if (isRosettaImplicitVariable(expr)) {
      let searchFrom: AstNode = expr;
      while (true) {
        const inlineFunc = AstUtils.getContainerOfType(searchFrom, isInlineFunction);
        if (!inlineFunc) break;
        const op = inlineFunc.$container;
        if (!op) break;
        const argument = isRosettaExpression(op) ? getOperationArgument(op) : undefined;
        if (argument) {
          return this.resolveCollectionElementType(argument);
        }
        searchFrom = op;
      }

      // Switch case type narrowing: inside `expr switch SomeType then <body>`,
      // `item` should resolve to the narrowed type of the switch case guard.
      // e.g. `inputCriteria switch IssuerAgencyRating then CheckAgencyRating(item -> issuerAgencyRating, query)`
      const switchCase = AstUtils.getContainerOfType(expr, isSwitchCaseOrDefault);
      if (switchCase?.guard?.referenceGuard) {
        const guardType = switchCase.guard.referenceGuard.ref;
        if (guardType && isData(guardType)) {
          return guardType;
        }
        if (guardType && isChoice(guardType)) {
          return guardType;
        }
        // Guard resolved to an enum value that shadows a Data/Choice type name
        // (e.g. enum value `Index` shadows `choice Index`). Look up by name.
        if (guardType && isRosettaEnumValue(guardType)) {
          return this.resolveDataOrChoiceByName(guardType.name);
        }
        // Guard not linked yet — try by $refText
        if (!guardType) {
          const refText = switchCase.guard.referenceGuard.$refText;
          if (refText) return this.resolveDataOrChoiceByName(refText);
        }
      }
      if (switchCase) {
        const operation = switchCase.$container;
        const argument = isSwitchOperation(operation) ? getOperationArgument(operation) : undefined;
        return argument ? this.resolveExpressionType(argument) : undefined;
      }
      const rule = AstUtils.getContainerOfType(expr, isRosettaRule);
      return rule ? this.resolveTypeCallToData(rule.input) : undefined;
    }

    return resolveOperationType(
      expr,
      (expression) => this.resolveExpressionType(expression),
      (type) => (isData(type) || isChoice(type) || isRosettaRecordType(type) ? type : undefined),
      (name) => {
        const description = this.getGlobalScope('RosettaRecordType', {
          container: expr,
          property: 'type',
          reference: { $refText: name, ref: undefined }
        }).getElement(name);
        if (!description) return undefined;
        const root = this.documents.getDocument(description.documentUri)?.parseResult.value;
        const node = description.node ?? (root ? this.locator.getAstNode(root, description.path) : undefined);
        return isRosettaRecordType(node) ? node : undefined;
      }
    );
  }

  /**
   * Resolve a TypeCall to a structured type node (Data, RosettaRecordType, or Choice).
   * Returns undefined if the type reference does not point to a navigable structured type.
   *
   * Falls back to a global-index lookup when `.ref` is not yet linked (e.g. when the
   * containing document is processed before the file that defines the referenced type).
   */
  private resolveTypeCallToData(typeCall: TypeCall | undefined): Data | RosettaRecordType | Choice | undefined {
    if (!typeCall) return undefined;
    const ref = typeCall.type?.ref;
    if (ref) {
      const resolved = resolveTypeAliases(ref);
      if (isData(resolved) || isRosettaRecordType(resolved) || isChoice(resolved)) return resolved;
      return undefined;
    }
    // Fallback: .ref not linked yet — look up by $refText in the global index
    // Must search both Data AND Choice types since attributes can be typed as either.
    const refText = typeCall.type?.$refText;
    if (!refText) return undefined;
    return this.resolveDataOrChoiceByName(refText);
  }

  /**
   * Look up a Data type by (possibly qualified) name in the global index.
   * Used as a fallback when cross-references are not yet linked.
   */
  private resolveDataByName(name: string): Data | undefined {
    for (const desc of this.indexManager.allElements('Data')) {
      if (desc.name === name || desc.name.endsWith('.' + name)) {
        const node = desc.node;
        if (node && isData(node)) return node;
      }
    }
    return undefined;
  }

  /**
   * Look up a Data or Choice type by name in the global index.
   * Prefers Choice over Data when both exist with the same simple name,
   * because CDM defines authoritative choice types that may be shadowed
   * by same-named FpML data types or enum values.
   */
  private resolveDataOrChoiceByName(name: string): Data | Choice | undefined {
    const choice = this.resolveChoiceByName(name);
    if (choice) return choice;
    return this.resolveDataByName(name);
  }

  /**
   * Resolve scope for TypeCallArgument.parameter — returns TypeParameters of the referenced type.
   *
   * In `number(digits: digits, fractionalDigits: 0, ...)`, `fractionalDigits` is a
   * TypeParameter of `basicType number(...)`. The container is a TypeCall whose `type`
   * reference resolves to the basicType/typeAlias that owns the parameters.
   */
  private getTypeCallArgumentScope(node: TypeCallArgument): Scope {
    const container = node.$container;

    // TypeCallArgument inside a TypeCall (e.g., typeAlias body or constructor)
    if (isTypeCall(container)) {
      return this.getTypeParametersFromRef(container.type?.ref);
    }

    // TypeCallArgument inside an Attribute (inlined type args, e.g., `int(min: 0)`)
    if (isAttribute(container)) {
      return this.getTypeParametersFromRef(container.typeCall?.type?.ref);
    }

    return EMPTY_SCOPE;
  }

  private getTypeParametersFromRef(ref: RosettaType | undefined): Scope {
    if (ref && isRosettaBasicType(ref)) {
      const descriptions = ref.parameters.map((p) => this.createDescription(p, p.name));
      return new MapScope(descriptions);
    }
    if (ref && isRosettaTypeAlias(ref)) {
      const descriptions = ref.parameters.map((p) => this.createDescription(p, p.name));
      return new MapScope(descriptions);
    }
    return EMPTY_SCOPE;
  }

  /**
   * Collect all attributes from a Data type including inherited attributes.
   * Falls back to the global index when `superType.ref` is not yet linked.
   */
  private collectDataAttributes(data: Data, visited?: Set<Data>): Attribute[] {
    if (!visited) visited = new Set();
    if (visited.has(data)) return []; // cycle guard
    visited.add(data);

    const superRef = data.superType?.ref ?? this.resolveDataByName(data.superType?.$refText ?? '');
    const inherited = isData(superRef) ? this.collectDataAttributes(superRef, visited) : [];
    return [...new Map([...inherited, ...data.attributes].map((attribute) => [attribute.name, attribute])).values()];
  }

  /**
   * Collect inherited ChoiceOption nodes from a parent Choice type.
   * CDM uses `type Foo extends SomeChoice:` where SomeChoice is a `choice` type.
   * The grammar only declares superType=[Data], so the linker may fail to link to
   * the choice type (or accidentally link to a same-named Data in another namespace).
   * We always search for a Choice matching the superType's name and include its options.
   */
  private collectInheritedChoiceOptions(data: Data): ChoiceOption[] {
    if (!data.superType?.$refText) return [];
    const choiceSuper = this.resolveChoiceByName(data.superType.$refText);
    return choiceSuper ? [...choiceSuper.attributes] : [];
  }

  /**
   * Look up a Choice type by (possibly qualified) name in the global index.
   */
  private resolveChoiceByName(name: string): Choice | undefined {
    for (const desc of this.indexManager.allElements('Choice')) {
      if (desc.name === name || desc.name.endsWith('.' + name)) {
        const node = desc.node;
        if (node && isChoice(node)) return node;
      }
    }
    return undefined;
  }

  /**
   * Return the Attribute nodes from `annotation metadata` that correspond to
   * `[metadata X]` annotations on the given attribute OR its resolved type.
   *
   * The Rune DSL puts metadata annotations in two places:
   *  - On the ATTRIBUTE: `foo Party (0..1) [metadata reference]` → `reference` in scope
   *  - On the TYPE: `type Foo: [metadata key]` → `key` in scope when navigating through `foo Foo (0..1)`
   */
  private getMetaAttributeRefs(attr: Attribute): Attribute[] {
    const result: Attribute[] = [];
    const seen = new Set<string>();

    const collect = (annotations: ReadonlyArray<AnnotationRef>) => {
      for (const annRef of annotations) {
        const annName = annRef.annotation?.ref?.name ?? annRef.annotation?.$refText;
        if (annName !== 'metadata') continue;
        // The attribute ref may or may not be linked yet; use both paths
        const metaAttr = annRef.attribute?.ref;
        if (metaAttr && isAttribute(metaAttr) && !seen.has(metaAttr.name)) {
          seen.add(metaAttr.name);
          result.push(metaAttr);
        } else if (!metaAttr) {
          // Fallback: look up by $refText in the metadata annotation
          const refText = annRef.attribute?.$refText;
          if (refText && !seen.has(refText)) {
            const found = this.findMetadataAnnotationAttribute(refText);
            if (found) {
              seen.add(refText);
              result.push(found);
            }
          }
        }
      }
    };

    // 1) Annotations on the attribute itself (e.g. `[metadata reference]`)
    collect(attr.annotations);

    // 2) Annotations on the type that the attribute is typed as
    //    (e.g. `type AdjustableOrRelativeDate: [metadata key]`)
    const typeRef = attr.typeCall?.type?.ref;
    if (typeRef && isData(typeRef)) {
      collect(typeRef.annotations);
    } else if (!typeRef && attr.typeCall?.type?.$refText) {
      // Type not linked yet — resolve by name
      const resolved = this.resolveDataByName(attr.typeCall.type.$refText);
      if (resolved) collect(resolved.annotations);
    }

    return result;
  }

  /** Cache of metadata annotation attributes, keyed by attribute name. */
  private _metadataAnnotationAttrs: Map<string, Attribute> | undefined;

  /**
   * Look up an Attribute by name in the `annotation metadata` declaration.
   * Searches the global index for an Annotation named 'metadata' and finds
   * its child Attribute with the given name.
   */
  private findMetadataAnnotationAttribute(name: string): Attribute | undefined {
    if (!this._metadataAnnotationAttrs) {
      this._metadataAnnotationAttrs = new Map();
      for (const desc of this.indexManager.allElements('Annotation')) {
        if (desc.name === 'metadata' || desc.name === 'com.rosetta.model.metadata') {
          const node = desc.node;
          if (node && isAnnotation(node)) {
            for (const a of node.attributes) {
              this._metadataAnnotationAttrs.set(a.name, a);
            }
          }
          break;
        }
      }
    }
    return this._metadataAnnotationAttrs.get(name);
  }

  private _metaTypeDescs: AstNodeDescription[] | undefined;
  private getMetaTypeDescriptions(): AstNodeDescription[] {
    if (!this._metaTypeDescs) {
      this._metaTypeDescs = [];
      for (const desc of this.indexManager.allElements('RosettaMetaType')) {
        const node = desc.node;
        if (node && isRosettaMetaType(node)) {
          this._metaTypeDescs.push(this.createDescription(node, node.name));
        }
      }
    }
    return this._metaTypeDescs;
  }

  /**
   * Extract the last Attribute that was directly navigated via an expression.
   * Used to determine if meta-attributes (reference, key, scheme) are in scope.
   */
  private getLastAttributeOfExpression(expr: RosettaExpression): Attribute | undefined {
    if (isRosettaSymbolReference(expr)) {
      const sym = expr.symbol?.ref;
      return isAttribute(sym) ? sym : undefined;
    }
    if (isRosettaFeatureCall(expr)) {
      const feature = expr.feature?.ref;
      return isAttribute(feature) ? feature : undefined;
    }
    return undefined;
  }

  /**
   * Build a scope from a Data, RosettaRecordType, or Choice's features.
   * Falls back to the global attribute scope if the type cannot be resolved.
   */
  private buildTypedScope(data: Data | RosettaRecordType | Choice | undefined, fallbackNode: AstNode): Scope {
    if (!data) {
      return this.getAllAttributesScope(fallbackNode);
    }
    if (isRosettaRecordType(data)) {
      const features = data.features;
      if (features.length === 0) {
        return this.getAllAttributesScope(fallbackNode);
      }
      const descriptions = features.map((f) => this.createDescription(f, f.name));
      return new MapScope(descriptions);
    }
    if (isChoice(data)) {
      return this.getChoiceOptionScope(data);
    }
    const attrs = this.collectDataAttributes(data);
    const inheritedOptions = this.collectInheritedChoiceOptions(data);
    if (attrs.length === 0 && inheritedOptions.length === 0) {
      return this.getAllAttributesScope(fallbackNode);
    }
    const descriptions: AstNodeDescription[] = [
      ...attrs.map((a) => this.createDescription(a, a.name)),
      ...inheritedOptions.flatMap((option) => this.choiceOptionDescriptions(option))
    ];
    return new MapScope(descriptions);
  }

  /**
   * Build a scope of choice options, keyed by the simple name of the referenced type.
   * e.g. `choice Payout: InterestRatePayout` → exposes "InterestRatePayout" → ChoiceOption node.
   */
  private getChoiceOptionScope(choice: Choice): Scope {
    return new MapScope(choice.attributes.flatMap((option) => this.choiceOptionDescriptions(option)));
  }

  private choiceOptionDescriptions(option: ChoiceOption): AstNodeDescription[] {
    const name = option.typeCall.type.$refText.split('.').pop();
    if (!name) return [];
    return [...new Set([name, choiceOptionFieldName(name)])].map((key) => this.createDescription(option, key));
  }

  // ── Case implementations ────────────────────────────────────────────

  /**
   * Case 1: Feature call scope — attributes of the receiver's resolved type,
   * enum values when the receiver is an enumeration, or choice options when
   * the receiver is a choice type.
   */
  private getFeatureCallScope(node: RosettaFeatureCall): Scope {
    // When the receiver is a direct symbol reference, handle enum and choice
    // types explicitly before falling through to resolveExpressionType.
    if (isRosettaSymbolReference(node.receiver)) {
      const sym = node.receiver.symbol?.ref;
      if (sym && isRosettaEnumeration(sym)) {
        const allValues = getEnumValues(sym);
        const descriptions = allValues.map((v) => this.createDescription(v, v.name));
        return new MapScope(descriptions);
      }
      if (sym && isChoice(sym)) {
        return this.getChoiceOptionScope(sym);
      }
      // When a non-Choice/non-Enum type is resolved (Data or RosettaEnumValue)
      // but a Choice type with the same name exists, prefer the Choice.
      // e.g. `Index` may resolve to enum value `Index` but CDM `choice Index` is intended.
      if (sym && !isChoice(sym) && !isRosettaEnumeration(sym)) {
        const refText = node.receiver.symbol?.$refText;
        if (refText) {
          const choiceType = this.resolveChoiceByName(refText);
          if (choiceType) {
            return this.getChoiceOptionScope(choiceType);
          }
        }
      }
    }

    const receiverType = this.resolveExpressionType(node.receiver);
    const baseScope = this.buildTypedScope(receiverType, node);

    // Include meta-attributes (reference, key, scheme…) if the receiver's last
    // navigated attribute has [metadata X] annotations.
    // e.g. `partyReference -> reference` where partyReference has [metadata reference]
    const receiverAttr = this.getLastAttributeOfExpression(node.receiver);
    if (receiverAttr) {
      const metaAttrs = this.getMetaAttributeRefs(receiverAttr);
      if (metaAttrs.length > 0) {
        const metaDescs = metaAttrs.map((a) => this.createDescription(a, a.name));
        return new MapScope(metaDescs, baseScope);
      }
    }

    return baseScope;
  }

  /**
   * Case 2: Deep feature call scope — all attributes (own + transitive) of receiver type.
   */
  private getDeepFeatureCallScope(node: RosettaDeepFeatureCall): Scope {
    const receiverType = this.resolveExpressionType(node.receiver);
    if (!receiverType) {
      return this.getAllAttributesScope(node);
    }
    // For deep feature calls, collect attributes transitively:
    // gather all attributes of the type and all types reachable from those attributes.
    const allFeatures = this.collectTransitiveAttributes(receiverType);
    if (allFeatures.length === 0) {
      return this.getAllAttributesScope(node);
    }
    const descriptions = allFeatures.flatMap((feature) =>
      isChoiceOption(feature) ? this.choiceOptionDescriptions(feature) : [this.createDescription(feature, feature.name)]
    );
    return new MapScope(descriptions);
  }

  /**
   * Collect features transitively: the type's own features plus features
   * of all types reachable through attribute type references.
   */
  private collectTransitiveAttributes(
    data: Data | RosettaRecordType | Choice,
    visited?: Set<Data | RosettaRecordType | Choice>
  ): (Attribute | RosettaRecordFeature | ChoiceOption)[] {
    if (!visited) visited = new Set();
    if (visited.has(data)) return [];
    visited.add(data);

    if (isRosettaRecordType(data)) {
      return [...data.features];
    }

    if (isChoice(data)) {
      // Include the ChoiceOption nodes themselves AND all attributes of each option's type
      const result: (Attribute | RosettaRecordFeature | ChoiceOption)[] = [...data.attributes];
      for (const option of data.attributes) {
        const optionType = this.resolveTypeCallToData(option.typeCall);
        if (optionType) {
          result.push(...this.collectTransitiveAttributes(optionType, visited));
        }
      }
      return result;
    }

    const attrs: (Attribute | RosettaRecordFeature | ChoiceOption)[] = this.collectDataAttributes(data);
    // eslint-disable-next-line unicorn/no-useless-spread
    for (const attr of [...attrs]) {
      if (isAttribute(attr)) {
        const attrType = this.resolveTypeCallToData(attr.typeCall);
        if (attrType) {
          attrs.push(...this.collectTransitiveAttributes(attrType, visited));
        }
      }
    }
    return attrs;
  }

  /**
   * Case 3: Segment scope — features of the segment's context type.
   * A segment chain `-> a -> b` resolves each step relative to the previous type.
   */
  private getSegmentScope(node: Segment): Scope {
    // Walk up the segment chain to find the root Operation
    const operation = AstUtils.getContainerOfType(node, isOperation);
    if (!operation) {
      return this.getAllAttributesScope(node);
    }

    // The operation's assignRoot is an Attribute or ShortcutDeclaration
    const root = operation.assignRoot?.ref;
    if (!root) {
      return this.getAllAttributesScope(node);
    }

    // Get the root type; track lastAttribute to expose meta-attributes
    let currentType: Data | RosettaRecordType | Choice | undefined;
    let lastAttribute: Attribute | undefined;
    if (isAttribute(root)) {
      currentType = this.resolveTypeCallToData(root.typeCall);
      lastAttribute = root;
    } else if (isShortcutDeclaration(root)) {
      currentType = root.expression ? this.resolveExpressionType(root.expression) : undefined;
    }

    // Walk the segment chain: for each preceding segment, resolve its type
    const segments = this.getSegmentChain(operation, node);
    for (const seg of segments) {
      if (!currentType) break;
      const feature = seg.feature?.ref;
      if (feature && (isAttribute(feature) || isRosettaRecordFeature(feature) || isChoiceOption(feature))) {
        lastAttribute = isAttribute(feature) ? feature : undefined;
        currentType = this.resolveTypeCallToData(feature.typeCall);
      } else {
        lastAttribute = undefined;
        currentType = undefined;
      }
    }

    // Include meta-attributes (reference, key, scheme…) if the last navigated
    // attribute has [metadata X] annotations — e.g. `-> dayDistribution -> scheme`
    // This must be checked even when currentType is undefined (e.g., enum-typed attrs).
    if (lastAttribute) {
      const metaAttrs = this.getMetaAttributeRefs(lastAttribute);
      const metaDescs = metaAttrs.map((a) => this.createDescription(a, a.name));
      const metaTypeDescs = this.getMetaTypeDescriptions();
      if (metaDescs.length > 0 || metaTypeDescs.length > 0) {
        const baseScope = this.buildTypedScope(currentType, node);
        return new MapScope([...metaDescs, ...metaTypeDescs], baseScope);
      }
    }

    if (!currentType) {
      return this.getAllAttributesScope(node);
    }

    return this.buildTypedScope(currentType, node);
  }

  /**
   * Get the chain of segments preceding the target segment.
   */
  private getSegmentChain(operation: Operation, target: Segment): Segment[] {
    const chain: Segment[] = [];
    let current: Segment | undefined = operation.path;
    while (current && current !== target) {
      chain.push(current);
      current = current.next;
    }
    return chain;
  }

  /**
   * Case 4b: Dispatch attribute scope.
   * Dispatch function overloads reference an input of the base (non-dispatch) function.
   * e.g. `func YearFraction(dayCountFractionEnum: DayCountFractionEnum -> _1_1):`
   * looks up `dayCountFractionEnum` from the base `func YearFraction:` inputs.
   */
  private dispatchSignature(func: RosettaFunction): RosettaFunction {
    const name = qualifiedExportPath(func.$container.name, func.name);
    const declarations = func.$container.elements.filter(isRosettaFunction);
    const local = getFunctionSignature(func, declarations);
    if (local !== func) return local;
    for (const description of this.indexManager.allElements('RosettaFunction')) {
      if (description.name !== name) continue;
      const root = this.documents.getDocument(description.documentUri)?.parseResult.value;
      const node = description.node ?? (root ? this.locator.getAstNode(root, description.path) : undefined);
      if (isRosettaFunction(node)) declarations.push(node);
    }
    return getFunctionSignature(func, declarations);
  }

  private getDispatchAttributeScope(node: AstNode): Scope {
    if (!isRosettaFunction(node)) return EMPTY_SCOPE;
    const signature = this.dispatchSignature(node);
    return this.createScopeForNodes(signature.inputs);
  }

  /**
   *  Case 4: Operation assign root — function inputs, output, and shortcuts in scope.
   *
   *  For dispatch overloads (which have a dispatchAttribute but no explicit output),
   *  we also search sibling functions with the same name to find their inputs/outputs.
   */
  private getOperationAssignScope(node: AstNode): Scope {
    const func = AstUtils.getContainerOfType(node, isRosettaFunction);
    if (!func) {
      return EMPTY_SCOPE;
    }
    const descriptions: AstNodeDescription[] = [];
    const seen = new Set<string>();

    const addAttr = (a: Attribute | ShortcutDeclaration) => {
      if (!seen.has(a.name)) {
        descriptions.push(this.createDescription(a, a.name));
        seen.add(a.name);
      }
    };

    // Always add this function's own inputs/output/shortcuts first
    for (const input of func.inputs) addAttr(input);
    if (func.output) addAttr(func.output);
    for (const shortcut of func.shortcuts) addAttr(shortcut);

    if (func.dispatchAttribute || func.superFunction) {
      const signature = this.dispatchSignature(func);
      for (const input of getFunctionInputs(signature)) addAttr(input);
      const output = getFunctionOutput(signature);
      if (output) addAttr(output);
      for (const shortcut of signature.shortcuts) addAttr(shortcut);
    }

    return descriptions.length > 0 ? new MapScope(descriptions) : EMPTY_SCOPE;
  }

  /**
   * Case 12: Symbol reference scope — standard scope PLUS:
   *
   * (a) Inherited attributes from a containing Data type's supertype chain,
   *     so that `type Trade extends TradableProduct` conditions can reference
   *     `product` (defined on TradableProduct).
   *
   * (b) Implicit lambda item attributes — when the symbol reference is the body
   *     of a parameter-less InlineFunction (e.g. `list extract value`), the
   *     reference should resolve to an attribute of each list element.
   */
  private getSymbolReferenceScope(node: AstNode, context: ReferenceInfo): Scope {
    if (
      isRosettaSymbolReference(node) &&
      isRosettaConstructorExpression(node.$container) &&
      node.$container.typeRef === node
    ) {
      return this.getGlobalScope('RosettaType', context);
    }
    if (isRosettaSymbolReference(node) && node.explicitArguments) {
      return this.getGlobalScope('RosettaCallableWithArgs', context);
    }
    const baseScope = super.getScope(context);
    const parent = node.$container;
    if (isEqualityOperation(parent) && parent.right === node && parent.left) {
      const attribute = this.getLastAttributeOfExpression(parent.left);
      const expected = attribute?.typeCall?.type?.ref;
      if (isRosettaEnumeration(expected)) {
        return new MapScope(
          getEnumValues(expected).map((value) => this.createDescription(value, value.name)),
          baseScope
        );
      }
    }
    const extra: AstNodeDescription[] = [];

    const rule = AstUtils.getContainerOfType(node, isRosettaRule);
    const ruleInput = rule && this.resolveTypeCallToData(rule.input);
    if (ruleInput)
      for (const field of this.buildTypedScope(ruleInput, node).getAllElements())
        if (baseScope.getElement(field.name)?.type !== 'ClosureParameter') extra.push(field);

    // (a) Inherited attributes from the enclosing Data type's supertype chain
    const dataOwner = AstUtils.getContainerOfType(node, isData);
    if (dataOwner?.superType?.ref) {
      const superRef = dataOwner.superType.ref;
      if (isData(superRef)) {
        const inheritedAttrs = this.collectDataAttributes(superRef);
        for (const a of inheritedAttrs) {
          extra.push(this.createDescription(a, a.name));
        }
      }
    }

    // (b) Implicit lambda: if this reference is inside a parameter-less InlineFunction,
    //     expose attributes of the element type of the enclosing map/filter/then operation.
    //
    //     The custom parser wraps bare expressions: `extract price` → `extract [price]`.
    //     So `then extract [value]` creates:
    //       ThenOperation { argument: collection, function: ImplicitInlineFunction {
    //         body: MapOperation { argument: null, function: InlineFunction { body: value_sym } }
    //       }}
    //     The inner InlineFunction's container is a headless MapOperation (argument=null),
    //     so we must walk UP through headless operations to find the enclosing argument.
    let searchFrom: AstNode = node;
    while (true) {
      const inlineFunc = AstUtils.getContainerOfType(searchFrom, isInlineFunction);
      if (!inlineFunc || inlineFunc.parameters.length > 0) break;

      const op = inlineFunc.$container;
      if (!op) break;

      const argument = isRosettaExpression(op) ? getOperationArgument(op) : undefined;

      if (argument) {
        const itemType = this.resolveCollectionElementType(argument);
        if (isData(itemType)) {
          for (const a of this.collectDataAttributes(itemType)) extra.push(this.createDescription(a, a.name));
          for (const option of this.collectInheritedChoiceOptions(itemType))
            extra.push(...this.choiceOptionDescriptions(option));
        } else if (isChoice(itemType)) {
          for (const option of itemType.attributes) extra.push(...this.choiceOptionDescriptions(option));
        } else if (isRosettaRecordType(itemType)) {
          for (const feature of itemType.features) extra.push(this.createDescription(feature, feature.name));
        }
        break;
      }

      // Headless operation (argument=null): walk up through the operation itself
      // to reach the outer InlineFunction/ThenOperation that carries the argument.
      searchFrom = op;
    }

    // (c) Switch case type narrowing: inside `fpmlProduct switch SomeType then <body>`,
    //     the scope should expose attributes of the narrowed type (`SomeType`).
    const switchCase = AstUtils.getContainerOfType(node, isSwitchCaseOrDefault);
    if (switchCase?.guard?.referenceGuard) {
      let guardResolved = switchCase.guard.referenceGuard.ref;
      // When guard resolves to an enum value that shadows a type name, look up the actual type
      if (guardResolved && isRosettaEnumValue(guardResolved)) {
        guardResolved = this.resolveDataOrChoiceByName(guardResolved.name) ?? guardResolved;
      }
      if (guardResolved && isData(guardResolved)) {
        const attrs = this.collectDataAttributes(guardResolved);
        for (const a of attrs) {
          extra.push(this.createDescription(a, a.name));
        }
      }
    }

    const func = AstUtils.getContainerOfType(node, isRosettaFunction);
    const constructorField = AstUtils.getContainerOfType(node, isConstructorKeyValuePair)?.key.ref;
    const signature = func ? this.dispatchSignature(func) : undefined;
    const output = signature ? getFunctionOutput(signature) : undefined;
    const fieldEnum =
      constructorField && 'typeCall' in constructorField ? constructorField.typeCall.type.ref : undefined;
    if (isRosettaEnumeration(fieldEnum))
      extra.push(...getEnumValues(fieldEnum).map((value) => this.createDescription(value, value.name)));
    const outputEnum = output?.typeCall?.type?.ref;
    if (isRosettaEnumeration(outputEnum)) {
      extra.push(...getEnumValues(outputEnum).map((value) => this.createDescription(value, value.name)));
    }
    if (signature && (func?.dispatchAttribute || func?.superFunction)) {
      const attributes = [...getFunctionInputs(signature), ...(output ? [output] : []), ...signature.shortcuts];
      for (const attribute of attributes) {
        const existing = baseScope.getElement(attribute.name)?.node;
        if (!existing || AstUtils.getContainerOfType(existing, isRosettaFunction) !== func) {
          extra.unshift(this.createDescription(attribute, attribute.name));
        }
      }
    }
    return extra.length > 0 ? new MapScope(extra, baseScope) : baseScope;
  }

  /**
   * Resolve the element type of a collection expression.
   * e.g. `list -> field` where field is a list of Data → returns the Data element type.
   */
  private resolveCollectionElementType(expr: RosettaExpression): Data | Choice | RosettaRecordType | undefined {
    return this.resolveExpressionType(expr);
  }

  /**
   * Case 5: Constructor key scope — features of the constructed type.
   */
  private getConstructorKeyScope(node: AstNode): Scope {
    const constructor = AstUtils.getContainerOfType(node, isRosettaConstructorExpression);
    if (!constructor?.typeRef) {
      return EMPTY_SCOPE;
    }
    const constructedType = this.resolveExpressionType(constructor.typeRef);

    const baseScope = this.buildTypedScope(constructedType, node);
    const metaDescs = this.getMetaTypeDescriptions().filter((description) => !baseScope.getElement(description.name));
    return metaDescs.length > 0 ? new MapScope(metaDescs, baseScope) : baseScope;
  }

  /**
   * Case 6: WithMetaEntry key scope — expose attributes of all annotation types,
   * so `with-meta { key: ... }` can resolve `key` to the `metadata` annotation's `key` attribute.
   */
  private getWithMetaKeyScope(node: AstNode): Scope {
    const descriptions: AstNodeDescription[] = [];
    const seen = new Set<string>();

    // First, collect annotation attributes from the local model
    const model = AstUtils.getContainerOfType(node, (n): n is RosettaModel => n.$type === 'RosettaModel');
    if (model) {
      for (const element of model.elements) {
        if (isAnnotation(element)) {
          for (const attr of element.attributes) {
            if (!seen.has(attr.name)) {
              descriptions.push(this.createDescription(attr, attr.name));
              seen.add(attr.name);
            }
          }
        }
      }
    }

    // Also collect from global index (annotations defined in other files, e.g. annotations.rosetta)
    for (const desc of this.indexManager.allElements('Annotation')) {
      const annotationNode = desc.node;
      if (annotationNode && isAnnotation(annotationNode)) {
        for (const attr of annotationNode.attributes) {
          if (!seen.has(attr.name)) {
            descriptions.push(this.createDescription(attr, attr.name));
            seen.add(attr.name);
          }
        }
      }
    }

    return descriptions.length > 0 ? new MapScope(descriptions) : EMPTY_SCOPE;
  }

  /**
   * Case 8: EnumValueReference value — values of the specified enumeration,
   * including values inherited from parent enumerations via `extends`.
   */
  private getEnumValueScope(node: AstNode): Scope {
    if (!isRosettaEnumValueReference(node)) {
      return EMPTY_SCOPE;
    }
    const enumRef = node.enumeration?.ref;
    if (!enumRef || !isRosettaEnumeration(enumRef)) {
      return EMPTY_SCOPE;
    }
    const descriptions = getEnumValues(enumRef).map((v) => this.createDescription(v, v.name));
    return descriptions.length > 0 ? new MapScope(descriptions) : EMPTY_SCOPE;
  }

  /**
   * Case 9b: Annotation attribute scope — attributes of the specified annotation.
   * e.g. in `[metadata scheme]`, `scheme` is an attribute of the `metadata` annotation.
   */
  private getAnnotationAttributeScope(node: AstNode): Scope {
    if (!isAnnotationRef(node)) return EMPTY_SCOPE;
    const annotation = node.annotation?.ref;
    if (!annotation || !isAnnotation(annotation)) return EMPTY_SCOPE;
    const descriptions = annotation.attributes.map((a) => this.createDescription(a, a.name));
    return descriptions.length > 0 ? new MapScope(descriptions) : EMPTY_SCOPE;
  }

  /**
   * Case 10: External attribute scope.
   */
  private getExternalAttributeScope(node: AstNode): Scope {
    const externalClass = AstUtils.getContainerOfType(node, isRosettaExternalClass);
    if (!externalClass) {
      return EMPTY_SCOPE;
    }
    const descriptions: AstNodeDescription[] = [];

    // Handle Data type references (the common case).
    const dataRef = externalClass.data?.ref;
    if (dataRef && isData(dataRef)) {
      descriptions.push(...this.collectDataAttributes(dataRef).map((a) => this.createDescription(a, a.name)));
    }

    // Also handle Choice types — the grammar declares data=[Data] but CDM synonym blocks
    // can reference choice types (e.g. `Payout:`, `Product:`, `CreditSupportAgreementElections:`).
    // Look up the referenced name as a Choice and include its ChoiceOption nodes.
    const refText = externalClass.data?.$refText;
    if (refText) {
      const choice = this.resolveChoiceByName(refText);
      if (choice) {
        for (const option of choice.attributes) {
          const optionRefText = option.typeCall?.type?.$refText ?? '';
          const simpleName = optionRefText.includes('.') ? optionRefText.split('.').pop()! : optionRefText;
          if (simpleName) {
            descriptions.push(this.createDescription(option, simpleName));
          }
        }
      }
    }

    return descriptions.length > 0 ? new MapScope(descriptions) : EMPTY_SCOPE;
  }

  // ── Fallback scopes ─────────────────────────────────────────────────

  /**
   * Collect all attributes from all Data types in the current document.
   * Used as a fallback when the receiver type cannot be resolved.
   */
  private getAllAttributesScope(node: AstNode): Scope {
    const model = AstUtils.getContainerOfType(node, (n): n is RosettaModel => n.$type === 'RosettaModel');
    if (!model) {
      return EMPTY_SCOPE;
    }
    const descriptions: AstNodeDescription[] = [];
    for (const element of model.elements) {
      if (isData(element)) {
        for (const attr of element.attributes) {
          descriptions.push(this.createDescription(attr, attr.name));
        }
      }
    }
    return new MapScope(descriptions);
  }

  // ── Namespace alias resolution ───────────────────────────────────────

  /**
   * Override global scope lookup to support `import ... as <alias>` resolution.
   *
   * When a file contains `import fpml.consolidated.shared.* as fpml`, references
   * written as `fpml.Leg` should resolve to `fpml.consolidated.shared.Leg` in the
   * global index.  We do this by building a thin alias-expansion layer on top of
   * the regular global scope: for every qualified reference name we try to replace
   * a known alias prefix with the full namespace prefix and retry the lookup.
   */
  protected override getGlobalScope(referenceType: string, context: ReferenceInfo): Scope {
    const base = super.getGlobalScope(referenceType, context);

    const model = AstUtils.getContainerOfType(context.container, (n): n is RosettaModel => n.$type === 'RosettaModel');
    if (!model) return base;

    const scope = buildImportScope(model.name, model.imports);
    return new AliasResolvingScope(base, scope.aliases, scope.namespaces, scope.explicitImports);
  }

  /**
   * RosettaAttributeReference.attribute — attributes of the receiver Data type.
   * e.g. `PriceQuantity->price`: scope = attributes of PriceQuantity.
   * The receiver can be RosettaDataReference OR a prior RosettaAttributeReference.
   */
  private getRosettaAttributeRefScope(node: AstNode): Scope {
    if (!isRosettaAttributeReference(node)) return EMPTY_SCOPE;
    const receiver = node.receiver;
    if (!receiver) return EMPTY_SCOPE;
    const receiverType = this.resolveRosettaAttributeRefType(receiver);
    return this.buildTypedScope(receiverType, node);
  }

  /**
   * Resolve the type produced by a RosettaAttributeReference expression.
   * Returns a Data, Choice, or RosettaRecordType node.
   */
  private resolveRosettaAttributeRefType(node: AstNode): Data | RosettaRecordType | Choice | undefined {
    if (isRosettaDataReference(node)) {
      const ref = node.data?.ref;
      if (ref && isData(ref)) return ref;
      if (ref && isChoice(ref)) return ref;
      const refText = node.data?.$refText;
      if (refText) return this.resolveDataOrChoiceByName(refText);
      return undefined;
    }
    if (isRosettaAttributeReference(node)) {
      const attrRef = node.attribute?.ref;
      if (attrRef && isAttribute(attrRef)) {
        return this.resolveTypeCallToData(attrRef.typeCall);
      }
      if (attrRef && isChoiceOption(attrRef)) {
        return this.resolveTypeCallToData(attrRef.typeCall);
      }
      // Fallback: resolve receiver first, then find attr/option by name
      const receiverType = this.resolveRosettaAttributeRefType(node.receiver);
      const attrText = node.attribute?.$refText;
      if (receiverType && attrText) {
        if (isData(receiverType)) {
          const attrs = this.collectDataAttributes(receiverType);
          const found = attrs.find((a) => a.name === attrText);
          if (found) return this.resolveTypeCallToData(found.typeCall);
        }
        if (isChoice(receiverType)) {
          // Find the choice option whose type name matches
          for (const opt of receiverType.attributes) {
            const refText = opt.typeCall?.type?.$refText ?? '';
            const simpleName = refText.includes('.') ? refText.split('.').pop()! : refText;
            if (simpleName === attrText) {
              return this.resolveTypeCallToData(opt.typeCall);
            }
          }
        }
      }
    }
    return undefined;
  }

  /**
   * AnnotationPath.attribute — scope from the receiver's resolved type.
   */
  private getAnnotationPathScope(receiver: AnnotationPathExpression): Scope {
    const type = this.resolveAnnotationPathType(receiver);
    if (!type) return EMPTY_SCOPE;
    return this.buildTypedScope(type, receiver);
  }

  /**
   * AnnotationDeepPath.attribute — deep features from the receiver's resolved type.
   */
  private getAnnotationDeepPathScope(receiver: AnnotationPathExpression): Scope {
    const type = this.resolveAnnotationPathType(receiver);
    if (!type) return EMPTY_SCOPE;
    const allFeatures = this.collectTransitiveAttributes(type);
    if (allFeatures.length === 0) return EMPTY_SCOPE;
    const descriptions = allFeatures.map((f) => {
      if (isChoiceOption(f)) {
        const refText = f.typeCall?.type?.$refText ?? '';
        const simpleName = refText.includes('.') ? refText.split('.').pop()! : refText;
        return this.createDescription(f, simpleName);
      }
      return this.createDescription(f, f.name);
    });
    return new MapScope(descriptions);
  }

  /**
   * Resolve the type produced by an AnnotationPathExpression.
   */
  private resolveAnnotationPathType(expr: AnnotationPathExpression): Data | RosettaRecordType | Choice | undefined {
    if (isAnnotationPathAttributeReference(expr)) {
      // The starting attribute — its type
      const attr = expr.attribute?.ref;
      if (attr && isAttribute(attr)) return this.resolveTypeCallToData(attr.typeCall);
      const refText = expr.attribute?.$refText;
      if (refText) {
        // Try finding by name from the enclosing Data type
        const data = AstUtils.getContainerOfType(expr, isData);
        if (data) {
          const attrs = this.collectDataAttributes(data);
          const found = attrs.find((a) => a.name === refText);
          if (found) return this.resolveTypeCallToData(found.typeCall);
        }
      }
      return undefined;
    }
    if (isAnnotationPath(expr)) {
      const attr = expr.attribute?.ref;
      if (attr && isAttribute(attr)) return this.resolveTypeCallToData(attr.typeCall);
      // Fallback: resolve from receiver type
      const receiverType = this.resolveAnnotationPathType(expr.receiver);
      if (receiverType && isData(receiverType)) {
        const attrText = expr.attribute?.$refText;
        if (attrText) {
          const attrs = this.collectDataAttributes(receiverType);
          const found = attrs.find((a) => a.name === attrText);
          if (found) return this.resolveTypeCallToData(found.typeCall);
        }
      }
      return undefined;
    }
    if (isAnnotationDeepPath(expr)) {
      const attr = expr.attribute?.ref;
      if (attr && isAttribute(attr)) return this.resolveTypeCallToData(attr.typeCall);
      return undefined;
    }
    return undefined;
  }

  /**
   * AnnotationPathAttributeReference.attribute — attributes of the enclosing Data type.
   * e.g. `[regulatoryReference for quantity -> unit]` on an attribute of Taxonomy:
   * `quantity` is scoped to Taxonomy's attributes.
   */
  private getAnnotationPathAttributeRefScope(node: AstNode): Scope {
    // Walk up to find the enclosing Data type
    const data = AstUtils.getContainerOfType(node, isData);
    if (!data) return EMPTY_SCOPE;
    const attrs = this.collectDataAttributes(data);
    if (attrs.length === 0) return EMPTY_SCOPE;
    const descriptions = attrs.map((a) => this.createDescription(a, a.name));
    return new MapScope(descriptions);
  }

  /**
   * ChoiceOperation.attributes — attributes of the argument type or enclosing Data type.
   * e.g. `optional choice field1, field2` in a condition.
   */
  private getChoiceOperationAttributeScope(node: AstNode): Scope {
    if (!isChoiceOperation(node)) return EMPTY_SCOPE;
    // If argument is provided, use its type
    if (node.argument) {
      const argType = this.resolveExpressionType(node.argument);
      if (argType) return this.buildTypedScope(argType, node);
    }
    // Fall back to enclosing Data type
    const data = AstUtils.getContainerOfType(node, isData);
    if (!data) {
      const rule = AstUtils.getContainerOfType(node, isRosettaRule);
      const input = rule && this.resolveTypeCallToData(rule.input);
      return input ? this.buildTypedScope(input, node) : EMPTY_SCOPE;
    }
    const attrs = this.collectDataAttributes(data);
    if (attrs.length === 0) return EMPTY_SCOPE;
    const descriptions = attrs.map((a) => this.createDescription(a, a.name));
    return new MapScope(descriptions);
  }

  private createDescription(node: AstNode, name: string): AstNodeDescription {
    return this.descriptions.createDescription(node, name);
  }
}
