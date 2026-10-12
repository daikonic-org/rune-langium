// generated conformance file
import type { z } from 'zod';
import type * as AST from '../../../core/src/generated/ast.js';
import {
  AnnotationSchema,
  AnnotationDeepPathSchema,
  AnnotationPathSchema,
  AnnotationPathAttributeReferenceSchema,
  AnnotationQualifierSchema,
  AnnotationRefSchema,
  ArithmeticOperationSchema,
  AsKeyOperationSchema,
  AsOperationSchema,
  AttributeSchema,
  ChoiceSchema,
  ChoiceOperationSchema,
  ChoiceOptionSchema,
  ClosureParameterSchema,
  ComparisonOperationSchema,
  ConditionSchema,
  ConstructorKeyValuePairSchema,
  DataSchema,
  DefaultOperationSchema,
  DistinctOperationSchema,
  DocumentRationaleSchema,
  EqualityOperationSchema,
  FilterOperationSchema,
  FirstOperationSchema,
  FlattenOperationSchema,
  ImportSchema,
  InlineFunctionSchema,
  JoinOperationSchema,
  LabelAnnotationSchema,
  LastOperationSchema,
  ListLiteralSchema,
  LogicalOperationSchema,
  MapOperationSchema,
  MaxOperationSchema,
  MinOperationSchema,
  OneOfOperationSchema,
  OperationSchema,
  ReduceOperationSchema,
  RegulatoryDocumentReferenceSchema,
  ReverseOperationSchema,
  RosettaAbsentExpressionSchema,
  RosettaAttributeReferenceSchema,
  RosettaBasicTypeSchema,
  RosettaBodySchema,
  RosettaBooleanLiteralSchema,
  RosettaCardinalitySchema,
  RosettaClassSynonymSchema,
  RosettaConditionalExpressionSchema,
  RosettaConstructorExpressionSchema,
  RosettaContainsExpressionSchema,
  RosettaCorpusSchema,
  RosettaCountOperationSchema,
  RosettaDataReferenceSchema,
  RosettaDeepFeatureCallSchema,
  RosettaDisjointExpressionSchema,
  RosettaDocReferenceSchema,
  RosettaEnumerationSchema,
  RosettaEnumSynonymSchema,
  RosettaEnumValueSchema,
  RosettaEnumValueReferenceSchema,
  RosettaExistsExpressionSchema,
  RosettaExternalClassSchema,
  RosettaExternalClassSynonymSchema,
  RosettaExternalEnumSchema,
  RosettaExternalEnumValueSchema,
  RosettaExternalFunctionSchema,
  RosettaExternalRegularAttributeSchema,
  RosettaExternalRuleSourceSchema,
  RosettaExternalSynonymSchema,
  RosettaFeatureCallSchema,
  RosettaFunctionSchema,
  RosettaImplicitVariableSchema,
  RosettaIntLiteralSchema,
  RosettaMapPathSchema,
  RosettaMapPathValueSchema,
  RosettaMappingSchema,
  RosettaMappingInstanceSchema,
  RosettaMappingPathTestsSchema,
  RosettaMapRosettaPathSchema,
  RosettaMapTestAbsentExpressionSchema,
  RosettaMapTestEqualityOperationSchema,
  RosettaMapTestExistsExpressionSchema,
  RosettaMapTestFuncSchema,
  RosettaMergeSynonymValueSchema,
  RosettaMetaTypeSchema,
  RosettaModelSchema,
  RosettaNumberLiteralSchema,
  RosettaOnlyElementSchema,
  RosettaOnlyExistsExpressionSchema,
  RosettaParameterSchema,
  RosettaQualifiableConfigurationSchema,
  RosettaRecordFeatureSchema,
  RosettaRecordTypeSchema,
  RosettaReportSchema,
  RosettaRuleSchema,
  RosettaScopeSchema,
  RosettaSegmentSchema,
  RosettaSegmentRefSchema,
  RosettaStringLiteralSchema,
  RosettaSuperCallSchema,
  RosettaSymbolReferenceSchema,
  RosettaSynonymSchema,
  RosettaSynonymBodySchema,
  RosettaSynonymSourceSchema,
  RosettaSynonymValueBaseSchema,
  RosettaTypeAliasSchema,
  RuleReferenceAnnotationSchema,
  SchemaSchema,
  SegmentSchema,
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
  TypeCallSchema,
  TypeCallArgumentSchema,
  TypeParameterSchema,
  WithMetaEntrySchema,
  WithMetaOperationSchema
} from './zod-schemas.js';

type _Internals = '$container' | '$containerProperty' | '$containerIndex' | '$document' | '$cstNode';
type _Surface<T> = _Internals extends never ? T : Omit<T, _Internals>;

type _Fwd_Annotation = z.infer<typeof AnnotationSchema> extends _Surface<AST.Annotation> ? true : never;
type _Rev_Annotation = _Surface<AST.Annotation> extends z.infer<typeof AnnotationSchema> ? true : never;

type _Fwd_AnnotationDeepPath =
  z.infer<typeof AnnotationDeepPathSchema> extends _Surface<AST.AnnotationDeepPath> ? true : never;
type _Rev_AnnotationDeepPath =
  _Surface<AST.AnnotationDeepPath> extends z.infer<typeof AnnotationDeepPathSchema> ? true : never;

type _Fwd_AnnotationPath = z.infer<typeof AnnotationPathSchema> extends _Surface<AST.AnnotationPath> ? true : never;
type _Rev_AnnotationPath = _Surface<AST.AnnotationPath> extends z.infer<typeof AnnotationPathSchema> ? true : never;

type _Fwd_AnnotationPathAttributeReference =
  z.infer<typeof AnnotationPathAttributeReferenceSchema> extends _Surface<AST.AnnotationPathAttributeReference>
    ? true
    : never;
type _Rev_AnnotationPathAttributeReference =
  _Surface<AST.AnnotationPathAttributeReference> extends z.infer<typeof AnnotationPathAttributeReferenceSchema>
    ? true
    : never;

