---
'@rune-langium/codegen': patch
---

Preserve linked fragment spellings and callback bindings when restoring projection
source coordinates, including worker ASTs without CST. Inline pattern edits retain
their native regex origins instead of being rebuilt as ordinary strings.
