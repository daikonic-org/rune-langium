// @ts-nocheck — generated file; edit generate-zod.ts to regenerate
import { z } from 'zod';
import { zRef } from 'langium-zod';

export const ReferenceSchema = z.looseObject({ $refText: z.string(), ref: z.unknown().optional() });

export const CardinalityModifierSchema = z.union([z.literal('any'), z.literal('all')]);

export const ExistsModifierSchema = z.union([z.literal('single'), z.literal('multiple')]);

export const ExternalValueOperatorSchema = z.union([z.literal('+'), z.literal('-')]);

export const NecessitySchema = z.union([z.literal('optional'), z.literal('required')]);

export const RosettaQualifiableTypeSchema = z.union([z.literal('isEvent'), z.literal('isProduct')]);

export const RosettaSynonymRefSchema = z.union([z.literal('tag'), z.literal('componentID')]);

export const BigDecimalSchema = z.string().regex(new RegExp('^[+-]?(\\.[0-9]+|[0-9]+(\\.[0-9]*)?)([eE][+-]?[0-9]+)?$'));

export const ValidIDSchema = z.union([
  z.string().regex(new RegExp('\\^?[a-zA-Z_][a-zA-Z_0-9]*')),
  z.literal('condition'),
  z.literal('source'),
  z.literal('value'),
  z.literal('version'),
  z.literal('pattern'),
  z.literal('scope'),
  z.literal('definition'),
  z.literal('standard')
]);

export const IntegerSchema = z.bigint();

export const QualifiedNameSchema = z.string();

export const QualifiedNameWithWildcardSchema = z.string();

export const TypeParameterValidIDSchema = z.string();

export const TypeCallArgumentSchema = z.looseObject({
  $type: z.literal('TypeCallArgument'),
  parameter: ReferenceSchema,
  value: z.lazy(() => RosettaExpressionSchema)
});

export const TypeCallSchema = z.looseObject({
  $type: z.literal('TypeCall'),
  type: ReferenceSchema,
  arguments: z.array(TypeCallArgumentSchema)
});

export const RosettaCardinalitySchema = z.looseObject({
  $type: z.literal('RosettaCardinality'),
  inf: z.number(),
  sup: z.number().optional(),
  unbounded: z.boolean().optional()
});

export const RosettaSegmentRefSchema = z.looseObject({
  $type: z.literal('RosettaSegmentRef'),
  segment: ReferenceSchema,
  segmentRef: z.string()
});

export const RegulatoryDocumentReferenceSchema = z.looseObject({
  $type: z.literal('RegulatoryDocumentReference'),
  body: ReferenceSchema,
  corpusList: z.array(ReferenceSchema).min(1),
  segments: z.array(RosettaSegmentRefSchema)
});

export const DocumentRationaleSchema = z.looseObject({
  $type: z.literal('DocumentRationale'),
  rationale: z.string(),
  rationaleAuthor: z.string().optional()
});

export const RosettaDocReferenceSchema = z.looseObject({
  $type: z.literal('RosettaDocReference'),
  name: z.union([z.literal('regulatoryReference'), z.literal('docReference')]),
  path: z.lazy(() => AnnotationPathExpressionSchema).optional(),
  docReference: RegulatoryDocumentReferenceSchema,
  rationales: z.array(DocumentRationaleSchema),
  structuredProvision: z.string().optional(),
  provision: z.string().optional(),
  reportedField: z.boolean().optional()
});

export const RosettaAttributeReferenceSchema = z.looseObject({
  $type: z.literal('RosettaAttributeReference'),
  get receiver() {
    return z.union([RosettaDataReferenceSchema, RosettaAttributeReferenceSchema]);
  },
  attribute: ReferenceSchema
});

export const AnnotationQualifierSchema = z
  .looseObject({
    $type: z.literal('AnnotationQualifier'),
    qualName: z.string(),
    qualValue: z.string().optional(),
    qualPath: RosettaAttributeReferenceSchema.optional()
  })
  .superRefine((val, ctx) => {
    if (!(val['qualValue'] !== undefined || val['qualPath'] !== undefined)) {
      ctx.addIssue({ code: 'custom', message: 'At least one of qualValue, qualPath must be present' });
    }
  });

export const AnnotationRefSchema = z.looseObject({
  $type: z.literal('AnnotationRef'),
  annotation: ReferenceSchema,
  attribute: ReferenceSchema.optional(),
  qualifiers: z.array(AnnotationQualifierSchema)
});

export const RosettaMergeSynonymValueSchema = z.looseObject({
  $type: z.literal('RosettaMergeSynonymValue'),
  name: z.string(),
  excludePath: z.string().optional()
});

export const RosettaMappingPathTestsSchema = z.looseObject({
  $type: z.literal('RosettaMappingPathTests'),
  tests: z.array(z.lazy(() => RosettaMapTestSchema)).min(1)
});

export const RosettaMappingInstanceSchema = z
  .looseObject({
    $type: z.literal('RosettaMappingInstance'),
    when: RosettaMappingPathTestsSchema.optional(),
    default: z.boolean().optional(),
    set: z.lazy(() => RosettaMapTestExpressionSchema).optional()
  })
  .superRefine((val, ctx) => {
    if (!(val['when'] !== undefined || val['set'] !== undefined)) {
      ctx.addIssue({ code: 'custom', message: 'At least one of when, set must be present' });
    }
  });

export const RosettaMappingSchema = z.looseObject({
  $type: z.literal('RosettaMapping'),
  instances: z.array(RosettaMappingInstanceSchema).min(1)
});

export const RosettaSynonymValueBaseSchema = z.looseObject({
  $type: z.literal('RosettaSynonymValueBase'),
  name: z.string(),
  refType: RosettaSynonymRefSchema.optional(),
  value: z.number().optional(),
  path: z.string().optional(),
  maps: z.number().optional()
});

export const RosettaSynonymBodySchema = z
  .looseObject({
    $type: z.literal('RosettaSynonymBody'),
    hints: z.array(z.string()),
    format: z.string().optional(),
    merge: RosettaMergeSynonymValueSchema.optional(),
    mappingLogic: RosettaMappingSchema.optional(),
    metaValues: z.array(z.string()),
    patternMatch: z.string().optional(),
    patternReplace: z.string().optional(),
    removeHtml: z.boolean().optional(),
    mapper: z.string().optional(),
    values: z.array(RosettaSynonymValueBaseSchema)
  })
  .superRefine((val, ctx) => {
    if (
      !(
        val['hints']?.length ||
        val['merge'] !== undefined ||
        val['mappingLogic'] !== undefined ||
        val['metaValues']?.length ||
        val['values']?.length
      )
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'At least one of hints, merge, mappingLogic, metaValues, values must be present'
      });
    }
  });

export const RosettaSynonymSchema = z.looseObject({
  $type: z.literal('RosettaSynonym'),
  sources: z.array(ReferenceSchema).min(1),
  body: RosettaSynonymBodySchema
});

export const LabelAnnotationSchema = z.looseObject({
  $type: z.literal('LabelAnnotation'),
  name: z.literal('label'),
  label: z.string(),
  path: z.lazy(() => AnnotationPathExpressionSchema).optional(),
  deprecatedAs: z.boolean().optional()
});

export const RuleReferenceAnnotationSchema = z.looseObject({
  $type: z.literal('RuleReferenceAnnotation'),
  name: z.literal('ruleReference'),
  path: z.lazy(() => AnnotationPathExpressionSchema).optional(),
  reportingRule: ReferenceSchema.optional(),
  empty: z.boolean().optional()
});

export const AttributeSchema = z.looseObject({
  $type: z.literal('Attribute'),
  override: z.boolean().optional(),
  name: ValidIDSchema,
  typeCall: TypeCallSchema,
  typeCallArgs: z.array(TypeCallArgumentSchema),
  card: RosettaCardinalitySchema,
  definition: z.string().optional(),
  references: z.array(RosettaDocReferenceSchema),
  annotations: z.array(AnnotationRefSchema),
  synonyms: z.array(RosettaSynonymSchema),
  labels: z.array(LabelAnnotationSchema),
  ruleReferences: z.array(RuleReferenceAnnotationSchema)
});