type _Fwd_AnnotationQualifier =
  z.infer<typeof AnnotationQualifierSchema> extends _Surface<AST.AnnotationQualifier> ? true : never;
type _Rev_AnnotationQualifier =
  _Surface<AST.AnnotationQualifier> extends z.infer<typeof AnnotationQualifierSchema> ? true : never;

type _Fwd_AnnotationRef = z.infer<typeof AnnotationRefSchema> extends _Surface<AST.AnnotationRef> ? true : never;
type _Rev_AnnotationRef = _Surface<AST.AnnotationRef> extends z.infer<typeof AnnotationRefSchema> ? true : never;

type _Fwd_ArithmeticOperation =
  z.infer<typeof ArithmeticOperationSchema> extends _Surface<AST.ArithmeticOperation> ? true : never;
type _Rev_ArithmeticOperation =
  _Surface<AST.ArithmeticOperation> extends z.infer<typeof ArithmeticOperationSchema> ? true : never;

type _Fwd_AsKeyOperation = z.infer<typeof AsKeyOperationSchema> extends _Surface<AST.AsKeyOperation> ? true : never;
type _Rev_AsKeyOperation = _Surface<AST.AsKeyOperation> extends z.infer<typeof AsKeyOperationSchema> ? true : never;

type _Fwd_AsOperation = z.infer<typeof AsOperationSchema> extends _Surface<AST.AsOperation> ? true : never;
type _Rev_AsOperation = _Surface<AST.AsOperation> extends z.infer<typeof AsOperationSchema> ? true : never;

type _Fwd_Attribute =
  z.infer<typeof AttributeSchema> extends Pick<
    _Surface<AST.Attribute>,
    | '$type'
    | 'name'
    | 'typeCall'
    | 'card'
    | 'definition'
    | 'annotations'
    | 'synonyms'
    | 'references'
    | 'labels'
    | 'ruleReferences'
    | 'override'
    | 'typeCallArgs'
  >
    ? true
    : never;
type _Rev_Attribute =
  Pick<
    _Surface<AST.Attribute>,
    | '$type'
    | 'name'
    | 'typeCall'
    | 'card'
    | 'definition'
    | 'annotations'
    | 'synonyms'
    | 'references'
    | 'labels'
    | 'ruleReferences'
    | 'override'
    | 'typeCallArgs'
  > extends z.infer<typeof AttributeSchema>
    ? true
    : never;

type _Fwd_Choice =
  z.infer<typeof ChoiceSchema> extends Pick<
    _Surface<AST.Choice>,
    '$type' | 'name' | 'attributes' | 'definition' | 'annotations' | 'synonyms'
  >
    ? true
    : never;
type _Rev_Choice =
  Pick<
    _Surface<AST.Choice>,
    '$type' | 'name' | 'attributes' | 'definition' | 'annotations' | 'synonyms'
  > extends z.infer<typeof ChoiceSchema>
    ? true
    : never;

type _Fwd_ChoiceOperation = z.infer<typeof ChoiceOperationSchema> extends _Surface<AST.ChoiceOperation> ? true : never;
type _Rev_ChoiceOperation = _Surface<AST.ChoiceOperation> extends z.infer<typeof ChoiceOperationSchema> ? true : never;

type _Fwd_ChoiceOption = z.infer<typeof ChoiceOptionSchema> extends _Surface<AST.ChoiceOption> ? true : never;
type _Rev_ChoiceOption = _Surface<AST.ChoiceOption> extends z.infer<typeof ChoiceOptionSchema> ? true : never;

type _Fwd_ClosureParameter =
  z.infer<typeof ClosureParameterSchema> extends _Surface<AST.ClosureParameter> ? true : never;
type _Rev_ClosureParameter =
  _Surface<AST.ClosureParameter> extends z.infer<typeof ClosureParameterSchema> ? true : never;

type _Fwd_ComparisonOperation =
  z.infer<typeof ComparisonOperationSchema> extends _Surface<AST.ComparisonOperation> ? true : never;
type _Rev_ComparisonOperation =
  _Surface<AST.ComparisonOperation> extends z.infer<typeof ComparisonOperationSchema> ? true : never;

type _Fwd_Condition = z.infer<typeof ConditionSchema> extends _Surface<AST.Condition> ? true : never;
type _Rev_Condition = _Surface<AST.Condition> extends z.infer<typeof ConditionSchema> ? true : never;

type _Fwd_ConstructorKeyValuePair =
  z.infer<typeof ConstructorKeyValuePairSchema> extends _Surface<AST.ConstructorKeyValuePair> ? true : never;
type _Rev_ConstructorKeyValuePair =
  _Surface<AST.ConstructorKeyValuePair> extends z.infer<typeof ConstructorKeyValuePairSchema> ? true : never;

type _Fwd_Data =
  z.infer<typeof DataSchema> extends Pick<
    _Surface<AST.Data>,
    '$type' | 'name' | 'superType' | 'attributes' | 'definition' | 'annotations' | 'synonyms' | 'references'
  >
    ? true
    : never;
type _Rev_Data =
  Pick<
    _Surface<AST.Data>,
    '$type' | 'name' | 'superType' | 'attributes' | 'definition' | 'annotations' | 'synonyms' | 'references'
  > extends z.infer<typeof DataSchema>
    ? true
    : never;

type _Fwd_DefaultOperation =
  z.infer<typeof DefaultOperationSchema> extends _Surface<AST.DefaultOperation> ? true : never;
type _Rev_DefaultOperation =
  _Surface<AST.DefaultOperation> extends z.infer<typeof DefaultOperationSchema> ? true : never;

type _Fwd_DistinctOperation =
  z.infer<typeof DistinctOperationSchema> extends _Surface<AST.DistinctOperation> ? true : never;
type _Rev_DistinctOperation =
  _Surface<AST.DistinctOperation> extends z.infer<typeof DistinctOperationSchema> ? true : never;

type _Fwd_DocumentRationale =
  z.infer<typeof DocumentRationaleSchema> extends _Surface<AST.DocumentRationale> ? true : never;
type _Rev_DocumentRationale =
  _Surface<AST.DocumentRationale> extends z.infer<typeof DocumentRationaleSchema> ? true : never;

