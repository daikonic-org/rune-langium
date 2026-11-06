// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Zod-only runtime helper source text — sibling to `../helpers.ts`
 * (RUNTIME_HELPER_SOURCE), but kept SEPARATE because it depends on the
 * `z` namespace. `../helpers.ts`'s helpers are inlined into BOTH the Zod
 * and TypeScript targets (ts-emitter documents "zero Zod dependency" as a
 * hard invariant — see ts-emitter.ts's file doc comment), so a `z`-typed
 * helper cannot live there without breaking that invariant.
 *
 * `runeExtendChoice` backs Data-extends-Choice emission (a `Data` whose
 * `superType` is a `Choice` — real corpus case: `BasketConstituent extends
 * Observable`). Per docs/superpowers/specs/2026-07-02-data-extends-choice-
 * design.md: the child is DERIVED from the Choice's emitted union schema
 * at module-init (distributing the child's own attributes across every
 * arm), not statically decomposed into a hand-unrolled union — the Choice
 * schema remains the single runtime source of truth.
 *
 * `.extend()` on a `z.strictObject` arm preserves strictness (verified
 * empirically against zod v4.4.3 — see the design spec's Verification
 * point 1), so distributing across `z.strictObject` arms keeps the
 * exactly-one-of-plus-extras shape structurally enforced with no extra
 * runtime check needed here.
 */
export const RUNE_EXTEND_CHOICE_HELPER_SOURCE: string =
  `function runeExtendChoice<T extends z.ZodUnion<readonly z.ZodObject[]>, S extends z.ZodRawShape>(choice: T, shape: S): z.ZodType<z.output<T> & z.output<z.ZodObject<S>>, z.input<T> & z.input<z.ZodObject<S>>>;\n` +
  `function runeExtendChoice(choice: z.ZodUnion<readonly z.ZodObject[]>, shape: z.ZodRawShape) {\n` +
  `  return z.union(choice.options.map((arm) => arm.extend(shape)));\n}`;

/**
 * Exported variant for the shared `runtime.zod.ts` sidecar (mirrors
 * how `zod-profile.ts`'s `RUNTIME_SIDECAR_SOURCE` re-declares `../helpers.ts`'s
 * helpers with exports so per-namespace files can import them when
 * `suppressBoilerplate: true`).
 */
export const RUNE_EXTEND_CHOICE_HELPER_SIDECAR_SOURCE: string = RUNE_EXTEND_CHOICE_HELPER_SOURCE.replaceAll(
  'function runeExtendChoice',
  'export function runeExtendChoice'
);

/**
 * Plain JavaScript equivalent of `RUNE_EXTEND_CHOICE_HELPER_SOURCE` — no
 * type annotations, mirroring `../helpers.ts`'s `RUNTIME_HELPER_JS_SOURCE`
 * twin of `RUNTIME_HELPER_SOURCE`. Needed because `standalone-schema.ts`'s
 * `emitStandaloneZodSchema` produces directly `new Function`-evaluable
 * output for a target closure that may contain a Data-extends-Choice
 * usage, and `RUNTIME_HELPER_JS_SOURCE` deliberately excludes this helper
 * (it's Zod-specific — `../helpers.ts`'s own helpers are shared with the
 * zero-Zod-dependency TypeScript target, so a `z`-typed helper cannot live
 * there without breaking that invariant).
 */
export const RUNE_EXTEND_CHOICE_HELPER_JS_SOURCE: string =
  `const runeExtendChoice = (choice, shape) =>\n` + `  z.union(choice.options.map((arm) => arm.extend(shape)));`;
