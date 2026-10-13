grammar RuneDsl

// ═══════════════════════════════════════════════════════════════════
// TERMINAL RULES
// ═══════════════════════════════════════════════════════════════════

terminal ID returns string: /\^?[a-zA-Z_][a-zA-Z_0-9]*/;
terminal INT returns number: /[0-9]+/;
terminal STRING returns string: /"(\\.|[^"\\])*"|'(\\.|[^'\\])*'/;
hidden terminal ML_COMMENT: /\/\*[\s\S]*?\*\//;
hidden terminal SL_COMMENT: /\/\/[^\n\r]*/;
hidden terminal WS: /\s+/;

// ═══════════════════════════════════════════════════════════════════
// TYPE UNIONS — Abstract cross-reference targets
// ═══════════════════════════════════════════════════════════════════

type RosettaType = Data | Choice | RosettaBasicType | RosettaRecordType
    | RosettaEnumeration | RosettaTypeAlias;

type RosettaSymbol = Attribute | ShortcutDeclaration
    | RosettaFunction | RosettaExternalFunction | RosettaRule
    | TypeParameter | RosettaMetaType | ClosureParameter
    | RosettaEnumeration | RosettaEnumValue | RosettaParameter
    | Data | Choice | ChoiceOption | RosettaRecordType | RosettaBasicType;

type RosettaCallableWithArgs = RosettaFunction
    | RosettaExternalFunction | RosettaRule;

type RosettaFeature = Attribute | RosettaRecordFeature
    | RosettaEnumValue | RosettaMetaType | ChoiceOption;

type RosettaTypedFeature = Attribute | RosettaRecordFeature | RosettaMetaType;

type AssignPathRoot = Attribute | ShortcutDeclaration;

type SwitchCaseTarget = RosettaType | RosettaEnumValue;

type DataOrChoice = Data | Choice;

type AttributeOrChoiceOption = Attribute | ChoiceOption;

// ═══════════════════════════════════════════════════════════════════
// ENTRY RULE
// ═══════════════════════════════════════════════════════════════════

entry RosettaModel:
    (overridden?='override')? 'namespace' name=(QualifiedName | STRING)
    (':' RosettaDefinable)? scope=RosettaScope?
    ('version' version=STRING)?
    imports+=Import*
    configurations+=RosettaQualifiableConfiguration*
    elements+=RosettaRootElement*
;

// ═══════════════════════════════════════════════════════════════════
// MODEL STRUCTURE RULES
// ═══════════════════════════════════════════════════════════════════

RosettaRootElement:
    Enumeration | RosettaBody | RosettaCorpus | RosettaSegment
    | RosettaBasicType | RosettaRecordType | RosettaLibraryFunction
    | RosettaSynonymSource | RosettaRule | RosettaMetaType
    | RosettaExternalRuleSource
    | RosettaReport | RosettaTypeAlias
    | Annotation | Data | Choice | RosettaFunction | Schema
;

Schema:
    'schema' RosettaNamed format=[RosettaEnumValue:ValidID] Annotations*
;

RosettaScope:
    'scope' name=ValidID RosettaDefinable?
;

Import:
    'import' importedNamespace=QualifiedNameWithWildcard ('as' namespaceAlias=ValidID)?
;

Annotation:
    'annotation' RosettaNamed ':' RosettaDefinable?
    ('[' 'prefix' prefix=ValidID ']')?
    attributes+=Attribute*
;

fragment Annotations:
    annotations+=AnnotationRef
;

fragment Synonyms:
    synonyms+=RosettaSynonym
;

fragment ClassSynonyms:
    synonyms+=RosettaClassSynonym
;

fragment References:
    references+=RosettaDocReference
;

fragment RuleReference:
    ruleReferences+=RuleReferenceAnnotation
;

AnnotationRef:
    '[' annotation=[Annotation:ValidID]
    (attribute=[Attribute:ValidID] (qualifiers+=AnnotationQualifier)*)?
    ']'
;

AnnotationQualifier:
    qualName=STRING '=' (qualValue=STRING | qualPath=RosettaAttributeReference)
;

Data:
    'type' RosettaNamed ('extends' superType=[DataOrChoice:QualifiedName])? ':'
    RosettaDefinable?
    (References | Annotations | ClassSynonyms)*
    attributes+=Attribute*
    conditions+=Condition*
