# Types & Enums

## generated

### `Annotation`
```ts
ast.Annotation
```

### `AnnotationDeepPath`
```ts
ast.AnnotationDeepPath
```

### `AnnotationPath`
```ts
ast.AnnotationPath
```

### `AnnotationPathAttributeReference`
```ts
ast.AnnotationPathAttributeReference
```

### `AnnotationQualifier`
```ts
ast.AnnotationQualifier
```

### `AnnotationRef`
```ts
ast.AnnotationRef
```

### `AsOperation`
```ts
ast.AsOperation
```

### `Attribute`
```ts
ast.Attribute
```

### `Choice`
```ts
ast.Choice
```

### `ChoiceOption`
```ts
ast.ChoiceOption
```

### `Condition`
```ts
ast.Condition
```

### `ConstructorKeyValuePair`
```ts
ast.ConstructorKeyValuePair
```

### `Data`
```ts
ast.Data
```

### `FilterOperation`
```ts
ast.FilterOperation
```

### `InlineFunction`
```ts
ast.InlineFunction
```

### `MapOperation`
```ts
ast.MapOperation
```

### `MaxOperation`
```ts
ast.MaxOperation
```

### `MinOperation`
```ts
ast.MinOperation
```

### `Operation`
```ts
ast.Operation
```

### `ReduceOperation`
```ts
ast.ReduceOperation
```

### `RegulatoryDocumentReference`
```ts
ast.RegulatoryDocumentReference
```

### `RosettaAttributeReference`
```ts
ast.RosettaAttributeReference
```

### `RosettaBasicType`
```ts
ast.RosettaBasicType
```

### `RosettaClassSynonym`
```ts
ast.RosettaClassSynonym
```

### `RosettaConstructorExpression`
```ts
ast.RosettaConstructorExpression
```

### `RosettaCorpus`
```ts
ast.RosettaCorpus
```

### `RosettaDataReference`
```ts
ast.RosettaDataReference
```

### `RosettaDeepFeatureCall`
```ts
ast.RosettaDeepFeatureCall
```

### `RosettaDocReference`
```ts
ast.RosettaDocReference
```

### `RosettaEnumeration`
```ts
ast.RosettaEnumeration
```

### `RosettaEnumValue`
```ts
ast.RosettaEnumValue
```

### `RosettaEnumValueReference`
```ts
ast.RosettaEnumValueReference
```

### `RosettaExternalClass`
```ts
ast.RosettaExternalClass
```

### `RosettaExternalClassSynonym`
```ts
ast.RosettaExternalClassSynonym
```

### `RosettaExternalEnum`
```ts
ast.RosettaExternalEnum
```

### `RosettaExternalEnumValue`
```ts
ast.RosettaExternalEnumValue
```

### `RosettaExternalFunction`
```ts
ast.RosettaExternalFunction
```

### `RosettaExternalRegularAttribute`
```ts
ast.RosettaExternalRegularAttribute
```

### `RosettaExternalRuleSource`
```ts
ast.RosettaExternalRuleSource
```

### `RosettaExternalSynonym`
```ts
ast.RosettaExternalSynonym
```

### `RosettaFeatureCall`
```ts
ast.RosettaFeatureCall
```

### `RosettaFunction`
```ts
ast.RosettaFunction
```

### `RosettaMapPath`
```ts
ast.RosettaMapPath
```

### `RosettaMapping`
```ts
ast.RosettaMapping
```

### `RosettaMappingInstance`
```ts
ast.RosettaMappingInstance
```

### `RosettaMapRosettaPath`
```ts
ast.RosettaMapRosettaPath
```

### `RosettaMapTestAbsentExpression`
```ts
ast.RosettaMapTestAbsentExpression
```

### `RosettaMapTestEqualityOperation`
```ts
ast.RosettaMapTestEqualityOperation
```

### `RosettaMapTestExistsExpression`
```ts
ast.RosettaMapTestExistsExpression
```

### `RosettaMapTestFunc`
```ts
ast.RosettaMapTestFunc
```

### `RosettaMetaType`
```ts
ast.RosettaMetaType
```

### `RosettaModel`
```ts
ast.RosettaModel
```

### `RosettaParameter`
```ts
ast.RosettaParameter
```

### `RosettaRecordFeature`
```ts
ast.RosettaRecordFeature
```

### `RosettaRecordType`
```ts
ast.RosettaRecordType
```

### `RosettaReport`
```ts
ast.RosettaReport
```

### `RosettaRule`
```ts
ast.RosettaRule
```

