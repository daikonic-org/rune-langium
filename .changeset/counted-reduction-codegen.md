---
'@rune-langium/codegen': patch
---

Recognize linked counted lookup and collection reductions in shared Codegen
analysis. Remove temporary step records and prefix copies in executable
TypeScript/Python, and fuse pure unbound TypeScript lookup chains into an indexed
pass. Preserve ordinary lowering for unmatched shapes and effect/binding barriers.