export const AnnotationSchema = z.looseObject({
  $type: z.literal('Annotation'),
  name: ValidIDSchema,
  definition: z.string().optional(),
  prefix: ValidIDSchema.optional(),
  attributes: z.array(AttributeSchema)
});

export const AnnotationDeepPathSchema = z.looseObject({
  $type: z.literal('AnnotationDeepPath'),
  receiver: z.lazy(() => AnnotationPathExpressionSchema),
  operator: z.literal('->>'),
  attribute: ReferenceSchema
});

export const AnnotationPathSchema = z.looseObject({
  $type: z.literal('AnnotationPath'),
  receiver: z.lazy(() => AnnotationPathExpressionSchema),
  operator: z.literal('->'),
  attribute: ReferenceSchema
});

export const AnnotationPathAttributeReferenceSchema = z.looseObject({
  $type: z.literal('AnnotationPathAttributeReference'),
  attribute: ReferenceSchema
});

export const ArithmeticOperationSchema = z.looseObject({
  $type: z.literal('ArithmeticOperation'),
  left: z.lazy(() => RosettaExpressionSchema),
  operator: z.union([z.literal('+'), z.literal('-'), z.literal('*'), z.literal('/')]),
  right: z.lazy(() => RosettaExpressionSchema)
});

export const AsKeyOperationSchema = z.looseObject({
  $type: z.literal('AsKeyOperation'),
  argument: z.lazy(() => RosettaExpressionSchema),
  operator: z.literal('as-key')
});

export const AsOperationSchema = z.looseObject({
  $type: z.literal('AsOperation'),
  argument: z.lazy(() => RosettaExpressionSchema).optional(),
  operator: z.literal('as'),
  type: ReferenceSchema
});

export const ChoiceOptionSchema = z.looseObject({
  $type: z.literal('ChoiceOption'),
  typeCall: TypeCallSchema,
  definition: z.string().optional(),
  references: z.array(RosettaDocReferenceSchema),
  annotations: z.array(AnnotationRefSchema),
  synonyms: z.array(RosettaSynonymSchema),
  labels: z.array(LabelAnnotationSchema),
  ruleReferences: z.array(RuleReferenceAnnotationSchema)
});

export const RosettaClassSynonymSchema = z.looseObject({
  $type: z.literal('RosettaClassSynonym'),
  sources: z.array(ReferenceSchema).min(1),
  value: RosettaSynonymValueBaseSchema.optional(),
  metaValue: RosettaSynonymValueBaseSchema.optional()
});

export const ChoiceSchema = z.looseObject({
  $type: z.literal('Choice'),
  name: ValidIDSchema,
  definition: z.string().optional(),
  attributes: z.array(ChoiceOptionSchema),
  annotations: z.array(AnnotationRefSchema),
  synonyms: z.array(RosettaClassSynonymSchema)
});

export const ChoiceOperationSchema = z.looseObject({
  $type: z.literal('ChoiceOperation'),
  argument: z.lazy(() => RosettaExpressionSchema).optional(),
  necessity: NecessitySchema,
  operator: z.literal('choice'),
  attributes: z.array(ReferenceSchema)
});

export const ClosureParameterSchema = z.looseObject({ $type: z.literal('ClosureParameter'), name: z.string() });

export const ComparisonOperationSchema = z.looseObject({
  $type: z.literal('ComparisonOperation'),
  left: z.lazy(() => RosettaExpressionSchema).optional(),
  cardMod: CardinalityModifierSchema.optional(),
  operator: z.union([z.literal('>='), z.literal('<='), z.literal('>'), z.literal('<')]),
  right: z.lazy(() => RosettaExpressionSchema)
});

export const ConditionSchema = z.looseObject({
  $type: z.literal('Condition'),
  name: ValidIDSchema.optional(),
  definition: z.string().optional(),
  expression: z.lazy(() => RosettaExpressionSchema),
  references: z.array(RosettaDocReferenceSchema),
  annotations: z.array(AnnotationRefSchema),
  postCondition: z.boolean().optional()
});

export const ConstructorKeyValuePairSchema = z.looseObject({
  $type: z.literal('ConstructorKeyValuePair'),
  key: ReferenceSchema,
  value: z.lazy(() => RosettaExpressionSchema)
});

export const DataSchema = z.looseObject({
  $type: z.literal('Data'),
  name: ValidIDSchema,
  superType: ReferenceSchema.optional(),
  definition: z.string().optional(),
  attributes: z.array(AttributeSchema),
  references: z.array(RosettaDocReferenceSchema),
  annotations: z.array(AnnotationRefSchema),
  synonyms: z.array(RosettaClassSynonymSchema)
});

export const DefaultOperationSchema = z.looseObject({
  $type: z.literal('DefaultOperation'),
  left: z.lazy(() => RosettaExpressionSchema).optional(),
  operator: z.literal('default'),
  right: z.lazy(() => RosettaExpressionSchema)
});

export const DistinctOperationSchema = z.looseObject({
  $type: z.literal('DistinctOperation'),
  argument: z.lazy(() => RosettaExpressionSchema).optional(),
  operator: z.literal('distinct')
});

export const EqualityOperationSchema = z.looseObject({
  $type: z.literal('EqualityOperation'),
  left: z.lazy(() => RosettaExpressionSchema).optional(),
  cardMod: CardinalityModifierSchema.optional(),
  operator: z.union([z.literal('='), z.literal('<>')]),
  right: z.lazy(() => RosettaExpressionSchema)
});

export const InlineFunctionSchema = z.looseObject({
  $type: z.literal('InlineFunction'),
  body: z.lazy(() => RosettaExpressionSchema),
  parameters: z.array(ClosureParameterSchema)
});

export const FilterOperationSchema = z.looseObject({
  $type: z.literal('FilterOperation'),
  argument: z.lazy(() => RosettaExpressionSchema).optional(),
  operator: z.literal('filter'),
  function: InlineFunctionSchema.optional()
});

export const FirstOperationSchema = z.looseObject({
  $type: z.literal('FirstOperation'),
  argument: z.lazy(() => RosettaExpressionSchema).optional(),
  operator: z.literal('first')
});

export const FlattenOperationSchema = z.looseObject({
  $type: z.literal('FlattenOperation'),
  argument: z.lazy(() => RosettaExpressionSchema).optional(),
  operator: z.literal('flatten')
});

export const ImportSchema = z.looseObject({
  $type: z.literal('Import'),
  importedNamespace: QualifiedNameWithWildcardSchema,
  namespaceAlias: ValidIDSchema.optional()
});

export const JoinOperationSchema = z.looseObject({
  $type: z.literal('JoinOperation'),
  left: z.lazy(() => RosettaExpressionSchema).optional(),
  operator: z.literal('join'),
  right: z.lazy(() => RosettaExpressionSchema).optional()
});

export const LastOperationSchema = z.looseObject({
  $type: z.literal('LastOperation'),
  argument: z.lazy(() => RosettaExpressionSchema).optional(),
  operator: z.literal('last')
});

export const ListLiteralSchema = z.looseObject({
  $type: z.literal('ListLiteral'),
  elements: z.array(z.lazy(() => RosettaExpressionSchema))
});

export const LogicalOperationSchema = z.looseObject({
  $type: z.literal('LogicalOperation'),
  left: z.lazy(() => RosettaExpressionSchema),
  operator: z.union([z.literal('or'), z.literal('and')]),
  right: z.lazy(() => RosettaExpressionSchema)
});

export const MapOperationSchema = z.looseObject({
  $type: z.literal('MapOperation'),
  argument: z.lazy(() => RosettaExpressionSchema).optional(),
  operator: z.literal('extract'),
  function: InlineFunctionSchema.optional()
});