### `RosettaSegmentRef`
```ts
ast.RosettaSegmentRef
```

### `RosettaSymbolReference`
```ts
ast.RosettaSymbolReference
```

### `RosettaSynonym`
```ts
ast.RosettaSynonym
```

### `RosettaSynonymBody`
```ts
ast.RosettaSynonymBody
```

### `RosettaSynonymSource`
```ts
ast.RosettaSynonymSource
```

### `RosettaTypeAlias`
```ts
ast.RosettaTypeAlias
```

### `RuleReferenceAnnotation`
```ts
ast.RuleReferenceAnnotation
```

### `Schema`
```ts
ast.Schema
```

### `Segment`
```ts
ast.Segment
```

### `SortOperation`
```ts
ast.SortOperation
```

### `SwitchCaseGuard`
```ts
ast.SwitchCaseGuard
```

### `SwitchCaseOrDefault`
```ts
ast.SwitchCaseOrDefault
```

### `SwitchOperation`
```ts
ast.SwitchOperation
```

### `ThenOperation`
```ts
ast.ThenOperation
```

### `ToEnumOperation`
```ts
ast.ToEnumOperation
```

### `TypeCall`
```ts
ast.TypeCall
```

### `TypeCallArgument`
```ts
ast.TypeCallArgument
```

### `TypeParameter`
```ts
ast.TypeParameter
```

### `WithMetaEntry`
```ts
ast.WithMetaEntry
```

### `WithMetaOperation`
```ts
ast.WithMetaOperation
```

### `Repository`

### `AnyDomain`
```ts
Dehydrated<ast.Data> | Dehydrated<ast.Choice> | Dehydrated<ast.RosettaEnumeration> | Dehydrated<ast.RosettaFunction> | Dehydrated<ast.RosettaRecordType> | Dehydrated<ast.RosettaTypeAlias> | Dehydrated<ast.RosettaBasicType> | Dehydrated<ast.Annotation>
```

### `DomainRepository`

### `RuneDslTerminalNames`
```ts
keyof typeof RuneDslTerminals
```

### `RuneDslKeywordNames`
```ts
"(" | ")" | "*" | "+" | "," | "-" | "->" | "->>" | "." | ".." | "..." | "/" | ":" | ";" | "<" | "<=" | "<>" | "=" | ">" | ">=" | "ASATP" | "E" | "False" | "T+1" | "T+2" | "T+3" | "T+4" | "T+5" | "True" | "[" | "]" | "absent" | "add" | "alias" | "all" | "and" | "annotation" | "any" | "as" | "as-key" | "basicType" | "body" | "choice" | "componentID" | "condition" | "condition-func" | "condition-path" | "contains" | "corpus" | "count" | "dateFormat" | "default" | "definition" | "disjoint" | "displayName" | "distinct" | "docReference" | "e" | "eligibility" | "else" | "empty" | "enum" | "enums" | "exists" | "extends" | "extract" | "filter" | "first" | "flatten" | "for" | "from" | "func" | "function" | "hint" | "if" | "import" | "in" | "inputs" | "is" | "isEvent" | "isProduct" | "item" | "join" | "label" | "last" | "library" | "mapper" | "maps" | "max" | "merge" | "meta" | "metaType" | "min" | "multiple" | "namespace" | "one-of" | "only" | "only-element" | "optional" | "or" | "output" | "override" | "path" | "pattern" | "post-condition" | "prefix" | "provision" | "rationale" | "rationale_author" | "real-time" | "recordType" | "reduce" | "regulatoryReference" | "removeHtml" | "report" | "reportedField" | "reporting" | "required" | "reverse" | "root" | "rosettaPath" | "rule" | "ruleReference" | "schema" | "scope" | "segment" | "set" | "single" | "sort" | "source" | "standard" | "structured_provision" | "sum" | "super" | "switch" | "synonym" | "tag" | "then" | "to" | "to-date" | "to-date-time" | "to-enum" | "to-int" | "to-number" | "to-string" | "to-time" | "to-zoned-date-time" | "type" | "typeAlias" | "using" | "value" | "version" | "when" | "with" | "with-meta" | "{" | "}"
```

### `RuneDslTokenNames`
```ts
RuneDslTerminalNames | RuneDslKeywordNames
```

### `AnnotationPathExpression`
```ts
AnnotationDeepPath | AnnotationPath | AnnotationPathAttributeReference | RosettaImplicitVariable
```