type _Fwd_EqualityOperation =
  z.infer<typeof EqualityOperationSchema> extends _Surface<AST.EqualityOperation> ? true : never;
type _Rev_EqualityOperation =
  _Surface<AST.EqualityOperation> extends z.infer<typeof EqualityOperationSchema> ? true : never;

type _Fwd_FilterOperation = z.infer<typeof FilterOperationSchema> extends _Surface<AST.FilterOperation> ? true : never;
type _Rev_FilterOperation = _Surface<AST.FilterOperation> extends z.infer<typeof FilterOperationSchema> ? true : never;

type _Fwd_FirstOperation = z.infer<typeof FirstOperationSchema> extends _Surface<AST.FirstOperation> ? true : never;
type _Rev_FirstOperation = _Surface<AST.FirstOperation> extends z.infer<typeof FirstOperationSchema> ? true : never;

type _Fwd_FlattenOperation =
  z.infer<typeof FlattenOperationSchema> extends _Surface<AST.FlattenOperation> ? true : never;
type _Rev_FlattenOperation =
  _Surface<AST.FlattenOperation> extends z.infer<typeof FlattenOperationSchema> ? true : never;

type _Fwd_Import = z.infer<typeof ImportSchema> extends _Surface<AST.Import> ? true : never;
type _Rev_Import = _Surface<AST.Import> extends z.infer<typeof ImportSchema> ? true : never;

type _Fwd_InlineFunction = z.infer<typeof InlineFunctionSchema> extends _Surface<AST.InlineFunction> ? true : never;
type _Rev_InlineFunction = _Surface<AST.InlineFunction> extends z.infer<typeof InlineFunctionSchema> ? true : never;

type _Fwd_JoinOperation = z.infer<typeof JoinOperationSchema> extends _Surface<AST.JoinOperation> ? true : never;
type _Rev_JoinOperation = _Surface<AST.JoinOperation> extends z.infer<typeof JoinOperationSchema> ? true : never;

type _Fwd_LabelAnnotation = z.infer<typeof LabelAnnotationSchema> extends _Surface<AST.LabelAnnotation> ? true : never;
type _Rev_LabelAnnotation = _Surface<AST.LabelAnnotation> extends z.infer<typeof LabelAnnotationSchema> ? true : never;

type _Fwd_LastOperation = z.infer<typeof LastOperationSchema> extends _Surface<AST.LastOperation> ? true : never;
type _Rev_LastOperation = _Surface<AST.LastOperation> extends z.infer<typeof LastOperationSchema> ? true : never;

type _Fwd_ListLiteral = z.infer<typeof ListLiteralSchema> extends _Surface<AST.ListLiteral> ? true : never;
type _Rev_ListLiteral = _Surface<AST.ListLiteral> extends z.infer<typeof ListLiteralSchema> ? true : never;

type _Fwd_LogicalOperation =
  z.infer<typeof LogicalOperationSchema> extends _Surface<AST.LogicalOperation> ? true : never;
type _Rev_LogicalOperation =
  _Surface<AST.LogicalOperation> extends z.infer<typeof LogicalOperationSchema> ? true : never;

type _Fwd_MapOperation = z.infer<typeof MapOperationSchema> extends _Surface<AST.MapOperation> ? true : never;
type _Rev_MapOperation = _Surface<AST.MapOperation> extends z.infer<typeof MapOperationSchema> ? true : never;

type _Fwd_MaxOperation = z.infer<typeof MaxOperationSchema> extends _Surface<AST.MaxOperation> ? true : never;
type _Rev_MaxOperation = _Surface<AST.MaxOperation> extends z.infer<typeof MaxOperationSchema> ? true : never;

type _Fwd_MinOperation = z.infer<typeof MinOperationSchema> extends _Surface<AST.MinOperation> ? true : never;
type _Rev_MinOperation = _Surface<AST.MinOperation> extends z.infer<typeof MinOperationSchema> ? true : never;

type _Fwd_OneOfOperation = z.infer<typeof OneOfOperationSchema> extends _Surface<AST.OneOfOperation> ? true : never;
type _Rev_OneOfOperation = _Surface<AST.OneOfOperation> extends z.infer<typeof OneOfOperationSchema> ? true : never;

type _Fwd_Operation = z.infer<typeof OperationSchema> extends _Surface<AST.Operation> ? true : never;
type _Rev_Operation = _Surface<AST.Operation> extends z.infer<typeof OperationSchema> ? true : never;

type _Fwd_ReduceOperation = z.infer<typeof ReduceOperationSchema> extends _Surface<AST.ReduceOperation> ? true : never;
type _Rev_ReduceOperation = _Surface<AST.ReduceOperation> extends z.infer<typeof ReduceOperationSchema> ? true : never;

type _Fwd_RegulatoryDocumentReference =
  z.infer<typeof RegulatoryDocumentReferenceSchema> extends _Surface<AST.RegulatoryDocumentReference> ? true : never;
type _Rev_RegulatoryDocumentReference =
  _Surface<AST.RegulatoryDocumentReference> extends z.infer<typeof RegulatoryDocumentReferenceSchema> ? true : never;

type _Fwd_ReverseOperation =
  z.infer<typeof ReverseOperationSchema> extends _Surface<AST.ReverseOperation> ? true : never;
type _Rev_ReverseOperation =
  _Surface<AST.ReverseOperation> extends z.infer<typeof ReverseOperationSchema> ? true : never;

type _Fwd_RosettaAbsentExpression =
  z.infer<typeof RosettaAbsentExpressionSchema> extends _Surface<AST.RosettaAbsentExpression> ? true : never;
type _Rev_RosettaAbsentExpression =
  _Surface<AST.RosettaAbsentExpression> extends z.infer<typeof RosettaAbsentExpressionSchema> ? true : never;

type _Fwd_RosettaAttributeReference =
  z.infer<typeof RosettaAttributeReferenceSchema> extends _Surface<AST.RosettaAttributeReference> ? true : never;