export const MaxOperationSchema = z.looseObject({
  $type: z.literal('MaxOperation'),
  argument: z.lazy(() => RosettaExpressionSchema).optional(),
  operator: z.literal('max'),
  function: InlineFunctionSchema.optional()
});

export const MinOperationSchema = z.looseObject({
  $type: z.literal('MinOperation'),
  argument: z.lazy(() => RosettaExpressionSchema).optional(),
  operator: z.literal('min'),
  function: InlineFunctionSchema.optional()
});

export const OneOfOperationSchema = z.looseObject({
  $type: z.literal('OneOfOperation'),
  argument: z.lazy(() => RosettaExpressionSchema).optional(),
  operator: z.literal('one-of')
});

export const SegmentSchema = z.looseObject({
  $type: z.literal('Segment'),
  feature: ReferenceSchema,
  get next() {
    return SegmentSchema.optional();
  }
});

export const OperationSchema = z.looseObject({
  $type: z.literal('Operation'),
  assignRoot: ReferenceSchema,
  path: SegmentSchema.optional(),
  definition: z.string().optional(),
  expression: z.lazy(() => RosettaExpressionSchema),
  add: z.boolean().optional()
});

export const ReduceOperationSchema = z.looseObject({
  $type: z.literal('ReduceOperation'),
  argument: z.lazy(() => RosettaExpressionSchema).optional(),
  operator: z.literal('reduce'),
  function: InlineFunctionSchema.optional()
});

export const ReverseOperationSchema = z.looseObject({
  $type: z.literal('ReverseOperation'),
  argument: z.lazy(() => RosettaExpressionSchema).optional(),
  operator: z.literal('reverse')
});

export const RosettaAbsentExpressionSchema = z.looseObject({
  $type: z.literal('RosettaAbsentExpression'),
  argument: z.lazy(() => RosettaExpressionSchema).optional(),
  operator: z.literal('absent')
});

export const TypeParameterSchema = z.looseObject({
  $type: z.literal('TypeParameter'),
  name: TypeParameterValidIDSchema,
  typeCall: TypeCallSchema,
  definition: z.string().optional()
});

export const RosettaBasicTypeSchema = z.looseObject({
  $type: z.literal('RosettaBasicType'),
  name: ValidIDSchema,
  parameters: z.array(TypeParameterSchema),
  definition: z.string().optional()
});

export const RosettaBodySchema = z.looseObject({
  $type: z.literal('RosettaBody'),
  bodyType: z.string(),
  name: ValidIDSchema,
  definition: z.string().optional()
});

export const RosettaBooleanLiteralSchema = z.looseObject({
  $type: z.literal('RosettaBooleanLiteral'),
  value: z.boolean().optional()
});

export const RosettaConditionalExpressionSchema = z.looseObject({
  $type: z.literal('RosettaConditionalExpression'),
  if: z.lazy(() => RosettaExpressionSchema).optional(),
  ifthen: z.lazy(() => RosettaExpressionSchema).optional(),
  full: z.boolean().optional(),
  elsethen: z.lazy(() => RosettaExpressionSchema).optional()
});

export const RosettaSuperCallSchema = z.looseObject({
  $type: z.literal('RosettaSuperCall'),
  name: z.literal('super'),
  explicitArguments: z.boolean().optional(),
  rawArgs: z.array(z.lazy(() => RosettaExpressionSchema))
});

export const RosettaSymbolReferenceSchema = z.looseObject({
  $type: z.literal('RosettaSymbolReference'),
  symbol: ReferenceSchema,
  explicitArguments: z.boolean().optional(),
  rawArgs: z.array(z.lazy(() => RosettaExpressionSchema))
});

export const RosettaConstructorExpressionSchema = z.looseObject({
  $type: z.literal('RosettaConstructorExpression'),
  typeRef: z.union([RosettaSuperCallSchema, RosettaSymbolReferenceSchema]),
  constructorTypeArgs: z.array(TypeCallArgumentSchema),
  implicitEmpty: z.boolean().optional(),
  values: z.array(ConstructorKeyValuePairSchema)
});

export const RosettaContainsExpressionSchema = z.looseObject({
  $type: z.literal('RosettaContainsExpression'),
  left: z.lazy(() => RosettaExpressionSchema).optional(),
  operator: z.literal('contains'),
  right: z.lazy(() => RosettaExpressionSchema)
});

export const RosettaCorpusSchema = z.looseObject({
  $type: z.literal('RosettaCorpus'),
  corpusType: z.string(),
  displayName: z.string().optional(),
  body: ReferenceSchema.optional(),
  name: ValidIDSchema,
  definition: z.string().optional()
});

export const RosettaCountOperationSchema = z.looseObject({
  $type: z.literal('RosettaCountOperation'),
  argument: z.lazy(() => RosettaExpressionSchema).optional(),
  operator: z.literal('count')
});

export const RosettaDataReferenceSchema = z.looseObject({
  $type: z.literal('RosettaDataReference'),
  data: ReferenceSchema
});

export const RosettaDeepFeatureCallSchema = z.looseObject({
  $type: z.literal('RosettaDeepFeatureCall'),
  receiver: z.lazy(() => RosettaExpressionSchema),
  feature: ReferenceSchema.optional()
});

export const RosettaDisjointExpressionSchema = z.looseObject({
  $type: z.literal('RosettaDisjointExpression'),
  left: z.lazy(() => RosettaExpressionSchema).optional(),
  operator: z.literal('disjoint'),
  right: z.lazy(() => RosettaExpressionSchema)
});

export const RosettaEnumSynonymSchema = z.looseObject({
  $type: z.literal('RosettaEnumSynonym'),
  sources: z.array(ReferenceSchema).min(1),
  synonymValue: z.string(),
  definition: z.string().optional(),
  patternMatch: z.string().optional(),
  patternReplace: z.string().optional(),
  removeHtml: z.boolean().optional()
});

export const RosettaEnumValueSchema = z.looseObject({
  $type: z.literal('RosettaEnumValue'),
  name: ValidIDSchema,
  display: z.string().optional(),
  definition: z.string().optional(),
  references: z.array(RosettaDocReferenceSchema),
  annotations: z.array(AnnotationRefSchema),
  enumSynonyms: z.array(RosettaEnumSynonymSchema)
});

export const RosettaEnumerationSchema = z.looseObject({
  $type: z.literal('RosettaEnumeration'),
  name: ValidIDSchema,
  parent: ReferenceSchema.optional(),
  definition: z.string().optional(),
  enumValues: z.array(RosettaEnumValueSchema),
  references: z.array(RosettaDocReferenceSchema),
  annotations: z.array(AnnotationRefSchema),
  synonyms: z.array(RosettaSynonymSchema)
});

export const RosettaEnumValueReferenceSchema = z.looseObject({
  $type: z.literal('RosettaEnumValueReference'),
  enumeration: ReferenceSchema,
  value: ReferenceSchema
});

export const RosettaExistsExpressionSchema = z.looseObject({
  $type: z.literal('RosettaExistsExpression'),
  argument: z.lazy(() => RosettaExpressionSchema).optional(),
  modifier: ExistsModifierSchema.optional(),
  operator: z.literal('exists')
});

export const RosettaExternalClassSynonymSchema = z.looseObject({
  $type: z.literal('RosettaExternalClassSynonym'),
  value: RosettaSynonymValueBaseSchema.optional(),
  metaValue: RosettaSynonymValueBaseSchema
});

export const RosettaExternalSynonymSchema = z.looseObject({
  $type: z.literal('RosettaExternalSynonym'),
  body: RosettaSynonymBodySchema
});

export const RosettaExternalRegularAttributeSchema = z.looseObject({
  $type: z.literal('RosettaExternalRegularAttribute'),
  operator: ExternalValueOperatorSchema,
  attributeRef: ReferenceSchema,
  externalSynonyms: z.array(RosettaExternalSynonymSchema),
  externalRuleReferences: z.array(RuleReferenceAnnotationSchema)
});

