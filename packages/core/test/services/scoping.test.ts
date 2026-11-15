// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { describe, it, expect, vi } from 'vitest';
import {
  parse,
  parseWorkspace,
  isRosettaFunction,
  isRosettaSymbolReference,
  isRosettaModel,
  getFunctionSignature,
  getFunctionOutput,
  createRuneDslServices
} from '../../src/index.js';
import type { Data, RosettaFunction, RosettaEnumeration, RosettaModel } from '../../src/index.js';
import { AstUtils, URI } from 'langium';
import type { Diagnostic } from 'langium';

/**
 * Helper: parse and assert no errors.
 */
async function parseOk(input: string) {
  const result = await parse(input);
  const allErrors = [
    ...result.lexerErrors.map((e) => `Lexer: ${e.message}`),
    ...result.parserErrors.map((e) => `Parser: ${e.message}`)
  ];
  expect(allErrors, allErrors.join('\n')).toHaveLength(0);
  return result;
}

/**
 * Helper: parse and validate a workspace of multiple documents.
 * Returns diagnostics per document so we can check linking errors.
 */
async function parseAndValidateWorkspace(entries: Array<{ uri: string; content: string }>): Promise<
  Array<{
    value: RosettaModel;
    diagnostics: Diagnostic[];
    errors: Diagnostic[];
  }>
> {
  const { RuneDsl } = createRuneDslServices();
  const factory = RuneDsl.shared.workspace.LangiumDocumentFactory;
  const builder = RuneDsl.shared.workspace.DocumentBuilder;

  const documents = entries.map((entry) => factory.fromString(entry.content, URI.parse(entry.uri)));
  await builder.build(documents, { validation: true });

  return documents.map((doc) => {
    const diagnostics = doc.diagnostics ?? [];
    return {
      value: doc.parseResult.value as RosettaModel,
      diagnostics,
      errors: diagnostics.filter((d) => d.severity === 1)
    };
  });
}

