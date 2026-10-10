// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generatedDirectory } from '../helpers/generated-directory.js';
import { describe, expect, it } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { createRuneDslServices } from '@rune-langium/core';
import { URI } from 'langium';
import { buildNamespaceIndexes } from '../../src/preview-schema.js';
import {
  buildGlobalTypeIndex,
  findTargetNode,
  computeStandaloneClosure,
  emitStandaloneZodSchema
} from '../../src/emit/standalone-schema.js';

const skipIfNodeLt22 = it.skipIf(Number(process.versions.node.split('.')[0]) < 22);

async function parseModels(sources: readonly string[]) {
  const { RuneDsl } = createRuneDslServices();
  const docs = sources.map((source, i) =>
    RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
      source,
      URI.parse(`inmemory:///standalone-schema-${i}.rosetta`)
    )
  );
  await RuneDsl.shared.workspace.DocumentBuilder.build(docs);
  for (const doc of docs) {
    expect(doc.parseResult.parserErrors.map((error) => error.message)).toEqual([]);
  }
  return docs;
}

describe('buildGlobalTypeIndex', () => {
  skipIfNodeLt22('merges per-namespace indexes into one flat lookup, findable by bare name', async () => {
    const docs = await parseModels([
      `
      namespace "test.alpha"
      version "1"

      type Foo:
        x string (0..1)
      `,
      `
      namespace "test.beta"
      version "1"

      type Bar:
        y string (0..1)
      `
    ]);
    const namespaceIndexes = buildNamespaceIndexes(docs);
    const globalIndex = buildGlobalTypeIndex(namespaceIndexes);
    expect(globalIndex.dataByName.has('Foo')).toBe(true);
    expect(globalIndex.dataByName.has('Bar')).toBe(true);
  });
});

describe('findTargetNode', () => {
  skipIfNodeLt22('resolves a namespace-qualified targetId to its real AST node', async () => {
    const docs = await parseModels([
      `
      namespace "test.alpha"
      version "1"

      type Foo:
        x string (0..1)
      `
    ]);
    const namespaceIndexes = buildNamespaceIndexes(docs);
    const target = findTargetNode(namespaceIndexes, 'test.alpha.Foo');
    expect(target?.kind).toBe('data');
    expect(target?.node.name).toBe('Foo');
  });

  skipIfNodeLt22('returns undefined for an unknown targetId', async () => {
    const docs = await parseModels([
      `
      namespace "test.alpha"
      version "1"

      type Foo:
        x string (0..1)
      `
    ]);
    const namespaceIndexes = buildNamespaceIndexes(docs);
    expect(findTargetNode(namespaceIndexes, 'test.alpha.DoesNotExist')).toBeUndefined();
  });
});

