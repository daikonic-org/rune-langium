# Variables & Constants

## generated

### `RuneDslTerminals`
```ts
const RuneDslTerminals: { ID: RegExp; INT: RegExp; STRING: RegExp; ML_COMMENT: RegExp; SL_COMMENT: RegExp; WS: RegExp }
```

### `AnnotationPathExpression`
```ts
let AnnotationPathExpression: { $type: "AnnotationPathExpression" }
```

### `ArithmeticOperation`
```ts
let ArithmeticOperation: { $type: "ArithmeticOperation"; left: "left"; operator: "operator"; right: "right" }
```

### `AsKeyOperation`
```ts
let AsKeyOperation: { $type: "AsKeyOperation"; argument: "argument"; operator: "operator" }
```

### `AssignPathRoot`
```ts
let AssignPathRoot: { $type: "AssignPathRoot" }
```

### `AttributeOrChoiceOption`
```ts
let AttributeOrChoiceOption: { $type: "AttributeOrChoiceOption" }
```

### `ChoiceOperation`
```ts
let ChoiceOperation: { $type: "ChoiceOperation"; argument: "argument"; attributes: "attributes"; necessity: "necessity"; operator: "operator" }
```

### `ClosureParameter`
```ts
let ClosureParameter: { $type: "ClosureParameter"; name: "name" }
```

### `ComparisonOperation`
```ts
let ComparisonOperation: { $type: "ComparisonOperation"; cardMod: "cardMod"; left: "left"; operator: "operator"; right: "right" }
```

### `DataOrChoice`
```ts
let DataOrChoice: { $type: "DataOrChoice" }
```

### `DefaultOperation`
```ts
let DefaultOperation: { $type: "DefaultOperation"; left: "left"; operator: "operator"; right: "right" }
```

### `DistinctOperation`
```ts
let DistinctOperation: { $type: "DistinctOperation"; argument: "argument"; operator: "operator" }
```

### `DocumentRationale`
```ts
let DocumentRationale: { $type: "DocumentRationale"; rationale: "rationale"; rationaleAuthor: "rationaleAuthor" }
```

### `EqualityOperation`
```ts
let EqualityOperation: { $type: "EqualityOperation"; cardMod: "cardMod"; left: "left"; operator: "operator"; right: "right" }
```

### `FirstOperation`
```ts
let FirstOperation: { $type: "FirstOperation"; argument: "argument"; operator: "operator" }
```

### `FlattenOperation`
```ts
let FlattenOperation: { $type: "FlattenOperation"; argument: "argument"; operator: "operator" }
```

### `Import`
```ts
let Import: { $type: "Import"; importedNamespace: "importedNamespace"; namespaceAlias: "namespaceAlias" }
```

### `JoinOperation`
```ts
let JoinOperation: { $type: "JoinOperation"; left: "left"; operator: "operator"; right: "right" }
```

### `LabelAnnotation`
```ts
let LabelAnnotation: { $type: "LabelAnnotation"; deprecatedAs: "deprecatedAs"; label: "label"; name: "name"; path: "path" }
```

### `LastOperation`
```ts
let LastOperation: { $type: "LastOperation"; argument: "argument"; operator: "operator" }
```

### `ListLiteral`
```ts
let ListLiteral: { $type: "ListLiteral"; elements: "elements" }
```

### `LogicalOperation`
```ts
let LogicalOperation: { $type: "LogicalOperation"; left: "left"; operator: "operator"; right: "right" }
```

### `OneOfOperation`
```ts
let OneOfOperation: { $type: "OneOfOperation"; argument: "argument"; operator: "operator" }
```

### `ReverseOperation`
```ts
let ReverseOperation: { $type: "ReverseOperation"; argument: "argument"; operator: "operator" }
```

### `RosettaAbsentExpression`
```ts
let RosettaAbsentExpression: { $type: "RosettaAbsentExpression"; argument: "argument"; operator: "operator" }
```

### `RosettaBody`
```ts
let RosettaBody: { $type: "RosettaBody"; bodyType: "bodyType"; definition: "definition"; name: "name" }
```

### `RosettaBooleanLiteral`
```ts
let RosettaBooleanLiteral: { $type: "RosettaBooleanLiteral"; value: "value" }
```

### `RosettaCallableWithArgs`
```ts
let RosettaCallableWithArgs: { $type: "RosettaCallableWithArgs" }
```

### `RosettaCardinality`
```ts
let RosettaCardinality: { $type: "RosettaCardinality"; inf: "inf"; sup: "sup"; unbounded: "unbounded" }
```