type _Rev_RosettaAttributeReference =
  _Surface<AST.RosettaAttributeReference> extends z.infer<typeof RosettaAttributeReferenceSchema> ? true : never;

type _Fwd_RosettaBasicType =
  z.infer<typeof RosettaBasicTypeSchema> extends _Surface<AST.RosettaBasicType> ? true : never;
type _Rev_RosettaBasicType =
  _Surface<AST.RosettaBasicType> extends z.infer<typeof RosettaBasicTypeSchema> ? true : never;

type _Fwd_RosettaBody = z.infer<typeof RosettaBodySchema> extends _Surface<AST.RosettaBody> ? true : never;
type _Rev_RosettaBody = _Surface<AST.RosettaBody> extends z.infer<typeof RosettaBodySchema> ? true : never;

type _Fwd_RosettaBooleanLiteral =
  z.infer<typeof RosettaBooleanLiteralSchema> extends _Surface<AST.RosettaBooleanLiteral> ? true : never;
type _Rev_RosettaBooleanLiteral =
  _Surface<AST.RosettaBooleanLiteral> extends z.infer<typeof RosettaBooleanLiteralSchema> ? true : never;

type _Fwd_RosettaCardinality =
  z.infer<typeof RosettaCardinalitySchema> extends _Surface<AST.RosettaCardinality> ? true : never;
type _Rev_RosettaCardinality =
  _Surface<AST.RosettaCardinality> extends z.infer<typeof RosettaCardinalitySchema> ? true : never;

type _Fwd_RosettaClassSynonym =
  z.infer<typeof RosettaClassSynonymSchema> extends _Surface<AST.RosettaClassSynonym> ? true : never;
type _Rev_RosettaClassSynonym =
  _Surface<AST.RosettaClassSynonym> extends z.infer<typeof RosettaClassSynonymSchema> ? true : never;

type _Fwd_RosettaConditionalExpression =
  z.infer<typeof RosettaConditionalExpressionSchema> extends _Surface<AST.RosettaConditionalExpression> ? true : never;
type _Rev_RosettaConditionalExpression =
  _Surface<AST.RosettaConditionalExpression> extends z.infer<typeof RosettaConditionalExpressionSchema> ? true : never;

type _Fwd_RosettaConstructorExpression =
  z.infer<typeof RosettaConstructorExpressionSchema> extends _Surface<AST.RosettaConstructorExpression> ? true : never;
type _Rev_RosettaConstructorExpression =
  _Surface<AST.RosettaConstructorExpression> extends z.infer<typeof RosettaConstructorExpressionSchema> ? true : never;

type _Fwd_RosettaContainsExpression =
  z.infer<typeof RosettaContainsExpressionSchema> extends _Surface<AST.RosettaContainsExpression> ? true : never;
type _Rev_RosettaContainsExpression =
  _Surface<AST.RosettaContainsExpression> extends z.infer<typeof RosettaContainsExpressionSchema> ? true : never;

type _Fwd_RosettaCorpus = z.infer<typeof RosettaCorpusSchema> extends _Surface<AST.RosettaCorpus> ? true : never;
type _Rev_RosettaCorpus = _Surface<AST.RosettaCorpus> extends z.infer<typeof RosettaCorpusSchema> ? true : never;

type _Fwd_RosettaCountOperation =
  z.infer<typeof RosettaCountOperationSchema> extends _Surface<AST.RosettaCountOperation> ? true : never;
type _Rev_RosettaCountOperation =
  _Surface<AST.RosettaCountOperation> extends z.infer<typeof RosettaCountOperationSchema> ? true : never;

type _Fwd_RosettaDataReference =
  z.infer<typeof RosettaDataReferenceSchema> extends _Surface<AST.RosettaDataReference> ? true : never;
type _Rev_RosettaDataReference =
  _Surface<AST.RosettaDataReference> extends z.infer<typeof RosettaDataReferenceSchema> ? true : never;

type _Fwd_RosettaDeepFeatureCall =
  z.infer<typeof RosettaDeepFeatureCallSchema> extends _Surface<AST.RosettaDeepFeatureCall> ? true : never;
type _Rev_RosettaDeepFeatureCall =
  _Surface<AST.RosettaDeepFeatureCall> extends z.infer<typeof RosettaDeepFeatureCallSchema> ? true : never;

type _Fwd_RosettaDisjointExpression =
  z.infer<typeof RosettaDisjointExpressionSchema> extends _Surface<AST.RosettaDisjointExpression> ? true : never;
type _Rev_RosettaDisjointExpression =
  _Surface<AST.RosettaDisjointExpression> extends z.infer<typeof RosettaDisjointExpressionSchema> ? true : never;

type _Fwd_RosettaDocReference =
  z.infer<typeof RosettaDocReferenceSchema> extends _Surface<AST.RosettaDocReference> ? true : never;
type _Rev_RosettaDocReference =
  _Surface<AST.RosettaDocReference> extends z.infer<typeof RosettaDocReferenceSchema> ? true : never;

type _Fwd_RosettaEnumeration =
  z.infer<typeof RosettaEnumerationSchema> extends Pick<
    _Surface<AST.RosettaEnumeration>,
    '$type' | 'name' | 'parent' | 'enumValues' | 'definition' | 'annotations' | 'synonyms' | 'references'
  >
    ? true
    : never;
type _Rev_RosettaEnumeration =
  Pick<
    _Surface<AST.RosettaEnumeration>,
    '$type' | 'name' | 'parent' | 'enumValues' | 'definition' | 'annotations' | 'synonyms' | 'references'
  > extends z.infer<typeof RosettaEnumerationSchema>
    ? true
    : never;

type _Fwd_RosettaEnumSynonym =
  z.infer<typeof RosettaEnumSynonymSchema> extends _Surface<AST.RosettaEnumSynonym> ? true : never;
type _Rev_RosettaEnumSynonym =
  _Surface<AST.RosettaEnumSynonym> extends z.infer<typeof RosettaEnumSynonymSchema> ? true : never;

type _Fwd_RosettaEnumValue =
  z.infer<typeof RosettaEnumValueSchema> extends _Surface<AST.RosettaEnumValue> ? true : never;