;

Choice:
    'choice' RosettaNamed ':' RosettaDefinable?
    (Annotations | ClassSynonyms)*
    attributes+=ChoiceOption*
;

ChoiceOption:
    RosettaTyped RosettaDefinable?
    (References | Annotations | Synonyms | labels+=LabelAnnotation | RuleReference)*
;

Attribute:
    override?='override'?
    RosettaNamed typeCall=TypeCallSimple
    ('(' typeCallArgs+=TypeCallArgument (',' typeCallArgs+=TypeCallArgument)* ')')?
    card=RosettaCardinality RosettaDefinable?
    (References | Annotations | Synonyms | labels+=LabelAnnotation | RuleReference)*
;

Enumeration infers RosettaEnumeration:
    'enum' RosettaNamed ('extends' parent=[RosettaEnumeration:QualifiedName])? ':'
    RosettaDefinable?
    (References | Annotations | synonyms+=RosettaSynonym)*
    enumValues+=RosettaEnumValue*
;

RosettaFunction:
    'func' RosettaNamed
    ('(' dispatchAttribute=[Attribute:ValidID] ':' dispatchValue=EnumValueReference ')')?
    ('extends' superFunction=[RosettaFunction:QualifiedName])? ':'
    RosettaDefinable?
    (References | Annotations)*
    ('inputs' ':' inputs+=Attribute+)?
    ('output' ':' output=Attribute)?
    (shortcuts+=ShortcutDeclaration)*
    conditions+=Condition*
    operations+=Operation*
    postConditions+=PostCondition*
;

ShortcutDeclaration:
    'alias' RosettaNamed ':' RosettaDefinable? expression=Expression
;

Condition:
    'condition' RosettaNamed? ':'
    RosettaDefinable?
    (References | Annotations)*
    expression=Expression
;

PostCondition infers Condition:
    postCondition?='post-condition' RosettaNamed? ':'
    RosettaDefinable?
    expression=Expression
;

Operation:
    ('set' | add?='add') assignRoot=[AssignPathRoot:ValidID]
    (path=Segment)? ':'
    RosettaDefinable?
    expression=ExpressionWithAsKey
;

Segment:
    '->' feature=[RosettaTypedFeature:ValidID] (next=Segment)?
;

EnumValueReference infers RosettaEnumValueReference:
    enumeration=[RosettaEnumeration:QualifiedName] '->' value=[RosettaEnumValue:ValidID]
;

// ═══════════════════════════════════════════════════════════════════
// FRAGMENT RULES
// ═══════════════════════════════════════════════════════════════════

fragment RosettaDefinable:
    '<' definition=STRING '>'
;

fragment RosettaNamed:
    name=ValidID
;

fragment RosettaTyped:
    typeCall=TypeCall
;

// ═══════════════════════════════════════════════════════════════════
// TYPE SYSTEM RULES
// ═══════════════════════════════════════════════════════════════════

TypeCall:
    ^type=[RosettaType:QualifiedName]
    ('(' arguments+=TypeCallArgument (',' arguments+=TypeCallArgument)* ')')?
;

// Simple type reference without optional arguments.
TypeCallSimple infers TypeCall:
    ^type=[RosettaType:QualifiedName]
;

TypeCallArgument:
    parameter=[TypeParameter:TypeParameterValidID] ':' value=TypeCallArgumentExpression
;

TypeCallArgumentExpression infers RosettaExpression:
    TypeParameterReference | RosettaLiteralRule
;

TypeParameterReference infers RosettaSymbolReference:
    symbol=[RosettaSymbol:TypeParameterValidID]
;

RosettaBasicType:
    'basicType' RosettaNamed TypeParameters? RosettaDefinable?
;

fragment TypeParameters:
    '(' parameters+=TypeParameter (',' parameters+=TypeParameter)* ','? ')'
;

TypeParameter:
    name=TypeParameterValidID RosettaTyped RosettaDefinable?
;

RosettaSynonymSource:
    'synonym' 'source' RosettaNamed
    (
        ('extends' superSources+=[RosettaSynonymSource:QualifiedName]
            (',' superSources+=[RosettaSynonymSource:QualifiedName])*
        )?
        ExternalAnnotationSource
    )?