export const RosettaExternalClassSchema = z.looseObject({
  $type: z.literal('RosettaExternalClass'),
  data: ReferenceSchema,
  externalClassSynonyms: z.array(RosettaExternalClassSynonymSchema),
  regularAttributes: z.array(RosettaExternalRegularAttributeSchema)
});

export const RosettaExternalEnumValueSchema = z.looseObject({
  $type: z.literal('RosettaExternalEnumValue'),
  operator: ExternalValueOperatorSchema,
  enumRef: ReferenceSchema,
  externalEnumSynonyms: z.array(RosettaEnumSynonymSchema)
});

export const RosettaExternalEnumSchema = z.looseObject({
  $type: z.literal('RosettaExternalEnum'),
  enumeration: ReferenceSchema,
  regularValues: z.array(RosettaExternalEnumValueSchema)
});

export const RosettaParameterSchema = z.looseObject({
  $type: z.literal('RosettaParameter'),
  name: ValidIDSchema,
  typeCall: TypeCallSchema,
  isArray: z.boolean().optional()
});

export const RosettaExternalFunctionSchema = z.looseObject({
  $type: z.literal('RosettaExternalFunction'),
  name: ValidIDSchema,
  typeCall: TypeCallSchema,
  definition: z.string().optional(),
  parameters: z.array(RosettaParameterSchema)
});

export const RosettaExternalRuleSourceSchema = z.looseObject({
  $type: z.literal('RosettaExternalRuleSource'),
  name: ValidIDSchema,
  externalClasses: z.array(RosettaExternalClassSchema),
  externalEnums: z.array(RosettaExternalEnumSchema),
  superSources: z.array(ReferenceSchema)
});

export const RosettaFeatureCallSchema = z.looseObject({
  $type: z.literal('RosettaFeatureCall'),
  receiver: z.lazy(() => RosettaExpressionSchema),
  feature: ReferenceSchema.optional()
});

export const RosettaFunctionSchema = z.looseObject({
  $type: z.literal('RosettaFunction'),
  name: ValidIDSchema,
  definition: z.string().optional(),
  references: z.array(RosettaDocReferenceSchema),
  annotations: z.array(AnnotationRefSchema),
  inputs: z.array(AttributeSchema),
  output: AttributeSchema.optional()
});

export const RosettaImplicitVariableSchema = z.looseObject({
  $type: z.literal('RosettaImplicitVariable'),
  name: z.literal('item')
});

export const RosettaIntLiteralSchema = z.looseObject({ $type: z.literal('RosettaIntLiteral'), value: IntegerSchema });

export const RosettaMapPathValueSchema = z.looseObject({ $type: z.literal('RosettaMapPathValue'), path: z.string() });

export const RosettaMapPathSchema = z.looseObject({
  $type: z.literal('RosettaMapPath'),
  path: RosettaMapPathValueSchema
});

export const RosettaMapRosettaPathSchema = z.looseObject({
  $type: z.literal('RosettaMapRosettaPath'),
  path: RosettaAttributeReferenceSchema
});

export const RosettaMapTestAbsentExpressionSchema = z.looseObject({
  $type: z.literal('RosettaMapTestAbsentExpression'),
  argument: RosettaMapPathValueSchema
});

export const RosettaMapTestEqualityOperationSchema = z.looseObject({
  $type: z.literal('RosettaMapTestEqualityOperation'),
  left: RosettaMapPathValueSchema,
  operator: z.union([z.literal('='), z.literal('<>')]),
  right: z.lazy(() => RosettaMapTestExpressionSchema)
});

export const RosettaMapTestExistsExpressionSchema = z.looseObject({
  $type: z.literal('RosettaMapTestExistsExpression'),
  argument: RosettaMapPathValueSchema
});

export const RosettaMapTestFuncSchema = z.looseObject({
  $type: z.literal('RosettaMapTestFunc'),
  func: ReferenceSchema,
  predicatePath: RosettaMapPathValueSchema.optional()
});

export const RosettaMetaTypeSchema = z.looseObject({
  $type: z.literal('RosettaMetaType'),
  name: ValidIDSchema,
  typeCall: TypeCallSchema
});

export const RosettaScopeSchema = z.looseObject({
  $type: z.literal('RosettaScope'),
  name: ValidIDSchema,
  definition: z.string().optional()
});

export const RosettaQualifiableConfigurationSchema = z.looseObject({
  $type: z.literal('RosettaQualifiableConfiguration'),
  qType: RosettaQualifiableTypeSchema,
  rosettaClass: ReferenceSchema
});

export const RosettaModelSchema = z.looseObject({
  $type: z.literal('RosettaModel'),
  overridden: z.boolean().optional(),
  name: z.union([QualifiedNameSchema, z.string()]),
  definition: z.string().optional(),
  scope: RosettaScopeSchema.optional(),
  version: z.string().optional(),
  imports: z.array(ImportSchema),
  configurations: z.array(RosettaQualifiableConfigurationSchema),
  elements: z.array(z.lazy(() => RosettaRootElementSchema))
});

export const RosettaNumberLiteralSchema = z.looseObject({
  $type: z.literal('RosettaNumberLiteral'),
  value: BigDecimalSchema
});

export const RosettaOnlyElementSchema = z.looseObject({
  $type: z.literal('RosettaOnlyElement'),
  argument: z.lazy(() => RosettaExpressionSchema).optional(),
  operator: z.literal('only-element')
});

export const RosettaOnlyExistsExpressionSchema = z.looseObject({
  $type: z.literal('RosettaOnlyExistsExpression'),
  argument: z.lazy(() => RosettaExpressionSchema).optional(),
  operator: z.literal('exists').optional(),
  args: z.array(z.lazy(() => RosettaExpressionSchema))
});

export const RosettaRecordFeatureSchema = z.looseObject({
  $type: z.literal('RosettaRecordFeature'),
  name: ValidIDSchema,
  typeCall: TypeCallSchema
});

export const RosettaRecordTypeSchema = z.looseObject({
  $type: z.literal('RosettaRecordType'),
  name: ValidIDSchema,
  definition: z.string().optional(),
  features: z.array(RosettaRecordFeatureSchema)
});

export const RosettaReportSchema = z.looseObject({
  $type: z.literal('RosettaReport'),
  regulatoryBody: RegulatoryDocumentReferenceSchema,
  inputType: TypeCallSchema,
  eligibilityRules: z.array(ReferenceSchema).min(1),
  reportingStandard: ReferenceSchema.optional(),
  reportType: ReferenceSchema,
  ruleSource: ReferenceSchema.optional()
});

export const RosettaRuleSchema = z.looseObject({
  $type: z.literal('RosettaRule'),
  name: ValidIDSchema,
  eligibility: z.boolean().optional(),
  input: TypeCallSchema.optional(),
  definition: z.string().optional(),
  references: z.array(RosettaDocReferenceSchema),
  expression: z.lazy(() => RosettaExpressionSchema),
  identifier: z.string().optional()
});

export const RosettaSegmentSchema = z.looseObject({
  $type: z.literal('RosettaSegment'),
  name: z.union([
    ValidIDSchema,
    z.literal('rationale'),
    z.literal('rationale_author'),
    z.literal('structured_provision')
  ])
});

export const RosettaStringLiteralSchema = z.looseObject({
  $type: z.literal('RosettaStringLiteral'),
  value: z.string()
});

export const RosettaSynonymSourceSchema = z.looseObject({
  $type: z.literal('RosettaSynonymSource'),
  name: ValidIDSchema,
  superSources: z.array(ReferenceSchema),
  externalClasses: z.array(RosettaExternalClassSchema),
  externalEnums: z.array(RosettaExternalEnumSchema)
});

export const RosettaTypeAliasSchema = z.looseObject({
  $type: z.literal('RosettaTypeAlias'),
  name: ValidIDSchema,
  definition: z.string().optional(),
  typeCall: TypeCallSchema
});

export const SchemaSchema = z.looseObject({
  $type: z.literal('Schema'),
  name: ValidIDSchema,
  format: ReferenceSchema,
  annotations: z.array(AnnotationRefSchema)
});

