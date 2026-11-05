---
'@rune-langium/core': patch
'@rune-langium/visual-editor': patch
---

Parse qualified annotation names and resolve built-in transform arguments to
import-aliased schemas or serialization-format values, retaining legacy annotation
attribute identities and preserving qualified schema references during hydration.
Regenerate the authoritative AST and Inspector reference schemas.
