---
'@rune-langium/core': patch
'@rune-langium/codegen': patch
'@rune-langium/project-config': patch
'@rune-langium/project-runtime': patch
'@rune-langium/visual-editor': patch
---

Apply native `override namespace` declarations through shared linking, generation and editor selection. Studio Modify retains original qualified names, preserves verified provenance and protects immutable siblings. Keep same-namespace editable files separate during source synchronization and retain the override marker on source rendering.

Keep Inspector declaration headings at the second level while source edits parse, preserving heading order independently of panel arrangement.

Validate native callable replacements with the same signature, type-argument and cardinality comparison as configured overrides, including positional parameter order. Reject incompatible native replacements in bare Rune validation and captured project activation.

Prioritize the selected Inspector declaration's verified linked closure ahead of unrelated functions in the same namespace, while retaining whole-namespace readiness and failure handling.