export const ShortcutDeclarationSchema = z.looseObject({
  $type: z.literal('ShortcutDeclaration'),
  name: ValidIDSchema,
  definition: z.string().optional(),
  expression: z.lazy(() => RosettaExpressionSchema)
});

export const SortOperationSchema = z.looseObject({
  $type: z.literal('SortOperation'),
  argument: z.lazy(() => RosettaExpressionSchema).optional(),
  operator: z.literal('sort'),
  function: InlineFunctionSchema.optional()
});

export const SumOperationSchema = z.looseObject({
  $type: z.literal('SumOperation'),
  argument: z.lazy(() => RosettaExpressionSchema).optional(),
  operator: z.literal('sum')
});

export const SwitchCaseGuardSchema = z
  .looseObject({
    $type: z.literal('SwitchCaseGuard'),
    literalGuard: z.lazy(() => RosettaLiteralSchema).optional(),
    referenceGuard: ReferenceSchema.optional()
  })
  .superRefine((val, ctx) => {
    if (!(val['literalGuard'] !== undefined || val['referenceGuard'] !== undefined)) {
      ctx.addIssue({ code: 'custom', message: 'At least one of literalGuard, referenceGuard must be present' });
    }
  });

export const SwitchCaseOrDefaultSchema = z.looseObject({
  $type: z.literal('SwitchCaseOrDefault'),
  expression: z.lazy(() => RosettaExpressionSchema),
  guard: SwitchCaseGuardSchema.optional()
});

export const SwitchOperationSchema = z.looseObject({
  $type: z.literal('SwitchOperation'),
  argument: z.lazy(() => RosettaExpressionSchema).optional(),
  operator: z.literal('switch'),
  cases: z.array(SwitchCaseOrDefaultSchema)
});

export const ThenOperationSchema = z.looseObject({
  $type: z.literal('ThenOperation'),
  argument: z.lazy(() => RosettaExpressionSchema),
  operator: z.literal('then'),
  function: InlineFunctionSchema.optional()
});

export const ToDateOperationSchema = z.looseObject({
  $type: z.literal('ToDateOperation'),
  argument: z.lazy(() => RosettaExpressionSchema).optional(),
  operator: z.literal('to-date')
});

export const ToDateTimeOperationSchema = z.looseObject({
  $type: z.literal('ToDateTimeOperation'),
  argument: z.lazy(() => RosettaExpressionSchema).optional(),
  operator: z.literal('to-date-time')
});

export const ToEnumOperationSchema = z.looseObject({
  $type: z.literal('ToEnumOperation'),
  argument: z.lazy(() => RosettaExpressionSchema).optional(),
  operator: z.literal('to-enum'),
  enumeration: ReferenceSchema
});

export const ToIntOperationSchema = z.looseObject({
  $type: z.literal('ToIntOperation'),
  argument: z.lazy(() => RosettaExpressionSchema).optional(),
  operator: z.literal('to-int')
});

export const ToNumberOperationSchema = z.looseObject({
  $type: z.literal('ToNumberOperation'),
  argument: z.lazy(() => RosettaExpressionSchema).optional(),
  operator: z.literal('to-number')
});

export const ToStringOperationSchema = z.looseObject({
  $type: z.literal('ToStringOperation'),
  argument: z.lazy(() => RosettaExpressionSchema).optional(),
  operator: z.literal('to-string')
});

export const ToTimeOperationSchema = z.looseObject({
  $type: z.literal('ToTimeOperation'),
  argument: z.lazy(() => RosettaExpressionSchema).optional(),
  operator: z.literal('to-time')
});

export const ToZonedDateTimeOperationSchema = z.looseObject({
  $type: z.literal('ToZonedDateTimeOperation'),
  argument: z.lazy(() => RosettaExpressionSchema).optional(),
  operator: z.literal('to-zoned-date-time')
});

export const WithMetaEntrySchema = z.looseObject({
  $type: z.literal('WithMetaEntry'),
  key: ReferenceSchema,
  value: z.lazy(() => RosettaExpressionSchema)
});

export const WithMetaOperationSchema = z.looseObject({
  $type: z.literal('WithMetaOperation'),
  argument: z.lazy(() => RosettaExpressionSchema),
  operator: z.literal('with-meta'),
  entries: z.array(WithMetaEntrySchema)
});

export const AnnotationPathExpressionSchema = z.discriminatedUnion('$type', [
  RosettaImplicitVariableSchema,
  AnnotationPathSchema,
  AnnotationDeepPathSchema,
  AnnotationPathAttributeReferenceSchema
]);

export const AssignPathRootSchema = z.discriminatedUnion('$type', [AttributeSchema, ShortcutDeclarationSchema]);

export const AttributeOrChoiceOptionSchema = z.discriminatedUnion('$type', [AttributeSchema, ChoiceOptionSchema]);

export const DataOrChoiceSchema = z.discriminatedUnion('$type', [DataSchema, ChoiceSchema]);

export const RosettaCallableWithArgsSchema = z.discriminatedUnion('$type', [
  RosettaFunctionSchema,
  RosettaExternalFunctionSchema,
  RosettaRuleSchema
]);

export const RosettaExpressionSchema = z.discriminatedUnion('$type', [
  RosettaSymbolReferenceSchema,
  AsKeyOperationSchema,
  ThenOperationSchema,
  LogicalOperationSchema,
  ComparisonOperationSchema,
  EqualityOperationSchema,
  ArithmeticOperationSchema,
  RosettaContainsExpressionSchema,
  RosettaDisjointExpressionSchema,
  DefaultOperationSchema,
  JoinOperationSchema,
  RosettaFeatureCallSchema,
  RosettaDeepFeatureCallSchema,
  RosettaExistsExpressionSchema,
  RosettaAbsentExpressionSchema,
  RosettaOnlyElementSchema,
  RosettaOnlyExistsExpressionSchema,
  RosettaCountOperationSchema,
  FlattenOperationSchema,
  DistinctOperationSchema,
  ReverseOperationSchema,
  FirstOperationSchema,
  LastOperationSchema,
  SumOperationSchema,
  OneOfOperationSchema,
  ToStringOperationSchema,
  ToNumberOperationSchema,
  ToIntOperationSchema,
  ToTimeOperationSchema,
  ToEnumOperationSchema,
  AsOperationSchema,
  ToDateOperationSchema,
  ToDateTimeOperationSchema,
  ToZonedDateTimeOperationSchema,
  ChoiceOperationSchema,
  SwitchOperationSchema,
  WithMetaOperationSchema,
  SortOperationSchema,
  MinOperationSchema,
  MaxOperationSchema,
  ReduceOperationSchema,
  FilterOperationSchema,
  MapOperationSchema,
  RosettaSuperCallSchema,
  RosettaConstructorExpressionSchema,
  ListLiteralSchema,
  RosettaImplicitVariableSchema,
  RosettaBooleanLiteralSchema,
  RosettaStringLiteralSchema,
  RosettaNumberLiteralSchema,
  RosettaIntLiteralSchema,
  RosettaConditionalExpressionSchema
]);

export const RosettaFeatureSchema = z.discriminatedUnion('$type', [
  AttributeSchema,
  RosettaRecordFeatureSchema,
  RosettaEnumValueSchema,
  RosettaMetaTypeSchema,
  ChoiceOptionSchema
]);

export const RosettaLiteralSchema = z.discriminatedUnion('$type', [
  RosettaBooleanLiteralSchema,
  RosettaStringLiteralSchema,
  RosettaNumberLiteralSchema,
  RosettaIntLiteralSchema
]);

export const RosettaMapTestSchema = z.discriminatedUnion('$type', [
  RosettaMapPathSchema,
  RosettaMapRosettaPathSchema,
  RosettaEnumValueReferenceSchema,
  RosettaBooleanLiteralSchema,
  RosettaStringLiteralSchema,
  RosettaNumberLiteralSchema,
  RosettaIntLiteralSchema,
  RosettaMapTestExistsExpressionSchema,
  RosettaMapTestAbsentExpressionSchema,
  RosettaMapTestEqualityOperationSchema,
  RosettaMapPathValueSchema,
  RosettaMapTestFuncSchema
]);