### `ArithmeticOperation`
**Properties:**
- `$container: AsOperation | TypeCallArgument | Condition | ConstructorKeyValuePair | FilterOperation | InlineFunction | MapOperation | MaxOperation | MinOperation | Operation | ReduceOperation | RosettaSuperCall | RosettaSymbolReference | ArithmeticOperation | AsKeyOperation | ChoiceOperation | ComparisonOperation | DefaultOperation | DistinctOperation | EqualityOperation | FirstOperation | FlattenOperation | JoinOperation | LastOperation | ListLiteral | LogicalOperation | OneOfOperation | ReverseOperation | RosettaAbsentExpression | RosettaConditionalExpression | RosettaContainsExpression | RosettaCountOperation | RosettaDeepFeatureCall | RosettaDisjointExpression | RosettaExistsExpression | RosettaFeatureCall | RosettaOnlyElement | RosettaOnlyExistsExpression | RosettaRule | ShortcutDeclaration | SortOperation | SumOperation | SwitchCaseOrDefault | SwitchOperation | ThenOperation | ToDateOperation | ToDateTimeOperation | ToEnumOperation | ToIntOperation | ToNumberOperation | ToStringOperation | ToTimeOperation | ToZonedDateTimeOperation | WithMetaEntry | WithMetaOperation` — The container node in the AST; every node except the root node has a container.
- `$type: "ArithmeticOperation"` — Every AST node has a type corresponding to what was specified in the grammar declaration.
- `left: RosettaExpression`
- `operator: "+" | "-" | "*" | "/"`
- `right: RosettaExpression`
- `$containerProperty: string` (optional) — The property of the `$container` node that contains this node. This is either a direct reference or an array.
- `$containerIndex: number` (optional) — In case `$containerProperty` is an array, the array index is stored here.
- `$cstNode: CstNode` (optional) — The Concrete Syntax Tree (CST) node of the text range from which this node was parsed.
- `$document: LangiumDocument<AstNode>` (optional) — The document containing the AST; only the root node has a direct reference to the document.

### `AsKeyOperation`
**Properties:**
- `$container: AsOperation | TypeCallArgument | Condition | ConstructorKeyValuePair | FilterOperation | InlineFunction | MapOperation | MaxOperation | MinOperation | Operation | ReduceOperation | RosettaSuperCall | RosettaSymbolReference | ArithmeticOperation | AsKeyOperation | ChoiceOperation | ComparisonOperation | DefaultOperation | DistinctOperation | EqualityOperation | FirstOperation | FlattenOperation | JoinOperation | LastOperation | ListLiteral | LogicalOperation | OneOfOperation | ReverseOperation | RosettaAbsentExpression | RosettaConditionalExpression | RosettaContainsExpression | RosettaCountOperation | RosettaDeepFeatureCall | RosettaDisjointExpression | RosettaExistsExpression | RosettaFeatureCall | RosettaOnlyElement | RosettaOnlyExistsExpression | RosettaRule | ShortcutDeclaration | SortOperation | SumOperation | SwitchCaseOrDefault | SwitchOperation | ThenOperation | ToDateOperation | ToDateTimeOperation | ToEnumOperation | ToIntOperation | ToNumberOperation | ToStringOperation | ToTimeOperation | ToZonedDateTimeOperation | WithMetaEntry | WithMetaOperation` — The container node in the AST; every node except the root node has a container.
- `$type: "AsKeyOperation"` — Every AST node has a type corresponding to what was specified in the grammar declaration.
- `argument: RosettaExpression`
- `operator: "as-key"`
- `$containerProperty: string` (optional) — The property of the `$container` node that contains this node. This is either a direct reference or an array.
- `$containerIndex: number` (optional) — In case `$containerProperty` is an array, the array index is stored here.
- `$cstNode: CstNode` (optional) — The Concrete Syntax Tree (CST) node of the text range from which this node was parsed.
- `$document: LangiumDocument<AstNode>` (optional) — The document containing the AST; only the root node has a direct reference to the document.

### `AssignPathRoot`
```ts
Attribute | ShortcutDeclaration
```

### `AttributeOrChoiceOption`
```ts
Attribute | ChoiceOption
```

### `BigDecimal`
```ts
string
```

### `CardinalityModifier`
```ts
"all" | "any"
```