describe('computeStandaloneClosure', () => {
  skipIfNodeLt22('returns a closure of just the target for a scalar-only Data type', async () => {
    const docs = await parseModels([
      `
      namespace "test.alpha"
      version "1"

      type Foo:
        x string (0..1)
      `
    ]);
    const namespaceIndexes = buildNamespaceIndexes(docs);
    const target = findTargetNode(namespaceIndexes, 'test.alpha.Foo')!;
    const globalIndex = buildGlobalTypeIndex(namespaceIndexes);
    const closure = computeStandaloneClosure(target, globalIndex);
    expect(Array.from(closure.dataByName.keys())).toEqual(['Foo']);
    expect(closure.choiceByName.size).toBe(0);
    expect(closure.enumByName.size).toBe(0);
    expect(closure.typeAliasByName.size).toBe(0);
  });

  skipIfNodeLt22('walks a 2-hop alias chain to a Data type, without adding the intermediate aliases', async () => {
    const docs = await parseModels([
      `
      namespace "test.alpha"
      version "1"

      type Target:
        y string (0..1)
      typeAlias Inner: Target
      typeAlias Outer: Inner
      type Foo:
        bar Outer (0..1)
      `
    ]);
    const namespaceIndexes = buildNamespaceIndexes(docs);
    const target = findTargetNode(namespaceIndexes, 'test.alpha.Foo')!;
    const globalIndex = buildGlobalTypeIndex(namespaceIndexes);
    const closure = computeStandaloneClosure(target, globalIndex);
    expect(Array.from(closure.dataByName.keys()).sort()).toEqual(['Foo', 'Target']);
    expect(closure.typeAliasByName.size).toBe(0);
  });

  skipIfNodeLt22('does not stack-overflow on a self-referencing cyclic Data type', async () => {
    const docs = await parseModels([
      `
      namespace "test.alpha"
      version "1"

      type Node:
        children Node (0..*)
      `
    ]);
    const namespaceIndexes = buildNamespaceIndexes(docs);
    const target = findTargetNode(namespaceIndexes, 'test.alpha.Node')!;
    const globalIndex = buildGlobalTypeIndex(namespaceIndexes);
    const closure = computeStandaloneClosure(target, globalIndex);
    expect(Array.from(closure.dataByName.keys())).toEqual(['Node']);
  });

  skipIfNodeLt22('walks a Choice option across namespaces, through an alias, to an Enum', async () => {
    const docs = await parseModels([
      `
      namespace test.other
      version "1"

      enum Status: ACTIVE INACTIVE
      `,
      `
      namespace test.main
      version "1"

      import test.other.*

      typeAlias StatusAlias: Status
      choice Wrapper:
        StatusAlias
      `
    ]);
    const namespaceIndexes = buildNamespaceIndexes(docs);
    const target = findTargetNode(namespaceIndexes, 'test.main.Wrapper')!;
    const globalIndex = buildGlobalTypeIndex(namespaceIndexes);
    const closure = computeStandaloneClosure(target, globalIndex);
    expect(Array.from(closure.choiceByName.keys())).toEqual(['Wrapper']);
    expect(Array.from(closure.enumByName.keys())).toEqual(['Status']);
    expect(closure.docs.length).toBe(2);
  });

  skipIfNodeLt22('adds the typeAlias node itself when the target IS a type alias', async () => {
    const docs = await parseModels([
      `
      namespace "test.alpha"
      version "1"

      typeAlias MyAlias: int
      `
    ]);
    const namespaceIndexes = buildNamespaceIndexes(docs);
    const target = findTargetNode(namespaceIndexes, 'test.alpha.MyAlias')!;
    const globalIndex = buildGlobalTypeIndex(namespaceIndexes);
    const closure = computeStandaloneClosure(target, globalIndex);
    expect(Array.from(closure.typeAliasByName.keys())).toEqual(['MyAlias']);
    expect(closure.dataByName.size).toBe(0);
  });
});

/**
 * Turns `emitStandaloneZodSchema`'s returned TypeScript into plain,
 * `new Function`-evaluable JavaScript: drops the leading `import { z } from
 * 'zod';` line (the caller is expected to bind `z` itself — see the
 * production JSDoc on `emitStandaloneZodSchema`), strips `export `, then
 * runs the result through the real TypeScript compiler to erase remaining
 * type syntax (generics, `: Type` annotations, cyclic-type `interface`
 * predeclarations, `type X = ...` aliases). Uses `typescript-classic` — this
 * package's existing devDependency pin for the classic Compiler API (see
 * `vitest-decorator-plugin.ts`'s own comment on why TS7's `typescript`
 * package no longer exposes `transpileModule`) — rather than hand-rolling a
 * second, approximate TS-stripper; this is test-only tooling, never a
 * production `src/` dependency.
 */
async function toEvaluableJs(tsCode: string): Promise<string> {
  const ts = (await import('typescript-classic')).default;
  const withoutBoilerplate = tsCode
    .split('\n')
    .filter((line) => !/^import .*;$/.test(line))
    .map((line) => line.replace(/^export\s+/, ''))
    .join('\n');
  return ts.transpileModule(withoutBoilerplate, {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 }
  }).outputText;
}

