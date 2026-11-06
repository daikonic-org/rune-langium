---
'@rune-langium/core': patch
---

Guard scope construction and type inference together so nested extraction aliases
with unavailable input types produce unresolved-reference diagnostics instead of
re-entering an in-progress feature link.