;

RosettaRecordType:
    'recordType' RosettaNamed '{' RosettaDefinable? features+=RosettaRecordFeature* '}'
;

RosettaRecordFeature:
    RosettaNamed RosettaTyped
;

RosettaParameter:
    RosettaNamed RosettaTyped (isArray?='[' ']')?
;

RosettaLibraryFunction infers RosettaExternalFunction:
    'library' 'function' RosettaNamed
    '(' (parameters+=RosettaParameter (',' parameters+=RosettaParameter)*)? ')'
    RosettaTyped RosettaDefinable?
;

RosettaTypeAlias:
    'typeAlias' RosettaNamed TypeParameters? ':' RosettaDefinable?
    RosettaTyped conditions+=Condition*
;

RosettaMetaType:
    'metaType' RosettaNamed RosettaTyped
;

RosettaEnumValue:
    RosettaNamed ('displayName' display=STRING)? RosettaDefinable?
    (References | Annotations | enumSynonyms+=RosettaEnumSynonym)*
;

RosettaCardinality:
    '(' (inf=INT '..' sup=INT | inf=INT '..' unbounded?='*') ')'
;

// ═══════════════════════════════════════════════════════════════════
// EXPRESSION RULES — Precedence Chain
// ═══════════════════════════════════════════════════════════════════

ExpressionWithAsKey infers RosettaExpression:
    Expression ({infer AsKeyOperation.argument=current} operator='as-key')?
;

Expression infers RosettaExpression:
    ThenOperationRule
;

ThenOperationRule infers RosettaExpression:
    OrOperation ({infer ThenOperation.argument=current} operator='then' function=ImplicitInlineFunction?)*
;

OrOperation infers RosettaExpression:
    AndOperation ({infer LogicalOperation.left=current} operator='or' right=AndOperation)*
;

AndOperation infers RosettaExpression:
    EqualityOperationRule ({infer LogicalOperation.left=current} operator='and' right=EqualityOperationRule)*
;

EqualityOperationRule infers RosettaExpression:
    AdditiveOperation (
        {infer ComparisonOperation.left=current}
        (
            cardMod=CardinalityModifier operator=('>=' | '<=' | '>' | '<')
            | operator=('>=' | '<=' | '>' | '<')
        )
        right=AdditiveOperation
        | {infer EqualityOperation.left=current}
        (
            cardMod=CardinalityModifier operator=('=' | '<>')
            | operator=('=' | '<>')
        )
        right=AdditiveOperation
    )*
;

AdditiveOperation infers RosettaExpression:
    MultiplicativeOperation (
        {infer ArithmeticOperation.left=current} operator=('+' | '-') right=MultiplicativeOperation
    )*
;

MultiplicativeOperation infers RosettaExpression:
    BinaryOperationRule (
        {infer ArithmeticOperation.left=current} operator=('*' | '/') right=BinaryOperationRule
    )*
;

BinaryOperationRule infers RosettaExpression:
    UnaryOperation (
        {infer RosettaContainsExpression.left=current} operator='contains' right=UnaryOperation
        | {infer RosettaDisjointExpression.left=current} operator='disjoint' right=UnaryOperation
        | {infer DefaultOperation.left=current} operator='default' right=UnaryOperation
        | {infer JoinOperation.left=current} operator='join' right=UnaryOperation?
    )?
;