describe('emitStandaloneZodSchema', () => {
  skipIfNodeLt22('validates function inputs through the canonical Data closure without rewriting the AST', async () => {
    const docs = await parseModels([
      `namespace test.values
enum Kind: A B
type Child:
 amount int (1..1)
 eventDate date (0..1)`,
      `namespace test.calls
import test.values.*
func Run:
 inputs:
  child Child (1..1)
  kinds Kind (1..2)
 output: result int (1..1)
 set result: child -> amount`
    ]);
    const func = buildNamespaceIndexes(docs)
      .find((ns) => ns.namespace === 'test.calls')!
      .funcByName.get('Run')!.node;
    const originalContainer = func.inputs[0]!.$container;
    const result = emitStandaloneZodSchema(docs, 'test.calls.Run', { functionInputs: true });
    expect(result.diagnostics).toEqual([]);
    expect(func.inputs[0]!.$container).toBe(originalContainer);
    expect(result.code).toContain('ChildSchema');
    expect(result.code).toContain('KindSchema');
    const { z } = await import('zod');
    const { RUNTIME_HELPER_JS_SOURCE } = await import('../../src/export.js');
    const validator = new Function(
      'z',
      'Temporal',
      `${RUNTIME_HELPER_JS_SOURCE}\n${await toEvaluableJs(result.code)}\nreturn ${result.schemaName};`
    )(z, Temporal);
    expect(validator.safeParse({ child: { amount: 2, eventDate: '2026-10-09' }, kinds: ['A'] }).success).toBe(true);
    for (const invalid of [
      {},
      { child: { amount: '2' }, kinds: ['A'] },
      { child: { amount: NaN }, kinds: ['A'] },
      { child: { amount: 2, eventDate: 'yesterday' }, kinds: ['A'] },
      { child: { amount: 2 }, kinds: [] },
      { child: { amount: 2 }, kinds: ['A', 'B', 'A'] },
      { child: { amount: 2 }, kinds: ['unknown'] }
    ])
      expect(validator.safeParse(invalid).success).toBe(false);
    expect(emitStandaloneZodSchema(docs, 'test.calls.Missing', { functionInputs: true }).diagnostics[0]?.code).toBe(
      'unknown-target'
    );
  });

  skipIfNodeLt22('produces a self-contained script with no cross-namespace import statements', async () => {
    const docs = await parseModels([
      `
      namespace test.other
      version "1"

      type Bar:
        y string (0..1)
      `,
      `
      namespace test.main
      version "1"

      import test.other.*

      typeAlias BarAlias: Bar
      type Foo:
        bar BarAlias (0..1)
      `
    ]);
    const result = emitStandaloneZodSchema(docs, 'test.main.Foo');
    expect(result.diagnostics).toEqual([]);
    // External dependencies remain; generated cross-namespace imports are
    // removed because their schemas are declared in this script.
    expect(result.code.match(/^import .*/gm)).toEqual([
      "import { z } from 'zod';",
      "import { Temporal } from '@js-temporal/polyfill';"
    ]);
    expect(result.code).toContain('BarSchema');
  });

  skipIfNodeLt22(
    'validates adapted metadata and recursive inputs without running Data conditions',
    async () => {
      const docs = await parseModels([
        `namespace test.inputStructure
annotation metadata:
 scheme string (0..1)
 reference string (0..1)
metaType scheme string
metaType reference string
type Parent:
 amount int (1..1)
 condition Positive: amount > 0
type Child extends Parent:
 textValue string (0..1)
  [metadata scheme]
 links Child (0..2)
  [metadata reference]
func Read:
 inputs:
  source Child (1..1)
  textValue string (0..1)
  referenceInput Child (1..1)
   [metadata reference]
 output: result int (1..1)
 set result: source -> amount`
      ]);
      const result = emitStandaloneZodSchema(docs, 'test.inputStructure.Read', { functionInputs: true });
      expect(result.diagnostics).toEqual([]);
      const { z } = await import('zod');
      const { RUNTIME_HELPER_JS_SOURCE, normalizePreviewInputs } = await import('../../src/export.js');
      const ts = (await import('typescript-classic')).default;
      const { RUNTIME_HELPER_SOURCE } = await import('../../src/helpers.js');
      const directory = generatedDirectory(join(tmpdir(), 'rune-input-schema-'));
      try {
        const filename = join(directory, 'schema.ts');
        writeFileSync(join(directory, 'package.json'), JSON.stringify({ type: 'module' }));
        const code = result.code.replace(/^import \{ Temporal \}.*;$/gm, '');
        writeFileSync(filename, `${RUNTIME_HELPER_SOURCE}\n${code}`);
        const program = ts.createProgram([filename], {
          target: ts.ScriptTarget.ESNext,
          module: ts.ModuleKind.NodeNext,
          moduleResolution: ts.ModuleResolutionKind.NodeNext,
          strict: true,
          skipLibCheck: true,
          noEmit: true,
          types: []
        });
        expect(
          ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
        ).toEqual([]);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
      const runtime = new Function(
        `${RUNTIME_HELPER_JS_SOURCE}\nreturn { field: runeToField, reference: runeToReference };`
      )();
      const validator = new Function(
        'z',
        `${RUNTIME_HELPER_JS_SOURCE}\n${await toEvaluableJs(result.code)}\nreturn ${result.schemaName};`
      )(z);
      const validate = (input: Record<string, unknown>) =>
        validator.safeParse(normalizePreviewInputs(docs, 'test.inputStructure.Read', input, runtime));
      // Negative values violate Parent's condition, but are structurally valid function inputs.
      const plain = validate({
        source: { amount: -1, textValue: 'text' },
        textValue: null,
        referenceInput: { globalReference: 'id' }
      });
      expect(plain.success).toBe(true);
      expect(plain.data.source).toEqual({ amount: -1, textValue: { value: 'text', meta: {} } });
      expect(plain.data.referenceInput).toEqual({ globalReference: 'id' });
      expect(plain.data.source.links).toBeUndefined();
      expect(plain.data.textValue).toBeUndefined();
      const wrapped = validate({
        source: {
          amount: 1,
          textValue: { value: 'text', meta: { scheme: 'uri' } },
          links: [{ value: { amount: 2 }, meta: {} }]
        },
        referenceInput: { value: { amount: 3 }, externalReference: 'id' }
      });
      expect(wrapped.success).toBe(true);
      expect(wrapped.data.source.textValue.meta.scheme).toBe('uri');
      expect(validate({ source: { amount: 1 }, referenceInput: { amount: 2 } }).success).toBe(true);
      for (const input of [
        { source: { amount: '1' }, referenceInput: { globalReference: 'id' } },
        { source: { amount: 1, textValue: { value: 2, meta: {} } }, referenceInput: { globalReference: 'id' } },
        { source: { amount: 1, links: [{ value: { amount: '2' } }] }, referenceInput: { globalReference: 'id' } },
        { source: { amount: 1 } }
      ])
        expect(validate(input).success).toBe(false);
    },
    30_000
  );

  /**
   * PR #470 live review finding (2026-08-04): `emitNamespace` was called
   * with `{}`, which — absent `suppressBoilerplate: true` — INLINES the
   * TypeScript-typed `RUNTIME_HELPER_SOURCE` block into `result.code`. A
   * caller following this function's own documented contract (prepend
   * `RUNTIME_HELPER_JS_SOURCE`, the JS-safe twin, separately) then got BOTH
   * blocks declaring the same `const` names — after type erasure,
   * `new Function()` threw "Identifier 'runeCheckOneOf' has already been
   * declared". Fixed by passing `suppressBoilerplate: true`, which makes
   * `emitNamespace` emit an import line instead of inlining — a line this
   * function's own cross-namespace-import stripping already removes, since
   * it matches the same `.zod.js'` shape.
   */
  skipIfNodeLt22('does not inline the runtime-helper block into the returned code', async () => {
    const docs = await parseModels([
      `
      namespace test
      version "1"

      type Foo:
        x string (0..1)
      `
    ]);
    const result = emitStandaloneZodSchema(docs, 'test.Foo');
    expect(result.code).not.toContain('runeCheckOneOf');
    expect(result.code).not.toContain('runtime helpers');
    expect(result.code).not.toMatch(/\.zod\.js/);
  });

  skipIfNodeLt22('produces a script that genuinely evaluates and validates real sample data', async () => {
    const docs = await parseModels([
      `
      namespace test.other
      version "1"

      type Bar:
        y string (0..1)
      `,
      `
      namespace test.main
      version "1"

      import test.other.*

      typeAlias BarAlias: Bar
      type Foo:
        bar BarAlias (0..1)
      `
    ]);
    const result = emitStandaloneZodSchema(docs, 'test.main.Foo');
    // RUNTIME_HELPER_JS_SOURCE mirrors what apps/studio/src/workers/codegen-worker.ts
    // already prepends before evaluating generated func bodies — reuse the same
    // export here so this test proves the real end-to-end contract, not an
    // approximation of it.
    const { RUNTIME_HELPER_JS_SOURCE } = await import('../../src/export.js');
    const { z } = await import('zod');
    const evaluableJs = await toEvaluableJs(result.code);
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const wrapper = new Function('z', `${RUNTIME_HELPER_JS_SOURCE}\n\n${evaluableJs}\nreturn FooSchema;`);
    const FooSchema = wrapper(z);
    expect(FooSchema.safeParse({ bar: { y: 'hello' } }).success).toBe(true);
    expect(FooSchema.safeParse({ bar: { y: 123 } }).success).toBe(false);
  });

  /**
   * PR #469 live review finding (2026-08-04): a target closure containing a
   * Data-extends-Choice usage emits `SpecialSchema = runeExtendChoice(...)`,
   * but `runeExtendChoice` is Zod-specific and therefore excluded from the
   * documented `RUNTIME_HELPER_JS_SOURCE` bundle (shared with the
   * zero-Zod-dependency TypeScript target) — the reference was genuinely
   * undefined at evaluation time (`ReferenceError: runeExtendChoice is not
   * defined`), not just a theoretical gap. Fixed by conditionally inlining
   * a JS-safe `runeExtendChoice` definition directly into the returned
   * `code` whenever the closure actually uses it.
   */
  skipIfNodeLt22(
    'inlines a JS-safe runeExtendChoice for a Data-extends-Choice closure, and genuinely evaluates',
    async () => {
      const docs = await parseModels([
        `
      namespace test.extendsChoice
      version "1"

      choice Wrapper:
        Cash

      type Cash:
        amount string (0..1)

      type Special extends Wrapper:
        note string (0..1)
      `
      ]);
      const result = emitStandaloneZodSchema(docs, 'test.extendsChoice.Special');
      expect(result.code).toContain('runeExtendChoice(WrapperSchema');
      expect(result.code).toContain('const runeExtendChoice = (choice, shape) =>');

      const { RUNTIME_HELPER_JS_SOURCE } = await import('../../src/export.js');
      const { z } = await import('zod');
      const evaluableJs = await toEvaluableJs(result.code);
      // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
      const wrapper = new Function('z', `${RUNTIME_HELPER_JS_SOURCE}\n\n${evaluableJs}\nreturn SpecialSchema;`);
      const SpecialSchema = wrapper(z);
      expect(SpecialSchema.safeParse({ cash: { amount: '10' }, note: 'x' }).success).toBe(true);
      expect(SpecialSchema.safeParse({ note: 123 }).success).toBe(false);
    }
  );

  skipIfNodeLt22('produces a script for a target with no dependencies at all', async () => {
    const docs = await parseModels([
      `
      namespace test
      version "1"

      type Leaf:
        x string (0..1)
      `
    ]);
    const result = emitStandaloneZodSchema(docs, 'test.Leaf');
    expect(result.code.match(/^import .*/gm)).toEqual([
      "import { z } from 'zod';",
      "import { Temporal } from '@js-temporal/polyfill';"
    ]);
    expect(result.code).toContain('LeafSchema');
  });

  skipIfNodeLt22('returns a diagnostic and empty code for an unknown targetId', async () => {
    const docs = await parseModels([
      `
      namespace test
      version "1"

      type Leaf:
        x string (0..1)
      `
    ]);
    const result = emitStandaloneZodSchema(docs, 'test.DoesNotExist');
    expect(result.code).toBe('');
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.severity).toBe('error');
  });

  skipIfNodeLt22('surfaces a genuinely unresolvable reference within the closure as a diagnostic', async () => {
    const docs = await parseModels([
      `
      namespace test
      version "1"

      type Foo:
        bar MissingType (0..1)
      `
    ]);
    const result = emitStandaloneZodSchema(docs, 'test.Foo');
    expect(result.diagnostics.some((d) => d.code === 'unresolved-ref')).toBe(true);
  });

  /**
   * PR #470 final-review finding (bot comment id 3714778810) — `extends
   * MissingParent` where `MissingParent` doesn't resolve to anything left
   * `node.superType.ref` undefined, and both `computeStandaloneClosure` and
   * `buildClosureReferenceGraph` silently treated it as "no parent at all",
   * with no diagnostic distinguishing that from a genuine no-`extends` type.
   * `node.superType` itself (the `Reference` wrapper, distinct from
   * `node.superType.ref`) is present whenever `extends X` was written in
   * source, regardless of whether `X` resolved — that's the signal used
   * here.
   */
  skipIfNodeLt22('surfaces an unresolved supertype reference as a diagnostic, without dropping the child', async () => {
    const docs = await parseModels([
      `
      namespace test
      version "1"

      type Foo extends MissingParent:
        bar string (0..1)
      `
    ]);
    const result = emitStandaloneZodSchema(docs, 'test.Foo');
    expect(result.code).toContain('FooSchema');
    expect(result.diagnostics).toContainEqual({
      severity: 'warning',
      code: 'unresolved-ref',
      message: "Data 'Foo': supertype 'MissingParent' is not resolved; inherited attributes are omitted"
    });
  });

  /**
   * PR #470 final-review finding (2026-08-04, bot comment id 3715008786) —
   * when the REQUESTED TARGET itself is a `typeAlias` whose RHS doesn't
   * resolve (e.g. `typeAlias Target: MissingType`), the closure walk's
   * frontier handling for a typeAlias node used the shared
   * `dependencyVisitor`'s no-op `onUnresolved` — the emitted
   * `TargetSchema = z.unknown()` had no corresponding diagnostic, unlike
   * the Data-supertype and Choice-option unresolved cases.
   */
  skipIfNodeLt22('surfaces an unresolved type-alias target as a diagnostic', async () => {
    const docs = await parseModels([
      `
      namespace test
      version "1"

      typeAlias Target: MissingType
      `
    ]);
    const result = emitStandaloneZodSchema(docs, 'test.Target');
    expect(result.code).toContain('TargetSchema = z.unknown()');
    expect(result.diagnostics).toContainEqual({
      severity: 'warning',
      code: 'unresolved-ref',
      message: "typeAlias 'Target': type 'MissingType' is not resolved; emitting z.unknown()"
    });
  });

  /**
   * PR #470 final-review finding (bot comment id 3714695780) — findTargetNode
   * used to silently pick whichever Data declaration dataByName happened to
   * keep (the first one seen) when two `Data`s share a name in the same
   * namespace, rather than refusing to resolve (mirrors preview-schema.ts's
   * own generatePreviewSchemas 'marks duplicate target ids as unsupported
   * instead of silently overwriting' test above).
   */
  skipIfNodeLt22(
    'returns an ambiguous-target diagnostic for a targetId matching two same-named Data declarations',
    async () => {
      const docs = await parseModels([
        `
      namespace "test.standaloneDup"
      version "1"

      type Trade:
        tradeId string (1..1)
      `,
        `
      namespace "test.standaloneDup"
      version "1"

      type Trade:
        settlementDate string (0..1)
      `
      ]);
      const result = emitStandaloneZodSchema(docs, 'test.standaloneDup.Trade');
      expect(result.code).toBe('');
      expect(result.diagnostics).toEqual([
        {
          severity: 'error',
          code: 'ambiguous-target',
          message: "Target 'test.standaloneDup.Trade' matches more than one 'Data' declaration in the loaded documents."
        }
      ]);
    }
  );

  skipIfNodeLt22('findTargetNode itself returns undefined for a duplicate-named Data target', async () => {
    const docs = await parseModels([
      `
      namespace "test.standaloneDup2"
      version "1"

      type Trade:
        tradeId string (1..1)
      `,
      `
      namespace "test.standaloneDup2"
      version "1"

      type Trade:
        settlementDate string (0..1)
      `
    ]);
    const namespaceIndexes = buildNamespaceIndexes(docs);
    expect(findTargetNode(namespaceIndexes, 'test.standaloneDup2.Trade')).toBeUndefined();
  });

  /**
   * PR #470 final-review finding (2026-08-04, bot comment id 3715080687) —
   * findTargetNode's duplicate-name guard covered only the Data branch;
   * a duplicate-named Choice target was silently resolved to whichever
   * declaration choiceByName happened to keep.
   */
  skipIfNodeLt22(
    'returns an ambiguous-target diagnostic for a targetId matching two same-named Choice declarations',
    async () => {
      const docs = await parseModels([
        `
      namespace "test.standaloneDupChoice"
      version "1"

      type Cash:
        amount string (0..1)

      choice Asset:
        Cash
      `,
        `
      namespace "test.standaloneDupChoice"
      version "1"

      type Commodity:
        quantity string (0..1)

      choice Asset:
        Commodity
      `
      ]);
      const result = emitStandaloneZodSchema(docs, 'test.standaloneDupChoice.Asset');
      expect(result.code).toBe('');
      expect(result.diagnostics).toEqual([
        {
          severity: 'error',
          code: 'ambiguous-target',
          message:
            "Target 'test.standaloneDupChoice.Asset' matches more than one 'Choice' declaration in the loaded documents."
        }
      ]);
    }
  );

  /**
   * PR #470 final-review finding (2026-08-04, bot comment id 3715080676,
   * P1) — `computeStandaloneClosure`'s bare-name-keyed maps silently let a
   * SECOND, structurally different real namespace's same-named type
   * overwrite the first: `Root` reaches `a.Left` (whose own `common`
   * attribute is `a.Common`, `x: string`) and `b.Right` (whose own
   * `common` attribute is `b.Common`, `y: number`) — two genuinely
   * DIFFERENT `Common` types. Before the fix, only ONE `const CommonSchema`
   * declaration survived, and BOTH `Left.common` and `Right.common` ended
   * up referencing it — silently validating one branch against the
   * OTHER namespace's shape. Now refuses to emit at all.
   */
  skipIfNodeLt22(
    'refuses to emit (name-collision diagnostic) when the closure reaches two different namespaces declaring the same bare name',
    async () => {
      const docs = await parseModels([
        `
      namespace "test.collideClosure.a"
      version "1"

      type Common:
        x string (0..1)

      type Left:
        common Common (0..1)
      `,
        `
      namespace "test.collideClosure.b"
      version "1"

      type Common:
        y number (0..1)

      type Right:
        common Common (0..1)
      `,
        `
      namespace "test.collideClosure.root"
      version "1"

      import test.collideClosure.a.*
      import test.collideClosure.b.*

      type Root:
        left Left (0..1)
        right Right (0..1)
      `
      ]);
      const result = emitStandaloneZodSchema(docs, 'test.collideClosure.root.Root');
      expect(result.code).toBe('');
      expect(result.diagnostics).toEqual([
        {
          severity: 'error',
          code: 'name-collision',
          message:
            "Two different namespaces in the closure each declare a 'Data' named 'Common'; the synthesized script cannot distinguish them."
        }
      ]);
    }
  );

  /**
   * PR #470 final-review finding (2026-08-04, bot comment id 3715339833,
   * P1) — the collision guard above only compared within the SAME kind's
   * own bare-name map (dataByName vs. dataByName), so a closure reaching
   * `ns.a.Common` as an Enum and `ns.b.Common` as a Data was invisible:
   * `emitNamespace` emits BOTH as `export const CommonSchema`, one shared
   * symbol namespace across every kind — two declarations of the same
   * `const` either fails TS erasure or binds ambiguously at evaluation
   * time. Now checked against one shared `emittedSchemaNames` map instead
   * of four separate per-kind ones.
   */
  skipIfNodeLt22(
    'refuses to emit (name-collision diagnostic) for a CROSS-KIND collision (Enum vs. Data) across namespaces',
    async () => {
      const docs = await parseModels([
        `
      namespace "test.collideClosureKind.a"
      version "1"

      enum Common: FOO BAR

      type Left:
        common Common (0..1)
      `,
        `
      namespace "test.collideClosureKind.b"
      version "1"

      type Common:
        y number (0..1)

      type Right:
        common Common (0..1)
      `,
        `
      namespace "test.collideClosureKind.root"
      version "1"

      import test.collideClosureKind.a.*
      import test.collideClosureKind.b.*

      type Root:
        left Left (0..1)
        right Right (0..1)
      `
      ]);
      const result = emitStandaloneZodSchema(docs, 'test.collideClosureKind.root.Root');
      expect(result.code).toBe('');
      expect(result.diagnostics.some((d) => d.code === 'name-collision')).toBe(true);
    }
  );

  /**
   * PR #470 final-review finding (2026-08-04, bot comment id 3714316831) —
   * re-raised against the latest tip; verifies (rather than re-fixes) that
   * `emitStandaloneZodSchema` genuinely inherits the schemaRefExpr fix
   * already landed in zod-emitter.ts (PR #469, reused here UNMODIFIED): an
   * acyclic Data depending on a cyclic one must not throw a TDZ
   * ReferenceError at evaluation time.
   */
  skipIfNodeLt22('an acyclic target depending on a cyclic Data evaluates without a TDZ ReferenceError', async () => {
    const docs = await parseModels([
      `
      namespace test.standaloneAcyclicDependsOnCyclic
      version "1"

      type Node:
        child Node (0..1)

      type Root:
        n Node (0..1)
      `
    ]);
    const result = emitStandaloneZodSchema(docs, 'test.standaloneAcyclicDependsOnCyclic.Root');
    expect(result.code).toContain('n: z.lazy(() => NodeSchema).optional()');
    const { RUNTIME_HELPER_JS_SOURCE } = await import('../../src/export.js');
    const { z } = await import('zod');
    const evaluableJs = await toEvaluableJs(result.code);
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const wrapper = new Function('z', `${RUNTIME_HELPER_JS_SOURCE}\n\n${evaluableJs}\nreturn RootSchema;`);
    const RootSchema = wrapper(z);
    expect(RootSchema.safeParse({ n: { child: {} } }).success).toBe(true);
  });

  /**
   * PR #470 final-review finding (2026-08-04, bot comment id 3714443467) —
   * re-raised against the latest tip; verifies a mutually-recursive Choice
   * <-> Choice pair (no Data intermediate) evaluates without a TDZ
   * ReferenceError, inherited from zod-emitter.ts's emitChoiceSchema
   * unconditional wrap of a cyclic option reference (PR #469).
   */
  skipIfNodeLt22('a mutually-recursive Choice <-> Choice pair evaluates without a TDZ ReferenceError', async () => {
    const docs = await parseModels([
      `
      namespace test.standaloneChoiceMutualCycle
      version "1"

      choice A:
        B

      choice B:
        A
      `
    ]);
    const result = emitStandaloneZodSchema(docs, 'test.standaloneChoiceMutualCycle.A');
    expect(result.code).toContain('export const ASchema = z.union([z.strictObject({ b: z.lazy(() => BSchema) })]);');
    const { RUNTIME_HELPER_JS_SOURCE } = await import('../../src/export.js');
    const { z } = await import('zod');
    const evaluableJs = await toEvaluableJs(result.code);
    // A and B reference only each other (no non-recursive leaf attribute),
    // so no FINITE payload can ever satisfy either — this test's own
    // signal is that DEFINING the schemas (evaluating `wrapper(z)`) does
    // not throw a TDZ ReferenceError, not that parsing succeeds.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const wrapper = new Function('z', `${RUNTIME_HELPER_JS_SOURCE}\n\n${evaluableJs}\nreturn { ASchema, BSchema };`);
    const { ASchema, BSchema } = wrapper(z);
    expect(ASchema).toBeDefined();
    expect(BSchema).toBeDefined();
    expect(ASchema.safeParse({ b: {} }).success).toBe(false);
    expect(() => ASchema.safeParse({ b: {} })).not.toThrow();
  });
});