describe('Scoping', () => {
  it.each([
    'parents filter [item -> active]',
    'parents extract [item]',
    'parents then filter [item -> active]',
    'parents sort [item -> detail -> value]',
    '(parents extract [[item]]) flatten'
  ])('links deep features after %s', async (operation) => {
    const results = await parseAndValidateWorkspace([
      { uri: 'inmemory:///builtins.rosetta', content: 'namespace builtins\nbasicType int\nbasicType boolean' },
      {
        uri: 'inmemory:///operators.rosetta',
        content: `namespace operators
type Detail:
 value int (1..1)
type Parent:
 active boolean (1..1)
 detail Detail (1..1)
func Read:
 inputs: parents Parent (0..*)
 output: result int (0..*)
 set result: (${operation}) ->> value`
      }
    ]);
    expect(results.flatMap((result) => result.errors)).toEqual([]);
  });

  it('links ordinary parameters and outputs without enumerating dispatch candidates', async () => {
    const { RuneDsl } = createRuneDslServices();
    const document = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
      `namespace ordinary
basicType int
func Compute:
 inputs: amount int (1..1)
 output: result int (1..1)
 set result: amount + 1`,
      URI.parse('inmemory:///ordinary.rosetta')
    );
    const candidates = vi.spyOn(RuneDsl.shared.workspace.IndexManager, 'allElements');
    try {
      await RuneDsl.shared.workspace.DocumentBuilder.build([document], { validation: true, eagerLinking: true });
      expect(document.diagnostics?.filter((diagnostic) => diagnostic.severity === 1) ?? []).toEqual([]);
      const model = document.parseResult.value;
      if (!isRosettaModel(model)) throw new Error('Expected a model');
      const func = model.elements.find(isRosettaFunction);
      if (!func) throw new Error('Expected Compute');
      expect(func.operations[0]?.assignRoot.ref).toBe(func.output);
      expect(
        AstUtils.streamAst(func)
          .filter(isRosettaSymbolReference)
          .map((node) => node.symbol.ref)
          .toArray()
      ).toEqual([func.inputs[0]]);
      expect(candidates.mock.calls.filter(([kind]) => kind === 'RosettaFunction')).toEqual([]);
    } finally {
      candidates.mockRestore();
    }
  });

  it.each([false, true])('links split dispatch signatures within their namespace (reverse=%s)', async (reverse) => {
    const sources = [
      `namespace builtins
basicType string
basicType int`,
      `namespace other
enum Shadow:
 amount
func Compute:
 inputs: wrong string (1..1)
 output: result string (1..1)
 set result: wrong`,
      `namespace split
enum Kind:
 Cash
 Credit
func Compute:
 inputs:
  kind Kind (1..1)
  amount int (1..1)
 output: result int (1..1)
 set result: amount`,
      `namespace split
func Compute(kind: Kind -> Cash):
 set result: amount + 1`
    ];
    const docs = await parseAndValidateWorkspace(
      (reverse ? [...sources].reverse() : sources).map((content, i) => ({
        uri: `inmemory:///split-${i}.rosetta`,
        content
      }))
    );
    expect(docs.flatMap((doc) => doc.errors)).toEqual([]);
    const funcs = docs.flatMap((doc) => doc.value.elements.filter(isRosettaFunction));
    const overload = funcs.find((func) => func.dispatchAttribute)!;
    const base = funcs.find((func) => !func.dispatchAttribute && func.$container.name === 'split')!;
    expect(getFunctionSignature(overload)).toBe(base);
    expect(getFunctionOutput(overload)).toBe(base.output);
    expect(overload.dispatchAttribute?.ref).toBe(base.inputs[0]);
    expect(overload.operations[0]?.assignRoot.ref).toBe(base.output);
  });

  it('retains overloads and alias candidates while deduplicating simple and qualified exports', async () => {
    const { RuneDsl } = createRuneDslServices();
    const sources = [
      `namespace builtins
basicType int`,
      `namespace split
enum Kind:
 Cash
func Compute:
 inputs: kind Kind (1..1) amount int (1..1)
 output: result int (1..1)
 set result: amount`,
      `namespace split
func Compute(kind: Kind -> Cash):
 set result: amount + 1`,
      `namespace other
func Compute:
 inputs: amount int (1..1)
 output: result int (1..1)
 set result: amount`,
      `namespace split
import split.* as pick
import other.* as pick
func Call:
 inputs: kind Kind (1..1)
 output: result int (1..1)
 set result: Compute(kind, 1)`
    ];
    const documents = sources.map((source, i) =>
      RuneDsl.shared.workspace.LangiumDocumentFactory.fromString<RosettaModel>(
        source,
        URI.parse(`inmemory:///overloads-${i}.rosetta`)
      )
    );
    await RuneDsl.shared.workspace.DocumentBuilder.build(documents, { validation: true });
    expect(documents.flatMap((doc) => doc.parseResult.parserErrors)).toEqual([]);
    const caller = documents.at(-1)!.parseResult.value.elements.find(isRosettaFunction)!;
    const expression = caller.operations[0]!.expression!;
    expect(isRosettaSymbolReference(expression)).toBe(true);
    if (!isRosettaSymbolReference(expression)) throw new Error('Expected function call');
    const scope = RuneDsl.references.ScopeProvider.getScope({
      container: expression,
      property: 'symbol',
      reference: expression.symbol
    });
    const identity = (description: import('langium').AstNodeDescription) =>
      `${description.documentUri}#${description.path}`;
    const simple = scope.getElements('Compute').toArray();
    expect(simple).toHaveLength(3);
    expect(new Set(simple.map(identity)).size).toBe(3);
    expect(identity(simple[0]!)).toBe(identity(scope.getElement('Compute')!));
    expect(scope.getElements('split.Compute').toArray()).toHaveLength(2);
    expect(scope.getElements('pick.Compute').toArray().map(identity)).toEqual(simple.map(identity));
    expect(scope.getElements('missing').toArray()).toEqual([]);
  });

  describe('Feature call scope (T067, T077)', () => {
    it('should resolve attribute references within a data type', async () => {
      const result = await parseOk(`
        namespace test.scope
        version "1.0.0"

        type Foo:
          bar int (1..1)

        func TestFunc:
          inputs:
            input Foo (1..1)
          output:
            result int (1..1)
          set result:
            input -> bar
      `);
      const model = result.value;
      const func = model.elements[1] as RosettaFunction;
      expect(func.name).toBe('TestFunc');
    });

    it('should parse deep feature calls with ->>', async () => {
      const result = await parseOk(`
        namespace test.scope
        version "1.0.0"

        type Bar:
          value int (1..1)

        type Foo:
          bars Bar (0..*)

        func TestFunc:
          inputs:
            input Foo (1..1)
          output:
            result int (0..*)
          set result:
            input -> bars ->> value
      `);
      expect(result.hasErrors).toBe(false);
    });
  });

  describe('Operation assign root scope (T068, T079)', () => {
    it('should resolve function inputs in set expressions', async () => {
      const result = await parseOk(`
        namespace test.scope
        version "1.0.0"

        func Add:
          inputs:
            a int (1..1)
            b int (1..1)
          output:
            result int (1..1)
          set result:
            a + b
      `);
      const model = result.value;
      const func = model.elements[0] as RosettaFunction;
      expect(func.inputs).toHaveLength(2);
      expect(func.output?.name).toBe('result');
    });

    it('should resolve output in add expressions', async () => {
      const result = await parseOk(`
        namespace test.scope
        version "1.0.0"

        func Accumulate:
          inputs:
            values int (0..*)
          output:
            result int (0..*)
          add result:
            values
      `);
      expect(result.hasErrors).toBe(false);
    });
  });

  describe('Enum value scope (T069, T080)', () => {
    it('should resolve enum values in expressions', async () => {
      const result = await parseOk(`
        namespace test.scope
        version "1.0.0"

        enum Currency:
          USD
          EUR
          GBP

        type Money:
          amount number (1..1)
          currency Currency (1..1)
      `);
      const model = result.value;
      const enumType = model.elements[0] as RosettaEnumeration;
      expect(enumType.enumValues).toHaveLength(3);
      expect(enumType.enumValues[0]!.name).toBe('USD');
    });
  });

  describe('Cross-reference resolution (T070)', () => {
    it('should resolve type references within same model', async () => {
      const result = await parseOk(`
        namespace test.scope
        version "1.0.0"

        type Address:
          street string (1..1)
          city string (1..1)

        type Person:
          name string (1..1)
          address Address (1..1)
      `);
      const model = result.value;
      const person = model.elements[1] as Data;
      expect(person.name).toBe('Person');
      const addressAttr = person.attributes[1];
      expect(addressAttr?.name).toBe('address');
      expect(addressAttr?.typeCall?.type?.$refText).toBe('Address');
    });

    it('should resolve extends references', async () => {
      const result = await parseOk(`
        namespace test.scope
        version "1.0.0"

        type Base:
          id int (1..1)

        type Derived extends Base:
          extra string (1..1)
      `);
      const model = result.value;
      const derived = model.elements[1] as Data;
      expect(derived.superType?.$refText).toBe('Base');
    });
  });

  describe('Workspace cross-document resolution (T071, T082)', () => {
    it('should resolve types across multiple documents', async () => {
      const results = await parseWorkspace([
        {
          uri: 'inmemory:///types.rosetta',
          content: `
            namespace test.scope
            version "1.0.0"

            type Address:
              street string (1..1)
          `
        },
        {
          uri: 'inmemory:///model.rosetta',
          content: `
            namespace test.scope
            version "1.0.0"

            type Person:
              name string (1..1)
              address Address (1..1)
          `
        }
      ]);
      // Both documents should parse without lexer/parser errors
      for (const doc of results) {
        expect(doc.lexerErrors).toHaveLength(0);
        expect(doc.parserErrors).toHaveLength(0);
      }
    });
  });

  describe('Import and namespace scope (T072, T082)', () => {
    it('should parse import statements', async () => {
      const result = await parseOk(`
        namespace test.scope
        version "1.0.0"
        import com.rosetta.model.*

        type MyType:
          value int (1..1)
      `);
      const model = result.value;
      expect(model.imports).toHaveLength(1);
    });

    it('should parse namespace with scope', async () => {
      const result = await parseOk(`
        namespace test.scope scope MyScope
        version "1.0.0"

        type MyType:
          value int (1..1)
      `);
      expect(result.hasErrors).toBe(false);
    });
  });

  describe('Enum value feature call scope (CompareOp -> GreaterThan)', () => {
    it('should resolve enum value via -> in same file', async () => {
      const result = await parseOk(`
        namespace test.scope
        version "1.0.0"

        enum CompareOp:
          GreaterThan
          LessThan
          Equals

        func CompareNumbers:
          inputs:
            n1 number (1..1)
            op CompareOp (1..1)
            n2 number (1..1)
          output:
            result boolean (1..1)
          set result:
            if op = CompareOp -> GreaterThan
            then n1 > n2 = True
            else if op = CompareOp -> LessThan
            then n1 < n2 = True
            else False
      `);
      expect(result.hasErrors).toBe(false);
    });

    it('should resolve enum value via -> across files', async () => {
      const results = await parseAndValidateWorkspace([
        {
          uri: 'inmemory:///basictypes.rosetta',
          content: `
            namespace com.rosetta.model
            version "1.0.0"

            basicType boolean <"A boolean value.">
            basicType number(
              digits int <"Max digits.">,
              fractionalDigits int <"Max fractional digits.">,
              min number <"Min bound.">,
              max number <"Max bound.">
            ) <"A signed decimal number.">
            typeAlias int(digits int, min int, max int): <"A signed decimal integer.">
              number(digits: digits, fractionalDigits: 0, min: min, max: max)
          `
        },
        {
          uri: 'inmemory:///enum.rosetta',
          content: `
            namespace test.scope
            version "1.0.0"

            enum CompareOp:
              GreaterThan
              GreaterThanOrEquals
              Equals
              LessThanOrEquals
              LessThan
          `
        },
        {
          uri: 'inmemory:///func.rosetta',
          content: `
            namespace test.scope
            version "1.0.0"

            func CompareNumbers:
              inputs:
                n1 number (1..1)
                op CompareOp (1..1)
                n2 number (1..1)
              output:
                result boolean (1..1)
              set result:
                if op = CompareOp -> GreaterThan
                then n1 > n2 = True
                else if op = CompareOp -> GreaterThanOrEquals
                then n1 >= n2 = True
                else if op = CompareOp -> Equals
                then n1 = n2 = True
                else if op = CompareOp -> LessThanOrEquals
                then n1 <= n2 = True
                else if op = CompareOp -> LessThan
                then n1 < n2 = True
                else False
          `
        }
      ]);

      // Both documents should produce no linking/validation errors
      for (const result of results) {
        const errorMessages = result.errors.map((d) => d.message);
        expect(errorMessages, errorMessages.join('\n')).toHaveLength(0);
      }
    });

    it('should report error for non-existent enum value via ->', async () => {
      const results = await parseAndValidateWorkspace([
        {
          uri: 'inmemory:///enum2.rosetta',
          content: `
            namespace test.scope
            version "1.0.0"

            enum Direction:
              North
              South
          `
        },
        {
          uri: 'inmemory:///func2.rosetta',
          content: `
            namespace test.scope
            version "1.0.0"

            func CheckDirection:
              inputs:
                dir Direction (1..1)
              output:
                result boolean (1..1)
              set result:
                dir = Direction -> East
          `
        }
      ]);

      // The func document should have a linking error for 'East'
      const funcErrors = results[1]!.errors;
      expect(funcErrors.length).toBeGreaterThan(0);
      const eastError = funcErrors.find((d) => d.message.includes('East'));
      expect(eastError).toBeDefined();
    });
  });

  describe('Implicit lambda then-extract scope (T083)', () => {
    it('should resolve inherited attribute via then extract chain', async () => {
      const result = await parseOk(`
        namespace test.scope
        version "1.0.0"

        type MeasureBase:
          value number (0..1)

        type Price extends MeasureBase:
          priceType string (1..1)

        type PriceQuantity:
          price Price (0..*)

        func TestFunc:
          inputs:
            pqs PriceQuantity (0..*)
          output:
            result number (0..*)
          set result:
            pqs
              extract [price]
              then flatten
              then filter [priceType = "InterestRate"]
              then extract [value]
      `);
      expect(result.hasErrors).toBe(false);
    });

    it('should resolve attribute via filter then extract chain', async () => {
      const result = await parseOk(`
        namespace test.scope
        version "1.0.0"

        type MeasureBase:
          value number (0..1)

        type Price extends MeasureBase:
          priceType string (1..1)

        func TestFunc:
          inputs:
            prices Price (0..*)
          output:
            result number (0..*)
          set result:
            prices
              filter [priceType = "InterestRate"]
              then extract [value]
      `);
      expect(result.hasErrors).toBe(false);
    });

    it('should resolve inherited value via filter then extract (CDM-like pattern)', async () => {
      // Exact CDM pattern: price PriceSchedule input, filter by priceType, then extract value
      // PriceSchedule extends MeasureSchedule extends MeasureBase (which has value)
      const result = await parseOk(`
        namespace test.scope
        version "1.0.0"

        type MeasureBase:
          value number (0..1)

        type MeasureSchedule extends MeasureBase:
          datedValue number (0..*)

        type PriceSchedule extends MeasureSchedule:
          priceType string (1..1)

        func TestFunc:
          inputs:
            price PriceSchedule (0..*)
          output:
            result number (0..*)
          alias cashPrice:
            price
              filter priceType = "AssetPrice"
              then extract value
              then only-element
          set result:
            cashPrice
      `);
      expect(result.hasErrors).toBe(false);
    });
  });

  describe('Cross-file constructor key scope', () => {
    it('should resolve inherited constructor keys across files', async () => {
      const results = await parseAndValidateWorkspace([
        {
          uri: 'inmemory:///base.rosetta',
          content: `
            namespace test.scope
            version "1.0.0"

            type Base:
              x int (0..1)
              y int (0..1)

            type Child extends Base:
              z int (0..1)
          `
        },
        {
          uri: 'inmemory:///func.rosetta',
          content: `
            namespace test.scope
            version "1.0.0"

            func TestFunc:
              inputs:
                inp int (1..1)
              output:
                result Child (1..1)
              set result:
                Child {
                  x: inp,
                  y: inp,
                  z: inp
                }
          `
        }
      ]);

      // Only check RosettaFeature errors (not type reference errors for int/string)
      const featureErrors = results.flatMap((r) => r.errors.filter((d) => d.message.includes('RosettaFeature')));
      expect(featureErrors, featureErrors.map((d) => d.message).join('\n')).toHaveLength(0);
    });

    it('should resolve constructor keys when type extends across multiple files', async () => {
      // Mimics CDM: Transfer extends AssetFlowBase (in different file), constructor in 3rd file
      const results = await parseAndValidateWorkspace([
        {
          uri: 'inmemory:///base-types.rosetta',
          content: `
            namespace test.scope
            version "1.0.0"

            type AssetBase:
              quantity number (0..1)
              asset string (0..1)
          `
        },
        {
          uri: 'inmemory:///transfer.rosetta',
          content: `
            namespace test.scope
            version "1.0.0"

            type Transfer extends AssetBase:
              payerReceiver string (0..1)
              transferExpression string (0..1)
          `
        },
        {
          uri: 'inmemory:///func.rosetta',
          content: `
            namespace test.scope
            version "1.0.0"

            func TestFunc:
              inputs:
                val string (1..1)
              output:
                result Transfer (1..1)
              set result:
                Transfer {
                  payerReceiver: val,
                  transferExpression: val,
                  quantity: empty,
                  asset: val
                }
          `
        }
      ]);

      const featureErrors = results.flatMap((r) => r.errors.filter((d) => d.message.includes('RosettaFeature')));
      expect(featureErrors, featureErrors.map((d) => d.message).join('\n')).toHaveLength(0);
    });

    it('should resolve constructor keys cross-namespace with import', async () => {
      // Mimics CDM: Transfer in one namespace, function in another, cross-namespace constructor
      const results = await parseAndValidateWorkspace([
        {
          uri: 'inmemory:///event-type.rosetta',
          content: `
            namespace com.event.common
            version "1.0.0"

            type AssetBase:
              quantity number (0..1)

            type Transfer extends AssetBase:
              payerReceiver string (0..1)
              transferExpr string (0..1)
          `
        },
        {
          uri: 'inmemory:///ingest-func.rosetta',
          content: `
            namespace com.ingest.payment
            version "1.0.0"
            import com.event.common.*

            func TestFunc:
              inputs:
                val string (1..1)
              output:
                result Transfer (1..1)
              set result:
                Transfer {
                  payerReceiver: val,
                  transferExpr: val,
                  quantity: empty
                }
          `
        }
      ]);

      const featureErrors = results.flatMap((r) => r.errors.filter((d) => d.message.includes('RosettaFeature')));
      expect(featureErrors, featureErrors.map((d) => d.message).join('\n')).toHaveLength(0);
    });

    it('should resolve direct constructor keys across files', async () => {
      const results = await parseAndValidateWorkspace([
        {
          uri: 'inmemory:///types.rosetta',
          content: `
            namespace test.scope
            version "1.0.0"

            type Ingredient:
              amount number (0..1)

            type Container:
              fieldA Ingredient (0..1)
              fieldB Ingredient (0..1)
          `
        },
        {
          uri: 'inmemory:///func.rosetta',
          content: `
            namespace test.scope
            version "1.0.0"

            func TestFunc:
              inputs:
                ing Ingredient (1..1)
              output:
                result Container (1..1)
              set result:
                Container {
                  fieldA: ing,
                  fieldB: ing
                }
          `
        }
      ]);

      const funcErrors = results[1]!.errors.filter((d) => d.message.includes('RosettaFeature'));
      expect(funcErrors, funcErrors.map((d) => d.message).join('\n')).toHaveLength(0);
    });
  });
});