type _Rev_RosettaEnumValue =
  _Surface<AST.RosettaEnumValue> extends z.infer<typeof RosettaEnumValueSchema> ? true : never;

type _Fwd_RosettaEnumValueReference =
  z.infer<typeof RosettaEnumValueReferenceSchema> extends _Surface<AST.RosettaEnumValueReference> ? true : never;
type _Rev_RosettaEnumValueReference =
  _Surface<AST.RosettaEnumValueReference> extends z.infer<typeof RosettaEnumValueReferenceSchema> ? true : never;

type _Fwd_RosettaExistsExpression =
  z.infer<typeof RosettaExistsExpressionSchema> extends _Surface<AST.RosettaExistsExpression> ? true : never;
type _Rev_RosettaExistsExpression =
  _Surface<AST.RosettaExistsExpression> extends z.infer<typeof RosettaExistsExpressionSchema> ? true : never;

type _Fwd_RosettaExternalClass =
  z.infer<typeof RosettaExternalClassSchema> extends _Surface<AST.RosettaExternalClass> ? true : never;
type _Rev_RosettaExternalClass =
  _Surface<AST.RosettaExternalClass> extends z.infer<typeof RosettaExternalClassSchema> ? true : never;

type _Fwd_RosettaExternalClassSynonym =
  z.infer<typeof RosettaExternalClassSynonymSchema> extends _Surface<AST.RosettaExternalClassSynonym> ? true : never;
type _Rev_RosettaExternalClassSynonym =
  _Surface<AST.RosettaExternalClassSynonym> extends z.infer<typeof RosettaExternalClassSynonymSchema> ? true : never;

type _Fwd_RosettaExternalEnum =
  z.infer<typeof RosettaExternalEnumSchema> extends _Surface<AST.RosettaExternalEnum> ? true : never;
type _Rev_RosettaExternalEnum =
  _Surface<AST.RosettaExternalEnum> extends z.infer<typeof RosettaExternalEnumSchema> ? true : never;

type _Fwd_RosettaExternalEnumValue =
  z.infer<typeof RosettaExternalEnumValueSchema> extends _Surface<AST.RosettaExternalEnumValue> ? true : never;
type _Rev_RosettaExternalEnumValue =
  _Surface<AST.RosettaExternalEnumValue> extends z.infer<typeof RosettaExternalEnumValueSchema> ? true : never;

type _Fwd_RosettaExternalFunction =
  z.infer<typeof RosettaExternalFunctionSchema> extends _Surface<AST.RosettaExternalFunction> ? true : never;
type _Rev_RosettaExternalFunction =
  _Surface<AST.RosettaExternalFunction> extends z.infer<typeof RosettaExternalFunctionSchema> ? true : never;

type _Fwd_RosettaExternalRegularAttribute =
  z.infer<typeof RosettaExternalRegularAttributeSchema> extends _Surface<AST.RosettaExternalRegularAttribute>
    ? true
    : never;
type _Rev_RosettaExternalRegularAttribute =
  _Surface<AST.RosettaExternalRegularAttribute> extends z.infer<typeof RosettaExternalRegularAttributeSchema>
    ? true
    : never;

type _Fwd_RosettaExternalRuleSource =
  z.infer<typeof RosettaExternalRuleSourceSchema> extends _Surface<AST.RosettaExternalRuleSource> ? true : never;
type _Rev_RosettaExternalRuleSource =
  _Surface<AST.RosettaExternalRuleSource> extends z.infer<typeof RosettaExternalRuleSourceSchema> ? true : never;

type _Fwd_RosettaExternalSynonym =
  z.infer<typeof RosettaExternalSynonymSchema> extends _Surface<AST.RosettaExternalSynonym> ? true : never;
type _Rev_RosettaExternalSynonym =
  _Surface<AST.RosettaExternalSynonym> extends z.infer<typeof RosettaExternalSynonymSchema> ? true : never;

type _Fwd_RosettaFeatureCall =
  z.infer<typeof RosettaFeatureCallSchema> extends _Surface<AST.RosettaFeatureCall> ? true : never;
type _Rev_RosettaFeatureCall =
  _Surface<AST.RosettaFeatureCall> extends z.infer<typeof RosettaFeatureCallSchema> ? true : never;

type _Fwd_RosettaFunction =
  z.infer<typeof RosettaFunctionSchema> extends Pick<
    _Surface<AST.RosettaFunction>,
    '$type' | 'name' | 'inputs' | 'output' | 'definition' | 'annotations' | 'references'
  >
    ? true
    : never;
type _Rev_RosettaFunction =
  Pick<
    _Surface<AST.RosettaFunction>,
    '$type' | 'name' | 'inputs' | 'output' | 'definition' | 'annotations' | 'references'
  > extends z.infer<typeof RosettaFunctionSchema>
    ? true
    : never;

type _Fwd_RosettaImplicitVariable =
  z.infer<typeof RosettaImplicitVariableSchema> extends _Surface<AST.RosettaImplicitVariable> ? true : never;
type _Rev_RosettaImplicitVariable =
  _Surface<AST.RosettaImplicitVariable> extends z.infer<typeof RosettaImplicitVariableSchema> ? true : never;

type _Fwd_RosettaIntLiteral =
  z.infer<typeof RosettaIntLiteralSchema> extends _Surface<AST.RosettaIntLiteral> ? true : never;
type _Rev_RosettaIntLiteral =
  _Surface<AST.RosettaIntLiteral> extends z.infer<typeof RosettaIntLiteralSchema> ? true : never;

type _Fwd_RosettaMapPath = z.infer<typeof RosettaMapPathSchema> extends _Surface<AST.RosettaMapPath> ? true : never;
type _Rev_RosettaMapPath = _Surface<AST.RosettaMapPath> extends z.infer<typeof RosettaMapPathSchema> ? true : never;

type _Fwd_RosettaMapPathValue =
  z.infer<typeof RosettaMapPathValueSchema> extends _Surface<AST.RosettaMapPathValue> ? true : never;