UnaryOperation infers RosettaExpression:
    PrimaryExpression (
        (
            {infer RosettaFeatureCall.receiver=current} '->' feature=[RosettaFeature:ValidID]?
            | {infer RosettaDeepFeatureCall.receiver=current} '->>' feature=[RosettaFeature:ValidID]?
            | {infer RosettaExistsExpression.argument=current} modifier=ExistsModifier? operator='exists'
            | {infer RosettaAbsentExpression.argument=current} 'is' operator='absent'
            | {infer RosettaOnlyElement.argument=current} operator='only-element'
            | {infer RosettaOnlyExistsExpression.argument=current} 'only' operator='exists'
            | {infer RosettaCountOperation.argument=current} operator='count'
            | {infer FlattenOperation.argument=current} operator='flatten'
            | {infer DistinctOperation.argument=current} operator='distinct'
            | {infer ReverseOperation.argument=current} operator='reverse'
            | {infer FirstOperation.argument=current} operator='first'
            | {infer LastOperation.argument=current} operator='last'
            | {infer SumOperation.argument=current} operator='sum'
            | {infer OneOfOperation.argument=current} operator='one-of'
            | {infer ChoiceOperation.argument=current} necessity=Necessity operator='choice'
                attributes+=[Attribute:ValidID] (',' attributes+=[Attribute:ValidID])*
            | {infer ToStringOperation.argument=current} operator='to-string'
            | {infer ToNumberOperation.argument=current} operator='to-number'
            | {infer ToIntOperation.argument=current} operator='to-int'
            | {infer ToTimeOperation.argument=current} operator='to-time'
            | {infer ToEnumOperation.argument=current} operator='to-enum' enumeration=[RosettaEnumeration:QualifiedName]
            | {infer AsOperation.argument=current} operator='as' type=[RosettaType:QualifiedName]
            | {infer ToDateOperation.argument=current} operator='to-date'
            | {infer ToDateTimeOperation.argument=current} operator='to-date-time'
            | {infer ToZonedDateTimeOperation.argument=current} operator='to-zoned-date-time'
            | {infer SwitchOperation.argument=current} operator='switch'
                cases+=SwitchCaseOrDefault (',' cases+=SwitchCaseOrDefault)*
            | {infer WithMetaOperation.argument=current} operator='with-meta'
                ('{' (entries+=WithMetaEntry (',' entries+=WithMetaEntry)*)? '}')?
        )
        | (
            {infer SortOperation.argument=current} operator='sort'
            | {infer MinOperation.argument=current} operator='min'
            | {infer MaxOperation.argument=current} operator='max'
        ) function=InlineFunction?
        | (
            {infer ReduceOperation.argument=current} operator='reduce'
            | {infer FilterOperation.argument=current} operator='filter'
            | {infer MapOperation.argument=current} operator='extract'
        ) function=InlineFunction?
    )*
;

PrimaryExpression infers RosettaExpression:
    RosettaCalcConditionalExpression
    | RosettaLiteralRule
    | EmptyLiteral
    | ListLiteralRule
    | '(' Expression
        (
            ')' // regular parenthesized expression
            | {infer RosettaOnlyExistsExpression.args+=current}
              (',' args+=Expression)+ ')' 'only' 'exists'
              // multi-arg only-exists: (a, b, c) only exists
        )
    | QualifiedNamePrimary
    // "Without argument" unary operations — these appear at the start of
    // an expression (e.g., inside ImplicitInlineFunction bodies after 'then').
    // The argument is null; a post-parse derived state service fills in 'item'.
    | {infer RosettaExistsExpression} modifier=ExistsModifier? operator='exists'
    | {infer RosettaAbsentExpression} 'is' operator='absent'
    | {infer RosettaOnlyElement} operator='only-element'
    | {infer RosettaCountOperation} operator='count'
    | {infer FlattenOperation} operator='flatten'
    | {infer DistinctOperation} operator='distinct'
    | {infer ReverseOperation} operator='reverse'
    | {infer FirstOperation} operator='first'
    | {infer LastOperation} operator='last'
    | {infer SumOperation} operator='sum'
    | {infer OneOfOperation} operator='one-of'
    | {infer ToStringOperation} operator='to-string'
    | {infer ToNumberOperation} operator='to-number'
    | {infer ToIntOperation} operator='to-int'
    | {infer ToTimeOperation} operator='to-time'
    | {infer ToEnumOperation} operator='to-enum' enumeration=[RosettaEnumeration:QualifiedName]
    | {infer AsOperation} operator='as' type=[RosettaType:QualifiedName]
    | {infer ToDateOperation} operator='to-date'
    | {infer ToDateTimeOperation} operator='to-date-time'
    | {infer ToZonedDateTimeOperation} operator='to-zoned-date-time'
    // "Without argument" functional operations:
    | {infer SortOperation} operator='sort' function=InlineFunction?
    | {infer MinOperation} operator='min' function=InlineFunction?
    | {infer MaxOperation} operator='max' function=InlineFunction?
    | {infer ReduceOperation} operator='reduce' function=InlineFunction?
    | {infer FilterOperation} operator='filter' function=InlineFunction?
    | {infer MapOperation} operator='extract' function=InlineFunction?
    // "Without left" binary operations (e.g., 'then default False'):
    | {infer RosettaContainsExpression} operator='contains' right=UnaryOperation
    | {infer RosettaDisjointExpression} operator='disjoint' right=UnaryOperation
    | {infer DefaultOperation} operator='default' right=UnaryOperation
    | {infer JoinOperation} operator='join' right=UnaryOperation?
    // "Without left" equality/comparison (e.g., 'then all = True'):
    | {infer EqualityOperation} (cardMod=CardinalityModifier)? operator=('=' | '<>') right=AdditiveOperation
    | {infer ComparisonOperation} (cardMod=CardinalityModifier)? operator=('>=' | '<=' | '>' | '<') right=AdditiveOperation
    // Standalone choice operation (no left argument):
    // e.g., `optional choice dateAdjustments, dateAdjustmentsReference`
    | {infer ChoiceOperation} necessity=Necessity operator='choice'
        attributes+=[Attribute:ValidID] (',' attributes+=[Attribute:ValidID])*
    // Standalone switch operation (no left argument):
    // e.g., `(switch Type1 then expr, default empty)`
    | {infer SwitchOperation} operator='switch'
        cases+=SwitchCaseOrDefault (',' cases+=SwitchCaseOrDefault)*
