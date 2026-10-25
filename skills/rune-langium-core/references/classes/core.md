# Classes

## Core

### `RuneDslParser`
Custom Langium parser for the Rune DSL that normalizes lexer input to insert
implicit `[` and `]` brackets around bare expressions after `extract`,
`filter`, and `reduce` operators.
*extends `LangiumParser`*
```ts
constructor(services: LangiumCoreServices): RuneDslParser
```
**Properties:**
- `lexer: Lexer`
- `wrapper: ChevrotainWrapper`
- `_unorderedGroups: Map<string, boolean[]>`
- `allRules: Map<string, RuleResult>`
- `mainRule: RuleResult`
**Methods:**
- `rule(rule: ParserRule | InfixRule, impl: RuleImpl): RuleResult`
- `parse<T>(input: string, options?: ParserOptions): ParseResult<T>`
- `consume(idx: number, tokenType: TokenType, feature: AbstractElement): void`
- `subrule(idx: number, rule: RuleResult, fragment: boolean, feature: AbstractElement, args: Args): void`
- `action($type: string, action: Action): void`
- `alternatives(idx: number, choices: IOrAlt<any>[]): void` — Performs alternatives parsing (the `|` operation in EBNF/Langium)
- `optional(idx: number, callback: DSLMethodOpts<unknown>): void` — Parses the callback as optional (the `?` operation in EBNF/Langium)
- `many(idx: number, callback: DSLMethodOpts<unknown>): void` — Parses the callback 0 or more times (the `*` operation in EBNF/Langium)
- `atLeastOne(idx: number, callback: DSLMethodOpts<unknown>): void` — Parses the callback 1 or more times (the `+` operation in EBNF/Langium)
- `getRule(name: string): RuleResult | undefined` — Returns the executable rule function for the specified rule name
- `isRecording(): boolean` — Whether the parser is currently actually in use or in "recording mode".
Recording mode is activated once when the parser is analyzing itself.
During this phase, no input exists and therefore no AST should be constructed
- `getRuleStack(): number[]` — The rule stack indicates the indices of rules that are currently invoked,
in order of their invocation.
- `finalize(): void`