type _Rev_RosettaMapPathValue =
  _Surface<AST.RosettaMapPathValue> extends z.infer<typeof RosettaMapPathValueSchema> ? true : never;

type _Fwd_RosettaMapping = z.infer<typeof RosettaMappingSchema> extends _Surface<AST.RosettaMapping> ? true : never;
type _Rev_RosettaMapping = _Surface<AST.RosettaMapping> extends z.infer<typeof RosettaMappingSchema> ? true : never;

type _Fwd_RosettaMappingInstance =
  z.infer<typeof RosettaMappingInstanceSchema> extends _Surface<AST.RosettaMappingInstance> ? true : never;
type _Rev_RosettaMappingInstance =
  _Surface<AST.RosettaMappingInstance> extends z.infer<typeof RosettaMappingInstanceSchema> ? true : never;

type _Fwd_RosettaMappingPathTests =
  z.infer<typeof RosettaMappingPathTestsSchema> extends _Surface<AST.RosettaMappingPathTests> ? true : never;
type _Rev_RosettaMappingPathTests =
  _Surface<AST.RosettaMappingPathTests> extends z.infer<typeof RosettaMappingPathTestsSchema> ? true : never;

type _Fwd_RosettaMapRosettaPath =
  z.infer<typeof RosettaMapRosettaPathSchema> extends _Surface<AST.RosettaMapRosettaPath> ? true : never;
type _Rev_RosettaMapRosettaPath =
  _Surface<AST.RosettaMapRosettaPath> extends z.infer<typeof RosettaMapRosettaPathSchema> ? true : never;

type _Fwd_RosettaMapTestAbsentExpression =
  z.infer<typeof RosettaMapTestAbsentExpressionSchema> extends _Surface<AST.RosettaMapTestAbsentExpression>
    ? true
    : never;
type _Rev_RosettaMapTestAbsentExpression =
  _Surface<AST.RosettaMapTestAbsentExpression> extends z.infer<typeof RosettaMapTestAbsentExpressionSchema>
    ? true
    : never;

type _Fwd_RosettaMapTestEqualityOperation =
  z.infer<typeof RosettaMapTestEqualityOperationSchema> extends _Surface<AST.RosettaMapTestEqualityOperation>
    ? true
    : never;
type _Rev_RosettaMapTestEqualityOperation =
  _Surface<AST.RosettaMapTestEqualityOperation> extends z.infer<typeof RosettaMapTestEqualityOperationSchema>
    ? true
    : never;

type _Fwd_RosettaMapTestExistsExpression =
  z.infer<typeof RosettaMapTestExistsExpressionSchema> extends _Surface<AST.RosettaMapTestExistsExpression>
    ? true
    : never;
type _Rev_RosettaMapTestExistsExpression =
  _Surface<AST.RosettaMapTestExistsExpression> extends z.infer<typeof RosettaMapTestExistsExpressionSchema>
    ? true
    : never;

type _Fwd_RosettaMapTestFunc =
  z.infer<typeof RosettaMapTestFuncSchema> extends _Surface<AST.RosettaMapTestFunc> ? true : never;
type _Rev_RosettaMapTestFunc =
  _Surface<AST.RosettaMapTestFunc> extends z.infer<typeof RosettaMapTestFuncSchema> ? true : never;

type _Fwd_RosettaMergeSynonymValue =
  z.infer<typeof RosettaMergeSynonymValueSchema> extends _Surface<AST.RosettaMergeSynonymValue> ? true : never;
type _Rev_RosettaMergeSynonymValue =
  _Surface<AST.RosettaMergeSynonymValue> extends z.infer<typeof RosettaMergeSynonymValueSchema> ? true : never;

type _Fwd_RosettaMetaType = z.infer<typeof RosettaMetaTypeSchema> extends _Surface<AST.RosettaMetaType> ? true : never;
type _Rev_RosettaMetaType = _Surface<AST.RosettaMetaType> extends z.infer<typeof RosettaMetaTypeSchema> ? true : never;

type _Fwd_RosettaModel = z.infer<typeof RosettaModelSchema> extends _Surface<AST.RosettaModel> ? true : never;
type _Rev_RosettaModel = _Surface<AST.RosettaModel> extends z.infer<typeof RosettaModelSchema> ? true : never;

type _Fwd_RosettaNumberLiteral =
  z.infer<typeof RosettaNumberLiteralSchema> extends _Surface<AST.RosettaNumberLiteral> ? true : never;
type _Rev_RosettaNumberLiteral =
  _Surface<AST.RosettaNumberLiteral> extends z.infer<typeof RosettaNumberLiteralSchema> ? true : never;

type _Fwd_RosettaOnlyElement =
  z.infer<typeof RosettaOnlyElementSchema> extends _Surface<AST.RosettaOnlyElement> ? true : never;
type _Rev_RosettaOnlyElement =
  _Surface<AST.RosettaOnlyElement> extends z.infer<typeof RosettaOnlyElementSchema> ? true : never;

type _Fwd_RosettaOnlyExistsExpression =
  z.infer<typeof RosettaOnlyExistsExpressionSchema> extends _Surface<AST.RosettaOnlyExistsExpression> ? true : never;
type _Rev_RosettaOnlyExistsExpression =
  _Surface<AST.RosettaOnlyExistsExpression> extends z.infer<typeof RosettaOnlyExistsExpressionSchema> ? true : never;

type _Fwd_RosettaParameter =
  z.infer<typeof RosettaParameterSchema> extends _Surface<AST.RosettaParameter> ? true : never;
type _Rev_RosettaParameter =
  _Surface<AST.RosettaParameter> extends z.infer<typeof RosettaParameterSchema> ? true : never;

type _Fwd_RosettaQualifiableConfiguration =
  z.infer<typeof RosettaQualifiableConfigurationSchema> extends _Surface<AST.RosettaQualifiableConfiguration>
    ? true
    : never;
type _Rev_RosettaQualifiableConfiguration =
  _Surface<AST.RosettaQualifiableConfiguration> extends z.infer<typeof RosettaQualifiableConfigurationSchema>
    ? true
    : never;