export const RosettaMapTestExpressionSchema = z.discriminatedUnion('$type', [
  RosettaEnumValueReferenceSchema,
  RosettaBooleanLiteralSchema,
  RosettaStringLiteralSchema,
  RosettaNumberLiteralSchema,
  RosettaIntLiteralSchema,
  RosettaMapTestExistsExpressionSchema,
  RosettaMapTestAbsentExpressionSchema,
  RosettaMapTestEqualityOperationSchema,
  RosettaMapPathValueSchema
]);

export const RosettaRootElementSchema = z.discriminatedUnion('$type', [
  SchemaSchema,
  AnnotationSchema,
  DataSchema,
  ChoiceSchema,
  RosettaEnumerationSchema,
  RosettaFunctionSchema,
  RosettaBasicTypeSchema,
  RosettaSynonymSourceSchema,
  RosettaRecordTypeSchema,
  RosettaExternalFunctionSchema,
  RosettaTypeAliasSchema,
  RosettaMetaTypeSchema,
  RosettaBodySchema,
  RosettaCorpusSchema,
  RosettaSegmentSchema,
  RosettaExternalRuleSourceSchema,
  RosettaReportSchema,
  RosettaRuleSchema
]);

export const RosettaSymbolSchema = z.discriminatedUnion('$type', [
  AttributeSchema,
  ShortcutDeclarationSchema,
  RosettaFunctionSchema,
  RosettaExternalFunctionSchema,
  RosettaRuleSchema,
  TypeParameterSchema,
  RosettaMetaTypeSchema,
  ClosureParameterSchema,
  RosettaEnumerationSchema,
  RosettaEnumValueSchema,
  RosettaParameterSchema,
  DataSchema,
  ChoiceSchema,
  ChoiceOptionSchema,
  RosettaRecordTypeSchema,
  RosettaBasicTypeSchema
]);

export const RosettaTypeSchema = z.discriminatedUnion('$type', [
  DataSchema,
  ChoiceSchema,
  RosettaBasicTypeSchema,
  RosettaRecordTypeSchema,
  RosettaEnumerationSchema,
  RosettaTypeAliasSchema
]);

export const RosettaTypedFeatureSchema = z.discriminatedUnion('$type', [
  AttributeSchema,
  RosettaRecordFeatureSchema,
  RosettaMetaTypeSchema
]);

export const SwitchCaseTargetSchema = z.discriminatedUnion('$type', [
  DataSchema,
  ChoiceSchema,
  RosettaBasicTypeSchema,
  RosettaRecordTypeSchema,
  RosettaEnumerationSchema,
  RosettaTypeAliasSchema,
  RosettaEnumValueSchema
]);

export const AstNodeSchema = z.discriminatedUnion('$type', [
  TypeCallArgumentSchema,
  TypeCallSchema,
  RosettaCardinalitySchema,
  RosettaSegmentRefSchema,
  RegulatoryDocumentReferenceSchema,
  DocumentRationaleSchema,
  RosettaDocReferenceSchema,
  RosettaAttributeReferenceSchema,
  AnnotationQualifierSchema,
  AnnotationRefSchema,
  RosettaMergeSynonymValueSchema,
  RosettaMappingPathTestsSchema,
  RosettaMappingInstanceSchema,
  RosettaMappingSchema,
  RosettaSynonymValueBaseSchema,
  RosettaSynonymBodySchema,
  RosettaSynonymSchema,
  LabelAnnotationSchema,
  RuleReferenceAnnotationSchema,
  AttributeSchema,
  AnnotationSchema,
  AnnotationDeepPathSchema,
  AnnotationPathSchema,
  AnnotationPathAttributeReferenceSchema,
  ArithmeticOperationSchema,
  AsKeyOperationSchema,
  AsOperationSchema,
  ChoiceOptionSchema,
  RosettaClassSynonymSchema,
  ChoiceSchema,
  ChoiceOperationSchema,
  ClosureParameterSchema,
  ComparisonOperationSchema,
  ConditionSchema,
  ConstructorKeyValuePairSchema,
  DataSchema,
  DefaultOperationSchema,
  DistinctOperationSchema,
  EqualityOperationSchema,
  InlineFunctionSchema,
  FilterOperationSchema,
  FirstOperationSchema,
  FlattenOperationSchema,
  ImportSchema,
  JoinOperationSchema,
  LastOperationSchema,
  ListLiteralSchema,
  LogicalOperationSchema,
  MapOperationSchema,
  MaxOperationSchema,
  MinOperationSchema,
  OneOfOperationSchema,
  SegmentSchema,
  OperationSchema,
  ReduceOperationSchema,
  ReverseOperationSchema,
  RosettaAbsentExpressionSchema,
  TypeParameterSchema,
  RosettaBasicTypeSchema,
  RosettaBodySchema,
  RosettaBooleanLiteralSchema,
  RosettaConditionalExpressionSchema,
  RosettaSuperCallSchema,
  RosettaSymbolReferenceSchema,
  RosettaConstructorExpressionSchema,
  RosettaContainsExpressionSchema,
  RosettaCorpusSchema,
  RosettaCountOperationSchema,
  RosettaDataReferenceSchema,
  RosettaDeepFeatureCallSchema,
  RosettaDisjointExpressionSchema,
  RosettaEnumSynonymSchema,
  RosettaEnumValueSchema,
  RosettaEnumerationSchema,
  RosettaEnumValueReferenceSchema,
  RosettaExistsExpressionSchema,
  RosettaExternalClassSynonymSchema,
  RosettaExternalSynonymSchema,
  RosettaExternalRegularAttributeSchema,
  RosettaExternalClassSchema,
  RosettaExternalEnumValueSchema,
  RosettaExternalEnumSchema,
  RosettaParameterSchema,
  RosettaExternalFunctionSchema,
  RosettaExternalRuleSourceSchema,
  RosettaFeatureCallSchema,
  RosettaFunctionSchema,
  RosettaImplicitVariableSchema,
  RosettaIntLiteralSchema,
  RosettaMapPathValueSchema,
  RosettaMapPathSchema,
  RosettaMapRosettaPathSchema,
  RosettaMapTestAbsentExpressionSchema,
  RosettaMapTestEqualityOperationSchema,
  RosettaMapTestExistsExpressionSchema,
  RosettaMapTestFuncSchema,
  RosettaMetaTypeSchema,
  RosettaScopeSchema,
  RosettaQualifiableConfigurationSchema,
  RosettaModelSchema,
  RosettaNumberLiteralSchema,
  RosettaOnlyElementSchema,
  RosettaOnlyExistsExpressionSchema,
  RosettaRecordFeatureSchema,
  RosettaRecordTypeSchema,
  RosettaReportSchema,
  RosettaRuleSchema,
  RosettaSegmentSchema,
  RosettaStringLiteralSchema,
  RosettaSynonymSourceSchema,
  RosettaTypeAliasSchema,
  SchemaSchema,
  ShortcutDeclarationSchema,
  SortOperationSchema,
  SumOperationSchema,
  SwitchCaseGuardSchema,
  SwitchCaseOrDefaultSchema,
  SwitchOperationSchema,
  ThenOperationSchema,
  ToDateOperationSchema,
  ToDateTimeOperationSchema,
  ToEnumOperationSchema,
  ToIntOperationSchema,
  ToNumberOperationSchema,
  ToStringOperationSchema,
  ToTimeOperationSchema,
  ToZonedDateTimeOperationSchema,
  WithMetaEntrySchema,
  WithMetaOperationSchema
]);

export interface TypeCallArgumentSchemaRefs {
  TypeParameter?: string[];
}