;

// ═══════════════════════════════════════════════════════════════════
// QUALIFIED NAME PRIMARY — Merged: sym ref / func call / constructor
// Eliminates common-prefix ambiguity by parsing QualifiedName once,
// then deciding specialization based on the following token.
// ═══════════════════════════════════════════════════════════════════

QualifiedNamePrimary infers RosettaExpression:
    (
        {infer RosettaSuperCall} name='super'
        | {infer RosettaSymbolReference} symbol=[RosettaSymbol:QualifiedName]
    )
    (
        // Constructor expression: optional type args + { body }
        // Disambiguated from function call by: ( ID : → type args, ( ID <not :> → func call
        {infer RosettaConstructorExpression.typeRef=current}
        ('(' constructorTypeArgs+=TypeCallArgument (',' constructorTypeArgs+=TypeCallArgument)* ')')?
        '{'
        (
            values+=ConstructorKeyValuePair
            (',' (values+=ConstructorKeyValuePair | implicitEmpty?='...'))*
            (',' (implicitEmpty?='...')?)?
            | implicitEmpty?='...'
        )?
        '}'
        // Function call: ( args )
        | explicitArguments?='(' (rawArgs+=Expression (',' rawArgs+=Expression)*)? ')'
    )?
    | RosettaImplicitVariableRule
;

// ═══════════════════════════════════════════════════════════════════
// EXPRESSION HELPERS
// ═══════════════════════════════════════════════════════════════════

CardinalityModifier returns string:
    'any' | 'all'
;

ExistsModifier returns string:
    'single' | 'multiple'
;

Necessity returns string:
    'optional' | 'required'
;

SwitchCaseOrDefault:
    'default' expression=Expression
    | guard=SwitchCaseGuard 'then' expression=Expression
;

SwitchCaseGuard:
    literalGuard=RosettaLiteralRule | referenceGuard=[SwitchCaseTarget:QualifiedName]
;

WithMetaEntry:
    key=[RosettaFeature:ValidID] ':' value=Expression
;

ClosureParameter:
    name=ID
;

InlineFunction:
    (parameters+=ClosureParameter (',' parameters+=ClosureParameter)*)? '[' body=Expression ']'
;

// Bare-or-bracket function body for extract/filter/reduce.
// Bracket form: `[body]` or `param [body]`  — same as InlineFunction.
ImplicitInlineFunction infers InlineFunction:
    body=OrOperation
;

EmptyLiteral infers RosettaExpression:
    {infer ListLiteral} 'empty'
;

ListLiteralRule infers ListLiteral:
    {infer ListLiteral} '[' (elements+=Expression (',' elements+=Expression)*)? ']'
;

RosettaImplicitVariableRule infers RosettaImplicitVariable:
    name='item'
;

RosettaLiteralRule infers RosettaLiteral:
    RosettaBooleanLiteralRule | RosettaStringLiteralRule | RosettaNumberLiteralRule | RosettaIntLiteralRule
;