type _Fwd_RosettaRecordFeature =
  z.infer<typeof RosettaRecordFeatureSchema> extends _Surface<AST.RosettaRecordFeature> ? true : never;
type _Rev_RosettaRecordFeature =
  _Surface<AST.RosettaRecordFeature> extends z.infer<typeof RosettaRecordFeatureSchema> ? true : never;

type _Fwd_RosettaRecordType =
  z.infer<typeof RosettaRecordTypeSchema> extends _Surface<AST.RosettaRecordType> ? true : never;
type _Rev_RosettaRecordType =
  _Surface<AST.RosettaRecordType> extends z.infer<typeof RosettaRecordTypeSchema> ? true : never;

type _Fwd_RosettaReport = z.infer<typeof RosettaReportSchema> extends _Surface<AST.RosettaReport> ? true : never;
type _Rev_RosettaReport = _Surface<AST.RosettaReport> extends z.infer<typeof RosettaReportSchema> ? true : never;

type _Fwd_RosettaRule = z.infer<typeof RosettaRuleSchema> extends _Surface<AST.RosettaRule> ? true : never;
type _Rev_RosettaRule = _Surface<AST.RosettaRule> extends z.infer<typeof RosettaRuleSchema> ? true : never;

type _Fwd_RosettaScope = z.infer<typeof RosettaScopeSchema> extends _Surface<AST.RosettaScope> ? true : never;
type _Rev_RosettaScope = _Surface<AST.RosettaScope> extends z.infer<typeof RosettaScopeSchema> ? true : never;

type _Fwd_RosettaSegment = z.infer<typeof RosettaSegmentSchema> extends _Surface<AST.RosettaSegment> ? true : never;
type _Rev_RosettaSegment = _Surface<AST.RosettaSegment> extends z.infer<typeof RosettaSegmentSchema> ? true : never;

type _Fwd_RosettaSegmentRef =
  z.infer<typeof RosettaSegmentRefSchema> extends _Surface<AST.RosettaSegmentRef> ? true : never;
type _Rev_RosettaSegmentRef =
  _Surface<AST.RosettaSegmentRef> extends z.infer<typeof RosettaSegmentRefSchema> ? true : never;

type _Fwd_RosettaStringLiteral =
  z.infer<typeof RosettaStringLiteralSchema> extends _Surface<AST.RosettaStringLiteral> ? true : never;
type _Rev_RosettaStringLiteral =
  _Surface<AST.RosettaStringLiteral> extends z.infer<typeof RosettaStringLiteralSchema> ? true : never;

type _Fwd_RosettaSuperCall =
  z.infer<typeof RosettaSuperCallSchema> extends _Surface<AST.RosettaSuperCall> ? true : never;
type _Rev_RosettaSuperCall =
  _Surface<AST.RosettaSuperCall> extends z.infer<typeof RosettaSuperCallSchema> ? true : never;

type _Fwd_RosettaSymbolReference =
  z.infer<typeof RosettaSymbolReferenceSchema> extends _Surface<AST.RosettaSymbolReference> ? true : never;
type _Rev_RosettaSymbolReference =
  _Surface<AST.RosettaSymbolReference> extends z.infer<typeof RosettaSymbolReferenceSchema> ? true : never;

type _Fwd_RosettaSynonym = z.infer<typeof RosettaSynonymSchema> extends _Surface<AST.RosettaSynonym> ? true : never;
type _Rev_RosettaSynonym = _Surface<AST.RosettaSynonym> extends z.infer<typeof RosettaSynonymSchema> ? true : never;

type _Fwd_RosettaSynonymBody =
  z.infer<typeof RosettaSynonymBodySchema> extends _Surface<AST.RosettaSynonymBody> ? true : never;
type _Rev_RosettaSynonymBody =
  _Surface<AST.RosettaSynonymBody> extends z.infer<typeof RosettaSynonymBodySchema> ? true : never;

type _Fwd_RosettaSynonymSource =
  z.infer<typeof RosettaSynonymSourceSchema> extends _Surface<AST.RosettaSynonymSource> ? true : never;
type _Rev_RosettaSynonymSource =
  _Surface<AST.RosettaSynonymSource> extends z.infer<typeof RosettaSynonymSourceSchema> ? true : never;

type _Fwd_RosettaSynonymValueBase =
  z.infer<typeof RosettaSynonymValueBaseSchema> extends _Surface<AST.RosettaSynonymValueBase> ? true : never;
type _Rev_RosettaSynonymValueBase =
  _Surface<AST.RosettaSynonymValueBase> extends z.infer<typeof RosettaSynonymValueBaseSchema> ? true : never;

type _Fwd_RosettaTypeAlias =
  z.infer<typeof RosettaTypeAliasSchema> extends Pick<
    _Surface<AST.RosettaTypeAlias>,
    '$type' | 'name' | 'typeCall' | 'definition'
  >
    ? true
    : never;
type _Rev_RosettaTypeAlias =
  Pick<_Surface<AST.RosettaTypeAlias>, '$type' | 'name' | 'typeCall' | 'definition'> extends z.infer<
    typeof RosettaTypeAliasSchema
  >
    ? true
    : never;

type _Fwd_RuleReferenceAnnotation =
  z.infer<typeof RuleReferenceAnnotationSchema> extends _Surface<AST.RuleReferenceAnnotation> ? true : never;
type _Rev_RuleReferenceAnnotation =
  _Surface<AST.RuleReferenceAnnotation> extends z.infer<typeof RuleReferenceAnnotationSchema> ? true : never;

type _Fwd_Schema = z.infer<typeof SchemaSchema> extends _Surface<AST.Schema> ? true : never;
type _Rev_Schema = _Surface<AST.Schema> extends z.infer<typeof SchemaSchema> ? true : never;

type _Fwd_Segment = z.infer<typeof SegmentSchema> extends _Surface<AST.Segment> ? true : never;
type _Rev_Segment = _Surface<AST.Segment> extends z.infer<typeof SegmentSchema> ? true : never;

type _Fwd_ShortcutDeclaration =
  z.infer<typeof ShortcutDeclarationSchema> extends _Surface<AST.ShortcutDeclaration> ? true : never;