### `RosettaConditionalExpression`
```ts
let RosettaConditionalExpression: { $type: "RosettaConditionalExpression"; elsethen: "elsethen"; full: "full"; if: "if"; ifthen: "ifthen" }
```

### `RosettaContainsExpression`
```ts
let RosettaContainsExpression: { $type: "RosettaContainsExpression"; left: "left"; operator: "operator"; right: "right" }
```

### `RosettaCountOperation`
```ts
let RosettaCountOperation: { $type: "RosettaCountOperation"; argument: "argument"; operator: "operator" }
```

### `RosettaDisjointExpression`
```ts
let RosettaDisjointExpression: { $type: "RosettaDisjointExpression"; left: "left"; operator: "operator"; right: "right" }
```

### `RosettaEnumSynonym`
```ts
let RosettaEnumSynonym: { $type: "RosettaEnumSynonym"; definition: "definition"; patternMatch: "patternMatch"; patternReplace: "patternReplace"; removeHtml: "removeHtml"; sources: "sources"; synonymValue: "synonymValue" }
```

### `RosettaExistsExpression`
```ts
let RosettaExistsExpression: { $type: "RosettaExistsExpression"; argument: "argument"; modifier: "modifier"; operator: "operator" }
```

### `RosettaExpression`
```ts
let RosettaExpression: { $type: "RosettaExpression" }
```

### `RosettaFeature`
```ts
let RosettaFeature: { $type: "RosettaFeature" }
```

### `RosettaImplicitVariable`
```ts
let RosettaImplicitVariable: { $type: "RosettaImplicitVariable"; name: "name" }
```

### `RosettaIntLiteral`
```ts
let RosettaIntLiteral: { $type: "RosettaIntLiteral"; value: "value" }
```

### `RosettaLiteral`
```ts
let RosettaLiteral: { $type: "RosettaLiteral" }
```

### `RosettaMapPathValue`
```ts
let RosettaMapPathValue: { $type: "RosettaMapPathValue"; path: "path" }
```

### `RosettaMappingPathTests`
```ts
let RosettaMappingPathTests: { $type: "RosettaMappingPathTests"; tests: "tests" }
```

### `RosettaMapTest`
```ts
let RosettaMapTest: { $type: "RosettaMapTest" }
```

### `RosettaMapTestExpression`
```ts
let RosettaMapTestExpression: { $type: "RosettaMapTestExpression" }
```

### `RosettaMergeSynonymValue`
```ts
let RosettaMergeSynonymValue: { $type: "RosettaMergeSynonymValue"; excludePath: "excludePath"; name: "name" }
```

### `RosettaNumberLiteral`
```ts
let RosettaNumberLiteral: { $type: "RosettaNumberLiteral"; value: "value" }
```

### `RosettaOnlyElement`
```ts
let RosettaOnlyElement: { $type: "RosettaOnlyElement"; argument: "argument"; operator: "operator" }
```

### `RosettaOnlyExistsExpression`
```ts
let RosettaOnlyExistsExpression: { $type: "RosettaOnlyExistsExpression"; args: "args"; argument: "argument"; operator: "operator" }
```

### `RosettaRootElement`
```ts
let RosettaRootElement: { $type: "RosettaRootElement" }
```

### `RosettaScope`
```ts
let RosettaScope: { $type: "RosettaScope"; definition: "definition"; name: "name" }
```

### `RosettaSegment`
```ts
let RosettaSegment: { $type: "RosettaSegment"; name: "name" }
```

### `RosettaStringLiteral`
```ts
let RosettaStringLiteral: { $type: "RosettaStringLiteral"; value: "value" }
```

### `RosettaSuperCall`
```ts
let RosettaSuperCall: { $type: "RosettaSuperCall"; explicitArguments: "explicitArguments"; name: "name"; rawArgs: "rawArgs" }
```

### `RosettaSymbol`
```ts
let RosettaSymbol: { $type: "RosettaSymbol" }
```

### `RosettaSynonymValueBase`
```ts
let RosettaSynonymValueBase: { $type: "RosettaSynonymValueBase"; maps: "maps"; name: "name"; path: "path"; refType: "refType"; value: "value" }
```

### `RosettaType`
```ts
let RosettaType: { $type: "RosettaType" }
```

### `RosettaTypedFeature`
```ts
let RosettaTypedFeature: { $type: "RosettaTypedFeature" }
```

### `ShortcutDeclaration`
```ts
let ShortcutDeclaration: { $type: "ShortcutDeclaration"; definition: "definition"; expression: "expression"; name: "name" }
```