export function createTypeCallArgumentSchema(refs: TypeCallArgumentSchemaRefs = {}) {
  return TypeCallArgumentSchema.safeExtend({
    parameter: ReferenceSchema.extend({ $refText: zRef(() => refs.TypeParameter ?? []) })
  });
}

export interface TypeCallSchemaRefs {
  RosettaType?: string[];
}

export function createTypeCallSchema(refs: TypeCallSchemaRefs = {}) {
  return TypeCallSchema.safeExtend({
    type: ReferenceSchema.extend({ $refText: zRef(() => refs.RosettaType ?? []) })
  });
}

export interface RosettaSegmentRefSchemaRefs {
  RosettaSegment?: string[];
}

export function createRosettaSegmentRefSchema(refs: RosettaSegmentRefSchemaRefs = {}) {
  return RosettaSegmentRefSchema.safeExtend({
    segment: ReferenceSchema.extend({ $refText: zRef(() => refs.RosettaSegment ?? []) })
  });
}

export interface RegulatoryDocumentReferenceSchemaRefs {
  RosettaBody?: string[];
  RosettaCorpus?: string[];
}

export function createRegulatoryDocumentReferenceSchema(refs: RegulatoryDocumentReferenceSchemaRefs = {}) {
  return RegulatoryDocumentReferenceSchema.safeExtend({
    body: ReferenceSchema.extend({ $refText: zRef(() => refs.RosettaBody ?? []) }),
    corpusList: z.array(ReferenceSchema.extend({ $refText: zRef(() => refs.RosettaCorpus ?? []) })).min(1)
  });
}

export interface RosettaAttributeReferenceSchemaRefs {
  AttributeOrChoiceOption?: string[];
}

export function createRosettaAttributeReferenceSchema(refs: RosettaAttributeReferenceSchemaRefs = {}) {
  return RosettaAttributeReferenceSchema.safeExtend({
    attribute: ReferenceSchema.extend({ $refText: zRef(() => refs.AttributeOrChoiceOption ?? []) })
  });
}

export interface AnnotationRefSchemaRefs {
  Annotation?: string[];
  Attribute?: string[];
}

export function createAnnotationRefSchema(refs: AnnotationRefSchemaRefs = {}) {
  return AnnotationRefSchema.safeExtend({
    annotation: ReferenceSchema.extend({ $refText: zRef(() => refs.Annotation ?? []) }),
    attribute: ReferenceSchema.extend({ $refText: zRef(() => refs.Attribute ?? []) }).optional()
  });
}

export interface RosettaSynonymSchemaRefs {
  RosettaSynonymSource?: string[];
}

export function createRosettaSynonymSchema(refs: RosettaSynonymSchemaRefs = {}) {
  return RosettaSynonymSchema.safeExtend({
    sources: z.array(ReferenceSchema.extend({ $refText: zRef(() => refs.RosettaSynonymSource ?? []) })).min(1)
  });
}

export interface RuleReferenceAnnotationSchemaRefs {
  RosettaRule?: string[];
}

export function createRuleReferenceAnnotationSchema(refs: RuleReferenceAnnotationSchemaRefs = {}) {
  return RuleReferenceAnnotationSchema.safeExtend({
    reportingRule: ReferenceSchema.extend({ $refText: zRef(() => refs.RosettaRule ?? []) }).optional()
  });
}

export interface AnnotationDeepPathSchemaRefs {
  AttributeOrChoiceOption?: string[];
}

export function createAnnotationDeepPathSchema(refs: AnnotationDeepPathSchemaRefs = {}) {
  return AnnotationDeepPathSchema.safeExtend({
    attribute: ReferenceSchema.extend({ $refText: zRef(() => refs.AttributeOrChoiceOption ?? []) })
  });
}

export interface AnnotationPathSchemaRefs {
  AttributeOrChoiceOption?: string[];
}

export function createAnnotationPathSchema(refs: AnnotationPathSchemaRefs = {}) {
  return AnnotationPathSchema.safeExtend({
    attribute: ReferenceSchema.extend({ $refText: zRef(() => refs.AttributeOrChoiceOption ?? []) })
  });
}

export interface AnnotationPathAttributeReferenceSchemaRefs {
  AttributeOrChoiceOption?: string[];
}

export function createAnnotationPathAttributeReferenceSchema(refs: AnnotationPathAttributeReferenceSchemaRefs = {}) {
  return AnnotationPathAttributeReferenceSchema.safeExtend({
    attribute: ReferenceSchema.extend({ $refText: zRef(() => refs.AttributeOrChoiceOption ?? []) })
  });
}

export interface AsOperationSchemaRefs {
  RosettaType?: string[];
}

export function createAsOperationSchema(refs: AsOperationSchemaRefs = {}) {
  return AsOperationSchema.safeExtend({
    type: ReferenceSchema.extend({ $refText: zRef(() => refs.RosettaType ?? []) })
  });
}

export interface RosettaClassSynonymSchemaRefs {
  RosettaSynonymSource?: string[];
}

export function createRosettaClassSynonymSchema(refs: RosettaClassSynonymSchemaRefs = {}) {
  return RosettaClassSynonymSchema.safeExtend({
    sources: z.array(ReferenceSchema.extend({ $refText: zRef(() => refs.RosettaSynonymSource ?? []) })).min(1)
  });
}

export interface ChoiceOperationSchemaRefs {
  Attribute?: string[];
}

export function createChoiceOperationSchema(refs: ChoiceOperationSchemaRefs = {}) {
  return ChoiceOperationSchema.safeExtend({
    attributes: z.array(ReferenceSchema.extend({ $refText: zRef(() => refs.Attribute ?? []) }))
  });
}

export interface ConstructorKeyValuePairSchemaRefs {
  RosettaFeature?: string[];
}

export function createConstructorKeyValuePairSchema(refs: ConstructorKeyValuePairSchemaRefs = {}) {
  return ConstructorKeyValuePairSchema.safeExtend({
    key: ReferenceSchema.extend({ $refText: zRef(() => refs.RosettaFeature ?? []) })
  });
}

export interface DataSchemaRefs {
  DataOrChoice?: string[];
}

export function createDataSchema(refs: DataSchemaRefs = {}) {
  return DataSchema.safeExtend({
    superType: ReferenceSchema.extend({ $refText: zRef(() => refs.DataOrChoice ?? []) }).optional()
  });
}

export interface SegmentSchemaRefs {
  RosettaTypedFeature?: string[];
}

export function createSegmentSchema(refs: SegmentSchemaRefs = {}) {
  return SegmentSchema.safeExtend({
    feature: ReferenceSchema.extend({ $refText: zRef(() => refs.RosettaTypedFeature ?? []) })
  });
}

export interface OperationSchemaRefs {
  AssignPathRoot?: string[];
}

export function createOperationSchema(refs: OperationSchemaRefs = {}) {
  return OperationSchema.safeExtend({
    assignRoot: ReferenceSchema.extend({ $refText: zRef(() => refs.AssignPathRoot ?? []) })
  });
}

export interface RosettaSymbolReferenceSchemaRefs {
  RosettaSymbol?: string[];
}

export function createRosettaSymbolReferenceSchema(refs: RosettaSymbolReferenceSchemaRefs = {}) {
  return RosettaSymbolReferenceSchema.safeExtend({
    symbol: ReferenceSchema.extend({ $refText: zRef(() => refs.RosettaSymbol ?? []) })
  });
}

export interface RosettaCorpusSchemaRefs {
  RosettaBody?: string[];
}

export function createRosettaCorpusSchema(refs: RosettaCorpusSchemaRefs = {}) {
  return RosettaCorpusSchema.safeExtend({
    body: ReferenceSchema.extend({ $refText: zRef(() => refs.RosettaBody ?? []) }).optional()
  });
}

export interface RosettaDataReferenceSchemaRefs {
  DataOrChoice?: string[];
}

export function createRosettaDataReferenceSchema(refs: RosettaDataReferenceSchemaRefs = {}) {
  return RosettaDataReferenceSchema.safeExtend({
    data: ReferenceSchema.extend({ $refText: zRef(() => refs.DataOrChoice ?? []) })
  });
}

