---
description: "The main barrel (`@rune-langium/codegen`, i.e. this file, resolved via\npackage.json's `\".\"` export) is intentionally empty."
name: rune-langium-codegen
---

# @rune-langium/codegen

The main barrel (`@rune-langium/codegen`, i.e. this file, resolved via
package.json's `"."` export) is intentionally empty.

Spec 021 Phase 2's subpath restructure ("CLEAN FLIP") splits this
package's public API by direction — nothing in it is genuinely shared
between the two, so the main barrel exports nothing:

- `@rune-langium/codegen/export` — the outbound (Rune → target-language)
  surface: `generate()`, `generatePreviewSchemas()`, every emitter
  contract/option type, `TARGET_DESCRIPTORS`, etc.
- `@rune-langium/codegen/import` — the inbound (source → Rune) surface:
  `importModel()`, `SourceModel`/`ConstraintIR` types, the CLI's
  `runImport`, and import diagnostics.
- `@rune-langium/codegen/rosetta` — UNCHANGED: the shared, browser-safe
  `.rosetta` render-core consumed by both directions (the outbound
  emitters render Rune AST to `.rosetta` text; the inbound importer
  renders its built AST-shaped nodes the same way).

Import from the subpath that matches what you need; do not add exports
here unless a symbol is genuinely used by both `/export` and `/import`
(as of this restructure, nothing is — `/rosetta` already covers the one
case that legitimately spans both directions).

## Links

- Author: Pradeep Mouli <pmouli@mac.com> (https://github.com/pradeepmouli)