RosettaBooleanLiteralRule infers RosettaBooleanLiteral:
    value?='True' | {infer RosettaBooleanLiteral} 'False'
;

RosettaStringLiteralRule infers RosettaStringLiteral:
    value=STRING
;

RosettaNumberLiteralRule infers RosettaNumberLiteral:
    value=BigDecimal
;

RosettaIntLiteralRule infers RosettaIntLiteral:
    value=Integer
;

ConstructorKeyValuePair:
    key=[RosettaFeature:ValidID] ':' value=ExpressionWithAsKey
;

RosettaCalcConditionalExpression infers RosettaConditionalExpression:
    {infer RosettaConditionalExpression} 'if' if=OrOperation 'then' ifthen=OrOperation
    (full?='else' elsethen=OrOperation)?
;

// ═══════════════════════════════════════════════════════════════════
// SYNONYM RULES
// ═══════════════════════════════════════════════════════════════════

RosettaClassSynonym:
    '[' 'synonym' sources+=[RosettaSynonymSource:QualifiedName]
    (',' sources+=[RosettaSynonymSource:QualifiedName])*
    ('value' value=RosettaClassSynonymValue)?
    ('meta' metaValue=RosettaMetaSynonymValue)?
    ']'
;

RosettaClassSynonymValue infers RosettaSynonymValueBase:
    name=STRING (refType=RosettaSynonymRef value=INT)? ('path' path=STRING)?
;

RosettaSynonym:
    '[' 'synonym' sources+=[RosettaSynonymSource:QualifiedName]
    (',' sources+=[RosettaSynonymSource:QualifiedName])*
    body=RosettaSynonymBody
    ']'
;

RosettaSynonymBody:
    (
        'value' values+=RosettaSynonymValue (',' values+=RosettaSynonymValue)*
            (mappingLogic=RosettaMapping)?
            ('meta' metaValues+=STRING (',' metaValues+=STRING)*)?
        | 'hint' hints+=STRING (',' hints+=STRING)*
        | 'merge' merge=RosettaMergeSynonymValue
        | mappingLogic=RosettaMappingSetTo
        | 'meta' metaValues+=STRING (',' metaValues+=STRING)*
    )
    ('dateFormat' format=STRING)?
    ('pattern' patternMatch=STRING patternReplace=STRING)?
    (removeHtml?='removeHtml')?
    ('mapper' mapper=STRING)?
;

RosettaSynonymValue infers RosettaSynonymValueBase:
    name=STRING (refType=RosettaSynonymRef value=INT)? ('path' path=STRING)? ('maps' maps=INT)?
;

RosettaMetaSynonymValue infers RosettaSynonymValueBase:
    name=STRING (refType=RosettaSynonymRef value=INT)? ('path' path=STRING)? ('maps' maps=INT)?
;

RosettaMergeSynonymValue:
    name=STRING ('when' 'path' '<>' excludePath=STRING)?
;

RosettaEnumSynonym:
    '[' 'synonym' sources+=[RosettaSynonymSource:QualifiedName]
    (',' sources+=[RosettaSynonymSource:QualifiedName])*
    'value' synonymValue=STRING
    ('definition' definition=STRING)?
    ('pattern' patternMatch=STRING patternReplace=STRING)?
    (removeHtml?='removeHtml')?
    ']'
;

RosettaSynonymRef returns string:
    'tag' | 'componentID'
;

// ═══════════════════════════════════════════════════════════════════
// MAPPING RULES
// ═══════════════════════════════════════════════════════════════════

RosettaMapping:
    instances+=RosettaMappingInstance (',' instances+=RosettaMappingInstance)*
;

RosettaMappingInstance:
    ('set' 'when') when=RosettaMappingPathTests
    | (default?='default' 'to') set=RosettaMapPrimaryExpression
;

RosettaMappingSetTo infers RosettaMapping:
    instances+=RosettaMappingSetToInstance (',' instances+=RosettaMappingSetToInstance)*
;

RosettaMappingSetToInstance infers RosettaMappingInstance:
    ('set' 'to') set=RosettaMapPrimaryExpression ('when' when=RosettaMappingPathTests)?
;

RosettaMappingPathTests:
    tests+=RosettaMapTest ('and' tests+=RosettaMapTest)*
;

