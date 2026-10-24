# Classes

## services

### `RuneDslValidator`
Custom validator for the Rune DSL.

Implements structural, naming, expression, and reporting validations
ported from the original Xtext implementation.

Rule categories:
- S-##: Structural constraints (duplicates, cycles, missing fields)
- N-##: Naming convention rules
- E-##: Expression validation rules
- R-##: Reporting validation rules
```ts
constructor(): RuneDslValidator
```
**Methods:**
- `registerChecks(services: LangiumCoreServices): void` — Register validation checks with the Langium validation registry.
- `checkDataNoDuplicateAttributes(node: Data, accept: ValidationAcceptor): void` — S-01: No duplicate attribute names within a Data type.
- `checkDataExtendsCycle(node: Data, accept: ValidationAcceptor): void` — S-02: Detect circular inheritance in Data extends chain.
- `checkAttributeCardinality(node: Attribute, accept: ValidationAcceptor): void` — S-04: Attribute cardinality must have lower &lt;= upper.
- `checkFunctionNoDuplicateInputs(node: RosettaFunction, accept: ValidationAcceptor): void` — S-06: No duplicate function input names.
- `checkFunctionOutputRequired(node: RosettaFunction, accept: ValidationAcceptor): void` — S-07: Functions should have an output.
Dispatch functions (with dispatchAttribute) are exempt — they inherit output from the parent.
- `checkEnumNoDuplicateValues(node: RosettaEnumeration, accept: ValidationAcceptor): void` — S-09: No duplicate enum value names.
- `checkChoiceNoDuplicateOptions(node: Choice, accept: ValidationAcceptor): void` — S-11: No duplicate choice option type references.
- `checkModelNoDuplicateElements(node: RosettaModel, accept: ValidationAcceptor): void` — S-13: No duplicate top-level element names in the same model.
Dispatch function overloads share the same name intentionally — skip them.
- `checkDataAttributeOverrideValid(node: Data, accept: ValidationAcceptor): void` — S-15: Override attribute must exist in the parent type.
- `checkDataMustHaveAttributesOrSuperType(_node: Data, _accept: ValidationAcceptor): void` — S-16: Data type should have at least one attribute or extend another type.
- `checkAttributeTypeResolved(node: Attribute, accept: ValidationAcceptor): void` — S-17: Attribute type reference must resolve.

NOTE: Not registered. Langium's built-in linker already emits an error for
unresolved TypeCall.type references, so registering this check would produce
duplicate error messages.
- `checkFunctionNoDuplicateShortcuts(node: RosettaFunction, accept: ValidationAcceptor): void` — S-18: No duplicate shortcut names in a function.
- `checkFunctionNoDuplicateConditions(node: RosettaFunction, accept: ValidationAcceptor): void` — S-19: No duplicate condition names in a function.
- `checkEnumExtendsCycle(node: RosettaEnumeration, accept: ValidationAcceptor): void` — S-20: Detect circular inheritance in Enum extends chain.
- `checkChoiceMinOptions(node: Choice, accept: ValidationAcceptor): void` — S-21: Choice must have at least two options.
- `checkChoiceOptionTypeResolved(node: ChoiceOption, accept: ValidationAcceptor): void` — S-22: ChoiceOption type must resolve.

NOTE: Not registered. Langium's built-in linker already emits an error for
unresolved TypeCall.type references, so registering this check would produce
duplicate error messages.
- `checkModelNamespaceValid(node: RosettaModel, accept: ValidationAcceptor): void` — S-23: Namespace must be a valid qualified name.
- `checkConditionHasExpression(node: Condition, accept: ValidationAcceptor): void` — S-24: Condition must have an expression body.
- `checkShortcutHasExpression(node: ShortcutDeclaration, accept: ValidationAcceptor): void` — S-25: ShortcutDeclaration must have an expression body.
- `checkOperationHasExpression(node: Operation, accept: ValidationAcceptor): void` — S-26: Operation must have an expression body.
- `checkImportNotEmpty(node: Import, accept: ValidationAcceptor): void` — S-27: Import path must not be empty.
- `checkDataNaming(node: Data, accept: ValidationAcceptor): void` — N-01: Data type names should start with uppercase.
- `checkAttributeNaming(node: Attribute, accept: ValidationAcceptor): void` — N-02: Attribute names should start with lowercase.
Exempt: attributes inside Annotation blocks and ChoiceOptions (matching Xtext behavior).
- `checkFunctionNaming(node: RosettaFunction, accept: ValidationAcceptor): void` — N-03: Function names should start with uppercase.
- `checkEnumNaming(node: RosettaEnumeration, accept: ValidationAcceptor): void` — N-04: Enum names should start with uppercase.
- `checkChoiceNaming(node: Choice, accept: ValidationAcceptor): void` — N-05: Choice names should start with uppercase.
- `checkConditionNaming(node: Condition, accept: ValidationAcceptor): void` — N-06: Condition names should start with uppercase.
- `checkEnumValueNaming(_node: RosettaEnumeration, _accept: ValidationAcceptor): void` — N-07: Enum value names should start with an uppercase letter (convention: PascalCase or UPPER_CASE).
- `checkEnumValueNamingRule(_node: RosettaEnumValue, _accept: ValidationAcceptor): void` — N-08: Standalone enum value naming (used from ChoiceOption context).
- `checkShortcutNaming(_node: ShortcutDeclaration, _accept: ValidationAcceptor): void` — N-09: Shortcut names should start with lowercase.
- `checkRuleNaming(node: RosettaRule, accept: ValidationAcceptor): void` — N-10: Rule names should start with uppercase.
- `checkRuleHasExpression(node: RosettaRule, accept: ValidationAcceptor): void` — R-01: Rule must have an expression body.
- `checkExpressionValid(node: RosettaExpression, accept: ValidationAcceptor): void` — Expression validator dispatcher.
Routes to specific checks based on expression $type.