### `SumOperation`
```ts
let SumOperation: { $type: "SumOperation"; argument: "argument"; operator: "operator" }
```

### `SwitchCaseTarget`
```ts
let SwitchCaseTarget: { $type: "SwitchCaseTarget" }
```

### `ToDateOperation`
```ts
let ToDateOperation: { $type: "ToDateOperation"; argument: "argument"; operator: "operator" }
```

### `ToDateTimeOperation`
```ts
let ToDateTimeOperation: { $type: "ToDateTimeOperation"; argument: "argument"; operator: "operator" }
```

### `ToIntOperation`
```ts
let ToIntOperation: { $type: "ToIntOperation"; argument: "argument"; operator: "operator" }
```

### `ToNumberOperation`
```ts
let ToNumberOperation: { $type: "ToNumberOperation"; argument: "argument"; operator: "operator" }
```

### `ToStringOperation`
```ts
let ToStringOperation: { $type: "ToStringOperation"; argument: "argument"; operator: "operator" }
```

### `ToTimeOperation`
```ts
let ToTimeOperation: { $type: "ToTimeOperation"; argument: "argument"; operator: "operator" }
```

### `ToZonedDateTimeOperation`
```ts
let ToZonedDateTimeOperation: { $type: "ToZonedDateTimeOperation"; argument: "argument"; operator: "operator" }
```

### `reflection`
```ts
const reflection: RuneDslAstReflection
```

### `RuneDslLanguageMetaData`
```ts
const RuneDslLanguageMetaData: { languageId: "rune-dsl"; fileExtensions: readonly [".rosetta"]; caseInsensitive: false; mode: "development" }
```

### `RuneDslGeneratedModule`
```ts
const RuneDslGeneratedModule: Module<LangiumCoreServices, LangiumGeneratedCoreServices>
```

### `RuneDslGeneratedSharedModule`
```ts
const RuneDslGeneratedSharedModule: Module<LangiumSharedCoreServices, LangiumGeneratedSharedCoreServices>
```

## references

### `DeclarationIdentitySchema`
```ts
const DeclarationIdentitySchema: ZodObject<{ model: ZodString; namespace: ZodString; kind: ZodString; name: ZodString; dispatch: ZodOptional<ZodString> }, $strip>
```

### `ProjectResolutionReceiptSchema`
```ts
const ProjectResolutionReceiptSchema: ZodObject<{ revision: ZodString; lockDigest: ZodString; overridesDigest: ZodString }, $strip>
```

### `ProjectResolutionContextSchema`
Sent with a complete retained document set, after its semantic snapshots have arrived.
```ts
const ProjectResolutionContextSchema: ZodObject<{ schemaVersion: ZodLiteral<1>; receipt: ZodObject<{ revision: ZodString; lockDigest: ZodString; overridesDigest: ZodString }, $strip>; models: ZodRecord<ZodString, ZodString>; lock: ZodNullable<ZodUnknown>; overrides: ZodArray<ZodUnknown> }, $strip>
```

### `RepositoryExampleSourceSchema`
Imported example origin; a Nightly commit records provenance, never a reference lock.
```ts
const RepositoryExampleSourceSchema: ZodObject<{ model: ZodString; repository: ZodString; release: ZodString; commit: ZodString; path: ZodString; format: ZodEnum<{ JSON: "JSON"; RUNE_JSON: "RUNE_JSON" }>; version: ZodOptional<ZodString> }, $strict>
```

## stdlib