### `ChoiceOperation`
**Properties:**
- `$container: AsOperation | TypeCallArgument | Condition | ConstructorKeyValuePair | FilterOperation | InlineFunction | MapOperation | MaxOperation | MinOperation | Operation | ReduceOperation | RosettaSuperCall | RosettaSymbolReference | ArithmeticOperation | AsKeyOperation | ChoiceOperation | ComparisonOperation | DefaultOperation | DistinctOperation | EqualityOperation | FirstOperation | FlattenOperation | JoinOperation | LastOperation | ListLiteral | LogicalOperation | OneOfOperation | ReverseOperation | RosettaAbsentExpression | RosettaConditionalExpression | RosettaContainsExpression | RosettaCountOperation | RosettaDeepFeatureCall | RosettaDisjointExpression | RosettaExistsExpression | RosettaFeatureCall | RosettaOnlyElement | RosettaOnlyExistsExpression | RosettaRule | ShortcutDeclaration | SortOperation | SumOperation | SwitchCaseOrDefault | SwitchOperation | ThenOperation | ToDateOperation | ToDateTimeOperation | ToEnumOperation | ToIntOperation | ToNumberOperation | ToStringOperation | ToTimeOperation | ToZonedDateTimeOperation | WithMetaEntry | WithMetaOperation` — The container node in the AST; every node except the root node has a container.
- `$type: "ChoiceOperation"` — Every AST node has a type corresponding to what was specified in the grammar declaration.
- `argument: RosettaExpression` (optional)
- `attributes: Reference<Attribute>[]`
- `necessity: Necessity`
- `operator: "choice"`
- `$containerProperty: string` (optional) — The property of the `$container` node that contains this node. This is either a direct reference or an array.
- `$containerIndex: number` (optional) — In case `$containerProperty` is an array, the array index is stored here.
- `$cstNode: CstNode` (optional) — The Concrete Syntax Tree (CST) node of the text range from which this node was parsed.
- `$document: LangiumDocument<AstNode>` (optional) — The document containing the AST; only the root node has a direct reference to the document.

### `ClosureParameter`
**Properties:**
- `$container: InlineFunction` — The container node in the AST; every node except the root node has a container.
- `$type: "ClosureParameter"` — Every AST node has a type corresponding to what was specified in the grammar declaration.
- `name: string`
- `$containerProperty: string` (optional) — The property of the `$container` node that contains this node. This is either a direct reference or an array.
- `$containerIndex: number` (optional) — In case `$containerProperty` is an array, the array index is stored here.
- `$cstNode: CstNode` (optional) — The Concrete Syntax Tree (CST) node of the text range from which this node was parsed.
- `$document: LangiumDocument<AstNode>` (optional) — The document containing the AST; only the root node has a direct reference to the document.

### `ComparisonOperation`
**Properties:**
- `$container: AsOperation | TypeCallArgument | Condition | ConstructorKeyValuePair | FilterOperation | InlineFunction | MapOperation | MaxOperation | MinOperation | Operation | ReduceOperation | RosettaSuperCall | RosettaSymbolReference | ArithmeticOperation | AsKeyOperation | ChoiceOperation | ComparisonOperation | DefaultOperation | DistinctOperation | EqualityOperation | FirstOperation | FlattenOperation | JoinOperation | LastOperation | ListLiteral | LogicalOperation | OneOfOperation | ReverseOperation | RosettaAbsentExpression | RosettaConditionalExpression | RosettaContainsExpression | RosettaCountOperation | RosettaDeepFeatureCall | RosettaDisjointExpression | RosettaExistsExpression | RosettaFeatureCall | RosettaOnlyElement | RosettaOnlyExistsExpression | RosettaRule | ShortcutDeclaration | SortOperation | SumOperation | SwitchCaseOrDefault | SwitchOperation | ThenOperation | ToDateOperation | ToDateTimeOperation | ToEnumOperation | ToIntOperation | ToNumberOperation | ToStringOperation | ToTimeOperation | ToZonedDateTimeOperation | WithMetaEntry | WithMetaOperation` — The container node in the AST; every node except the root node has a container.
- `$type: "ComparisonOperation"` — Every AST node has a type corresponding to what was specified in the grammar declaration.
- `cardMod: CardinalityModifier` (optional)
- `left: RosettaExpression` (optional)
- `operator: "<" | "<=" | ">" | ">="`
- `right: RosettaExpression`
- `$containerProperty: string` (optional) — The property of the `$container` node that contains this node. This is either a direct reference or an array.
- `$containerIndex: number` (optional) — In case `$containerProperty` is an array, the array index is stored here.
- `$cstNode: CstNode` (optional) — The Concrete Syntax Tree (CST) node of the text range from which this node was parsed.
- `$document: LangiumDocument<AstNode>` (optional) — The document containing the AST; only the root node has a direct reference to the document.

### `DataOrChoice`
```ts
Choice | Data
```

### `DefaultOperation`
**Properties:**

<!-- truncated -->