RosettaMapTest:
    RosettaMapPath | RosettaMapRosettaPath | RosettaMapTestExpressionRule | RosettaMapTestFunc
;

RosettaMapPath:
    'path' '=' path=RosettaMapPathValue
;

RosettaMapRosettaPath:
    'rosettaPath' '=' path=RosettaAttributeReference
;

interface RosettaDataReference {
    data: @DataOrChoice
}

interface RosettaAttributeReference {
    receiver: RosettaDataReference | RosettaAttributeReference
    attribute: @AttributeOrChoiceOption
}

RosettaDataReference returns RosettaDataReference:
    data=[DataOrChoice:QualifiedName]
;

RosettaAttributeReference returns RosettaAttributeReference:
    RosettaDataReference ({RosettaAttributeReference.receiver=current} '->' attribute=[AttributeOrChoiceOption:ValidID])+
;

RosettaMapTestExpressionRule infers RosettaMapTestExpression:
    RosettaMapPathValue (
        {infer RosettaMapTestExistsExpression.argument=current} 'exists'
        | {infer RosettaMapTestAbsentExpression.argument=current} 'is' 'absent'
        | {infer RosettaMapTestEqualityOperation.left=current} operator=('=' | '<>') right=RosettaMapPrimaryExpression
    )
;

RosettaMapPrimaryExpression infers RosettaMapTestExpression:
    EnumValueReference | RosettaLiteralRule
;

RosettaMapPathValue:
    path=STRING
;

RosettaMapTestFunc:
    'condition-func' func=[RosettaCallableWithArgs:QualifiedName]
    ('condition-path' predicatePath=RosettaMapPathValue)?
;

// ═══════════════════════════════════════════════════════════════════
// REFERENCE & DOCUMENTATION RULES
// ═══════════════════════════════════════════════════════════════════

RosettaDocReference:
    '[' name=('regulatoryReference' | 'docReference')
    ('for' path=AnnotationPathExpression)?
    docReference=RegulatoryDocumentReference
    (rationales+=DocumentRationale)*
    ('structured_provision' structuredProvision=STRING)?
    ('provision' provision=STRING)?
    (reportedField?='reportedField')?
    ']'
;

DocumentRationale:
    'rationale' rationale=STRING ('rationale_author' rationaleAuthor=STRING)?
    | 'rationale_author' rationaleAuthor=STRING ('rationale' rationale=STRING)?
;

RegulatoryDocumentReference:
    body=[RosettaBody:QualifiedName] corpusList+=[RosettaCorpus:QualifiedName]
    segments+=RosettaSegmentRef*
;

RosettaSegmentRef:
    segment=[RosettaSegment:QualifiedName] segmentRef=STRING
;

RosettaBody:
    'body' bodyType=ID RosettaNamed RosettaDefinable?
;

RosettaCorpus:
    'corpus' corpusType=ID
    (displayName=STRING)?
    (body=[RosettaBody:QualifiedName] name=ValidID | name=ValidID)
    RosettaDefinable?
;

RosettaSegment:
    'segment' name=(ValidID | 'rationale' | 'rationale_author' | 'structured_provision')
;

// ═══════════════════════════════════════════════════════════════════
// EXTERNAL SOURCE RULES
// ═══════════════════════════════════════════════════════════════════

fragment ExternalAnnotationSource:
    '{' (externalClasses+=RosettaExternalClass)*
    ('enums' (externalEnums+=RosettaExternalEnum)*)?
    '}'
;

RosettaExternalRuleSource:
    'rule' 'source' RosettaNamed
    ('extends' superSources+=[RosettaExternalRuleSource:QualifiedName]
        (',' superSources+=[RosettaExternalRuleSource:QualifiedName])*)?
    ExternalAnnotationSource
;

RosettaExternalClass:
    data=[DataOrChoice:QualifiedName] ':'
    (externalClassSynonyms+=RosettaExternalClassSynonym)*
    (regularAttributes+=RosettaExternalRegularAttribute)*
;

RosettaExternalEnum:
    enumeration=[RosettaEnumeration:QualifiedName] ':'
    (regularValues+=RosettaExternalEnumValue)*
;

ExternalValueOperator returns string:
    '+' | '-'
;