### `BASE_TYPE_FILES`
System file descriptors for base types.
```ts
const BASE_TYPE_FILES: readonly [{ name: "basictypes.rosetta"; path: "system://com.rosetta.model/basictypes.rosetta"; content: "namespace com.rosetta.model\nversion \"${project.version}\"\n\nbasicType boolean <\"A boolean can either be True or False.\">\n\nbasicType number(\n    digits int           <\"The maximum number of digits that the number may have. If absent, this number may have an arbitrary number of digits.\">\n  , fractionalDigits int <\"The maximum number of digits after the decimal point that the number may have. If absent, this number may have any number of its digits after the decimal point.\">\n  , min number           <\"The minimum bound on this number. If absent, this number is unbounded from below.\">\n  , max number           <\"The maximum bound on this number. If absent, this number is unbounded from above.\">\n) <\"A signed decimal number.\">\n\nbasicType string(\n    minLength int  <\"The minimum number of characters that the string must have. If absent, defaults to zero.\">\n  , maxLength int  <\"The maximum number of characters that the string may have. If absent, there is no limit.\">\n  , pattern string <\"The regular expression that this string must match. If absent, this string may contain arbitrary characters.\">\n) <\"A string of characters.\">\n\nbasicType time <\"The time of the day - hour-minute-second.\">\n\nbasicType pattern <\"A regular expression.\">\n\ntypeAlias int(digits int, min int, max int): <\"A signed decimal integer.\">\n\tnumber(digits: digits, fractionalDigits: 0, min: min, max: max)\n\nlibrary function DateRanges() date\nlibrary function Min(x number, y number) number\nlibrary function Max(x number, y number) number\nlibrary function Adjust() date\nlibrary function Within() boolean\nlibrary function IsLeapYear(year number) boolean\n\nrecordType date\n{\n\tday   int\n\tmonth int\n\tyear  int\n}\n\nrecordType dateTime\n{\n\tdate date\n\ttime time\n}\n\nrecordType zonedDateTime\n{\n\tdate date\n\ttime time\n\ttimezone string\n}\n\ntypeAlias productType:\n\tstring\n\ntypeAlias eventType:\n\tstring\n\ntypeAlias calculation:\n\tstring\n"; dirty: false; readOnly: true }, { name: "annotations.rosetta"; path: "system://com.rosetta.model/annotations.rosetta"; content: string; dirty: false; readOnly: true }]
```

### `BASICTYPES_ROSETTA`
Built-in Rune DSL base type definitions.

These files are always loaded as read-only system files so that
types like `number`, `string`, `date`, and annotations like
`metadata`, `rootType`, etc. are available for cross-reference resolution.

Content sourced from rune-runtime model resources.
```ts
const BASICTYPES_ROSETTA: "namespace com.rosetta.model\nversion \"${project.version}\"\n\nbasicType boolean <\"A boolean can either be True or False.\">\n\nbasicType number(\n    digits int           <\"The maximum number of digits that the number may have. If absent, this number may have an arbitrary number of digits.\">\n  , fractionalDigits int <\"The maximum number of digits after the decimal point that the number may have. If absent, this number may have any number of its digits after the decimal point.\">\n  , min number           <\"The minimum bound on this number. If absent, this number is unbounded from below.\">\n  , max number           <\"The maximum bound on this number. If absent, this number is unbounded from above.\">\n) <\"A signed decimal number.\">\n\nbasicType string(\n    minLength int  <\"The minimum number of characters that the string must have. If absent, defaults to zero.\">\n  , maxLength int  <\"The maximum number of characters that the string may have. If absent, there is no limit.\">\n  , pattern string <\"The regular expression that this string must match. If absent, this string may contain arbitrary characters.\">\n) <\"A string of characters.\">\n\nbasicType time <\"The time of the day - hour-minute-second.\">\n\nbasicType pattern <\"A regular expression.\">\n\ntypeAlias int(digits int, min int, max int): <\"A signed decimal integer.\">\n\tnumber(digits: digits, fractionalDigits: 0, min: min, max: max)\n\nlibrary function DateRanges() date\nlibrary function Min(x number, y number) number\nlibrary function Max(x number, y number) number\nlibrary function Adjust() date\nlibrary function Within() boolean\nlibrary function IsLeapYear(year number) boolean\n\nrecordType date\n{\n\tday   int\n\tmonth int\n\tyear  int\n}\n\nrecordType dateTime\n{\n\tdate date\n\ttime time\n}\n\nrecordType zonedDateTime\n{\n\tdate date\n\ttime time\n\ttimezone string\n}\n\ntypeAlias productType:\n\tstring\n\ntypeAlias eventType:\n\tstring\n\ntypeAlias calculation:\n\tstring\n"
```

### `ANNOTATIONS_ROSETTA`
```ts
const ANNOTATIONS_ROSETTA: string
```

## Core

### `RuneDslModule`
Dependency-injection module for the Rune DSL language.
```ts
const RuneDslModule: { serializer: { JsonSerializer: (services: RuneDslServices) => RuneJsonSerializer }; parser: { LangiumParser: (services: RuneDslServices) => RuneDslParser }; references: { Linker: (services: RuneDslServices) => RuneDslLinker; ScopeComputation: (services: RuneDslServices) => RuneDslScopeComputation; ScopeProvider: (services: RuneDslServices) => RuneDslScopeProvider } }
```

### `RuneDslSharedModule`
Shared services module that overrides Langium's default IndexManager with
`RuneDslIndexManager`, enabling external registration of exported symbols
without requiring a full document build (ADR 007 Phase 4).
```ts

<!-- truncated -->
