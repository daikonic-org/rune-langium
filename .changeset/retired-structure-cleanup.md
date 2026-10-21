---
'@rune-langium/visual-editor': minor
'@rune-langium/codegen': minor
'@rune-langium/cli': patch
---

Remove retired XYFlow Structure renderers, layout exports, unused editor/history
helpers and test-only graph lookup APIs from the visual-editor runtime. Use the
current DOM StructureView and canonical editor store APIs instead. Consolidate
Dagre geometry, row reordering, cardinality and inheritance helpers.

Share codegen importer identifier policies, emitter lookup adaptation, bundled
preamble removal and Python/TypeScript lens mechanics. Remove the unused import
hasFatalImportDiagnostics export and internal namespace-symbol lookup. CLI
commands now share recursive Rune file discovery with unchanged input semantics.

Allow Graph overviews below the previous 50% zoom floor and keep selected-type
camera fitting in the graph, preventing Studio's duplicate whole-graph fit from
overwriting readable navigation.

Clarify function input/output sections, tighten choice and enum rendering, and
use the shared bottom inset for Structure canvas height. Keep every enum value
reachable without an Inspector callback and omit unsupported function expansion
controls while retaining referenced-type navigation.