RosettaExternalRegularAttribute:
    operator=ExternalValueOperator attributeRef=[RosettaFeature:ValidID]
    externalSynonyms+=RosettaExternalSynonym*
    externalRuleReferences+=RuleReferenceAnnotation*
;

RosettaExternalEnumValue:
    operator=ExternalValueOperator enumRef=[RosettaEnumValue:ValidID]
    externalEnumSynonyms+=RosettaExternalEnumSynonym*
;

RosettaExternalClassSynonym:
    '[' ('value' value=RosettaClassSynonymValue)? 'meta' metaValue=RosettaMetaSynonymValue ']'
;

RosettaExternalSynonym:
    '[' body=RosettaSynonymBody ']'
;

RosettaExternalEnumSynonym infers RosettaEnumSynonym:
    '[' 'value' synonymValue=STRING
    ('definition' definition=STRING)?
    ('pattern' patternMatch=STRING patternReplace=STRING)?
    ']'
;

// ═══════════════════════════════════════════════════════════════════
// REPORT & RULE RULES
// ═══════════════════════════════════════════════════════════════════

RosettaReport:
    'report' regulatoryBody=RegulatoryDocumentReference
    'in' ('real-time' | 'T+1' | 'T+2' | 'T+3' | 'T+4' | 'T+5' | 'ASATP')
    'from' inputType=TypeCall
    'when' eligibilityRules+=[RosettaRule:QualifiedName]
        ('and' eligibilityRules+=[RosettaRule:QualifiedName])*
    ('using' 'standard' reportingStandard=[RosettaCorpus:QualifiedName])?
    'with' 'type' reportType=[Data:QualifiedName]
    ('with' 'source' ruleSource=[RosettaExternalRuleSource:QualifiedName])?
;

RosettaRule:
    ('reporting' | eligibility?='eligibility') 'rule' RosettaNamed
    ('from' input=TypeCall)? ':'
    RosettaDefinable?
    (References)*
    expression=Expression
    ('as' identifier=STRING)?
;

RuleReferenceAnnotation:
    '[' name='ruleReference'
    ('for' path=AnnotationPathExpression)?
    (reportingRule=[RosettaRule:QualifiedName] | empty?='empty')
    ']'
;

LabelAnnotation:
    '[' name='label'
    ('for' path=AnnotationPathExpression | path=AnnotationPathExpression? deprecatedAs?='as')?
    label=STRING
    ']'
;

// ═══════════════════════════════════════════════════════════════════
// ANNOTATION PATH RULES
// ═══════════════════════════════════════════════════════════════════

AnnotationPathExpression:
    NestedAnnotationPath
;

NestedAnnotationPath infers AnnotationPathExpression:
    PrimaryAnnotationPath (
        {infer AnnotationPath.receiver=current} operator='->' attribute=[AttributeOrChoiceOption:ValidID]
        | {infer AnnotationDeepPath.receiver=current} operator='->>' attribute=[AttributeOrChoiceOption:ValidID]
    )*
;

PrimaryAnnotationPath infers AnnotationPathExpression:
    {infer AnnotationPathAttributeReference} attribute=[AttributeOrChoiceOption:ValidID]
    | RosettaImplicitVariableRule
;

// ═══════════════════════════════════════════════════════════════════
// QUALIFIABLE CONFIGURATION
// ═══════════════════════════════════════════════════════════════════

RosettaQualifiableConfiguration:
    qType=RosettaQualifiableType 'root' rosettaClass=[Data:QualifiedName] ';'
;

RosettaQualifiableType returns string:
    'isEvent' | 'isProduct'
;

// ═══════════════════════════════════════════════════════════════════
// DATA TYPE & HELPER RULES
// ═══════════════════════════════════════════════════════════════════

BigDecimal returns string:
    ('+' | '-')? ('.' INT | INT '.' INT?) (('e' | 'E') ('+' | '-')? INT)?
;

Integer returns bigint:
    ('+' | '-')? INT
;

QualifiedName returns string:
    ValidID ('.' ValidID)*
;

QualifiedNameWithWildcard returns string:
    ValidID ('.' (ValidID | '*'))*
;

TypeParameterValidID returns string:
    ValidID | 'min' | 'max'
;

ValidID returns string:
    ID | 'condition' | 'source' | 'value' | 'version' | 'pattern' | 'scope' | 'definition' | 'standard'
;