export interface RosettaDeepFeatureCallSchemaRefs {
  RosettaFeature?: string[];
}

export function createRosettaDeepFeatureCallSchema(refs: RosettaDeepFeatureCallSchemaRefs = {}) {
  return RosettaDeepFeatureCallSchema.safeExtend({
    feature: ReferenceSchema.extend({ $refText: zRef(() => refs.RosettaFeature ?? []) }).optional()
  });
}

export interface RosettaEnumSynonymSchemaRefs {
  RosettaSynonymSource?: string[];
}

export function createRosettaEnumSynonymSchema(refs: RosettaEnumSynonymSchemaRefs = {}) {
  return RosettaEnumSynonymSchema.safeExtend({
    sources: z.array(ReferenceSchema.extend({ $refText: zRef(() => refs.RosettaSynonymSource ?? []) })).min(1)
  });
}

export interface RosettaEnumerationSchemaRefs {
  RosettaEnumeration?: string[];
}

export function createRosettaEnumerationSchema(refs: RosettaEnumerationSchemaRefs = {}) {
  return RosettaEnumerationSchema.safeExtend({
    parent: ReferenceSchema.extend({ $refText: zRef(() => refs.RosettaEnumeration ?? []) }).optional()
  });
}

export interface RosettaEnumValueReferenceSchemaRefs {
  RosettaEnumeration?: string[];
  RosettaEnumValue?: string[];
}

export function createRosettaEnumValueReferenceSchema(refs: RosettaEnumValueReferenceSchemaRefs = {}) {
  return RosettaEnumValueReferenceSchema.safeExtend({
    enumeration: ReferenceSchema.extend({ $refText: zRef(() => refs.RosettaEnumeration ?? []) }),
    value: ReferenceSchema.extend({ $refText: zRef(() => refs.RosettaEnumValue ?? []) })
  });
}

export interface RosettaExternalRegularAttributeSchemaRefs {
  RosettaFeature?: string[];
}

export function createRosettaExternalRegularAttributeSchema(refs: RosettaExternalRegularAttributeSchemaRefs = {}) {
  return RosettaExternalRegularAttributeSchema.safeExtend({
    attributeRef: ReferenceSchema.extend({ $refText: zRef(() => refs.RosettaFeature ?? []) })
  });
}

export interface RosettaExternalClassSchemaRefs {
  DataOrChoice?: string[];
}

export function createRosettaExternalClassSchema(refs: RosettaExternalClassSchemaRefs = {}) {
  return RosettaExternalClassSchema.safeExtend({
    data: ReferenceSchema.extend({ $refText: zRef(() => refs.DataOrChoice ?? []) })
  });
}

export interface RosettaExternalEnumValueSchemaRefs {
  RosettaEnumValue?: string[];
}

export function createRosettaExternalEnumValueSchema(refs: RosettaExternalEnumValueSchemaRefs = {}) {
  return RosettaExternalEnumValueSchema.safeExtend({
    enumRef: ReferenceSchema.extend({ $refText: zRef(() => refs.RosettaEnumValue ?? []) })
  });
}

export interface RosettaExternalEnumSchemaRefs {
  RosettaEnumeration?: string[];
}

export function createRosettaExternalEnumSchema(refs: RosettaExternalEnumSchemaRefs = {}) {
  return RosettaExternalEnumSchema.safeExtend({
    enumeration: ReferenceSchema.extend({ $refText: zRef(() => refs.RosettaEnumeration ?? []) })
  });
}

export interface RosettaExternalRuleSourceSchemaRefs {
  RosettaExternalRuleSource?: string[];
}

export function createRosettaExternalRuleSourceSchema(refs: RosettaExternalRuleSourceSchemaRefs = {}) {
  return RosettaExternalRuleSourceSchema.safeExtend({
    superSources: z.array(ReferenceSchema.extend({ $refText: zRef(() => refs.RosettaExternalRuleSource ?? []) }))
  });
}

export interface RosettaFeatureCallSchemaRefs {
  RosettaFeature?: string[];
}

export function createRosettaFeatureCallSchema(refs: RosettaFeatureCallSchemaRefs = {}) {
  return RosettaFeatureCallSchema.safeExtend({
    feature: ReferenceSchema.extend({ $refText: zRef(() => refs.RosettaFeature ?? []) }).optional()
  });
}

export interface RosettaMapTestFuncSchemaRefs {
  RosettaCallableWithArgs?: string[];
}

export function createRosettaMapTestFuncSchema(refs: RosettaMapTestFuncSchemaRefs = {}) {
  return RosettaMapTestFuncSchema.safeExtend({
    func: ReferenceSchema.extend({ $refText: zRef(() => refs.RosettaCallableWithArgs ?? []) })
  });
}

export interface RosettaQualifiableConfigurationSchemaRefs {
  Data?: string[];
}

export function createRosettaQualifiableConfigurationSchema(refs: RosettaQualifiableConfigurationSchemaRefs = {}) {
  return RosettaQualifiableConfigurationSchema.safeExtend({
    rosettaClass: ReferenceSchema.extend({ $refText: zRef(() => refs.Data ?? []) })
  });
}

export interface RosettaReportSchemaRefs {
  RosettaRule?: string[];
  RosettaCorpus?: string[];
  Data?: string[];
  RosettaExternalRuleSource?: string[];
}

export function createRosettaReportSchema(refs: RosettaReportSchemaRefs = {}) {
  return RosettaReportSchema.safeExtend({
    eligibilityRules: z.array(ReferenceSchema.extend({ $refText: zRef(() => refs.RosettaRule ?? []) })).min(1),
    reportingStandard: ReferenceSchema.extend({ $refText: zRef(() => refs.RosettaCorpus ?? []) }).optional(),
    reportType: ReferenceSchema.extend({ $refText: zRef(() => refs.Data ?? []) }),
    ruleSource: ReferenceSchema.extend({ $refText: zRef(() => refs.RosettaExternalRuleSource ?? []) }).optional()
  });
}

export interface RosettaSynonymSourceSchemaRefs {
  RosettaSynonymSource?: string[];
}

export function createRosettaSynonymSourceSchema(refs: RosettaSynonymSourceSchemaRefs = {}) {
  return RosettaSynonymSourceSchema.safeExtend({
    superSources: z.array(ReferenceSchema.extend({ $refText: zRef(() => refs.RosettaSynonymSource ?? []) }))
  });
}

export interface SchemaSchemaRefs {
  RosettaEnumValue?: string[];
}

export function createSchemaSchema(refs: SchemaSchemaRefs = {}) {
  return SchemaSchema.safeExtend({
    format: ReferenceSchema.extend({ $refText: zRef(() => refs.RosettaEnumValue ?? []) })
  });
}

export interface SwitchCaseGuardSchemaRefs {
  SwitchCaseTarget?: string[];
}

export function createSwitchCaseGuardSchema(refs: SwitchCaseGuardSchemaRefs = {}) {
  return SwitchCaseGuardSchema.safeExtend({
    referenceGuard: ReferenceSchema.extend({ $refText: zRef(() => refs.SwitchCaseTarget ?? []) }).optional()
  });
}

export interface ToEnumOperationSchemaRefs {
  RosettaEnumeration?: string[];
}

export function createToEnumOperationSchema(refs: ToEnumOperationSchemaRefs = {}) {
  return ToEnumOperationSchema.safeExtend({
    enumeration: ReferenceSchema.extend({ $refText: zRef(() => refs.RosettaEnumeration ?? []) })
  });
}

export interface WithMetaEntrySchemaRefs {
  RosettaFeature?: string[];
}

export function createWithMetaEntrySchema(refs: WithMetaEntrySchemaRefs = {}) {
  return WithMetaEntrySchema.safeExtend({
    key: ReferenceSchema.extend({ $refText: zRef(() => refs.RosettaFeature ?? []) })
  });
}