type _Rev_ShortcutDeclaration =
  _Surface<AST.ShortcutDeclaration> extends z.infer<typeof ShortcutDeclarationSchema> ? true : never;

type _Fwd_SortOperation = z.infer<typeof SortOperationSchema> extends _Surface<AST.SortOperation> ? true : never;
type _Rev_SortOperation = _Surface<AST.SortOperation> extends z.infer<typeof SortOperationSchema> ? true : never;

type _Fwd_SumOperation = z.infer<typeof SumOperationSchema> extends _Surface<AST.SumOperation> ? true : never;
type _Rev_SumOperation = _Surface<AST.SumOperation> extends z.infer<typeof SumOperationSchema> ? true : never;

type _Fwd_SwitchCaseGuard = z.infer<typeof SwitchCaseGuardSchema> extends _Surface<AST.SwitchCaseGuard> ? true : never;
type _Rev_SwitchCaseGuard = _Surface<AST.SwitchCaseGuard> extends z.infer<typeof SwitchCaseGuardSchema> ? true : never;

type _Fwd_SwitchCaseOrDefault =
  z.infer<typeof SwitchCaseOrDefaultSchema> extends _Surface<AST.SwitchCaseOrDefault> ? true : never;
type _Rev_SwitchCaseOrDefault =
  _Surface<AST.SwitchCaseOrDefault> extends z.infer<typeof SwitchCaseOrDefaultSchema> ? true : never;

type _Fwd_SwitchOperation = z.infer<typeof SwitchOperationSchema> extends _Surface<AST.SwitchOperation> ? true : never;
type _Rev_SwitchOperation = _Surface<AST.SwitchOperation> extends z.infer<typeof SwitchOperationSchema> ? true : never;

type _Fwd_ThenOperation = z.infer<typeof ThenOperationSchema> extends _Surface<AST.ThenOperation> ? true : never;
type _Rev_ThenOperation = _Surface<AST.ThenOperation> extends z.infer<typeof ThenOperationSchema> ? true : never;

type _Fwd_ToDateOperation = z.infer<typeof ToDateOperationSchema> extends _Surface<AST.ToDateOperation> ? true : never;
type _Rev_ToDateOperation = _Surface<AST.ToDateOperation> extends z.infer<typeof ToDateOperationSchema> ? true : never;

type _Fwd_ToDateTimeOperation =
  z.infer<typeof ToDateTimeOperationSchema> extends _Surface<AST.ToDateTimeOperation> ? true : never;
type _Rev_ToDateTimeOperation =
  _Surface<AST.ToDateTimeOperation> extends z.infer<typeof ToDateTimeOperationSchema> ? true : never;

type _Fwd_ToEnumOperation = z.infer<typeof ToEnumOperationSchema> extends _Surface<AST.ToEnumOperation> ? true : never;
type _Rev_ToEnumOperation = _Surface<AST.ToEnumOperation> extends z.infer<typeof ToEnumOperationSchema> ? true : never;

type _Fwd_ToIntOperation = z.infer<typeof ToIntOperationSchema> extends _Surface<AST.ToIntOperation> ? true : never;
type _Rev_ToIntOperation = _Surface<AST.ToIntOperation> extends z.infer<typeof ToIntOperationSchema> ? true : never;

type _Fwd_ToNumberOperation =
  z.infer<typeof ToNumberOperationSchema> extends _Surface<AST.ToNumberOperation> ? true : never;
type _Rev_ToNumberOperation =
  _Surface<AST.ToNumberOperation> extends z.infer<typeof ToNumberOperationSchema> ? true : never;

type _Fwd_ToStringOperation =
  z.infer<typeof ToStringOperationSchema> extends _Surface<AST.ToStringOperation> ? true : never;
type _Rev_ToStringOperation =
  _Surface<AST.ToStringOperation> extends z.infer<typeof ToStringOperationSchema> ? true : never;

type _Fwd_ToTimeOperation = z.infer<typeof ToTimeOperationSchema> extends _Surface<AST.ToTimeOperation> ? true : never;
type _Rev_ToTimeOperation = _Surface<AST.ToTimeOperation> extends z.infer<typeof ToTimeOperationSchema> ? true : never;

type _Fwd_ToZonedDateTimeOperation =
  z.infer<typeof ToZonedDateTimeOperationSchema> extends _Surface<AST.ToZonedDateTimeOperation> ? true : never;
type _Rev_ToZonedDateTimeOperation =
  _Surface<AST.ToZonedDateTimeOperation> extends z.infer<typeof ToZonedDateTimeOperationSchema> ? true : never;

type _Fwd_TypeCall = z.infer<typeof TypeCallSchema> extends _Surface<AST.TypeCall> ? true : never;
type _Rev_TypeCall = _Surface<AST.TypeCall> extends z.infer<typeof TypeCallSchema> ? true : never;

type _Fwd_TypeCallArgument =
  z.infer<typeof TypeCallArgumentSchema> extends _Surface<AST.TypeCallArgument> ? true : never;
type _Rev_TypeCallArgument =
  _Surface<AST.TypeCallArgument> extends z.infer<typeof TypeCallArgumentSchema> ? true : never;

type _Fwd_TypeParameter = z.infer<typeof TypeParameterSchema> extends _Surface<AST.TypeParameter> ? true : never;
type _Rev_TypeParameter = _Surface<AST.TypeParameter> extends z.infer<typeof TypeParameterSchema> ? true : never;

type _Fwd_WithMetaEntry = z.infer<typeof WithMetaEntrySchema> extends _Surface<AST.WithMetaEntry> ? true : never;
type _Rev_WithMetaEntry = _Surface<AST.WithMetaEntry> extends z.infer<typeof WithMetaEntrySchema> ? true : never;

type _Fwd_WithMetaOperation =
  z.infer<typeof WithMetaOperationSchema> extends _Surface<AST.WithMetaOperation> ? true : never;
type _Rev_WithMetaOperation =
  _Surface<AST.WithMetaOperation> extends z.infer<typeof WithMetaOperationSchema> ? true : never;
