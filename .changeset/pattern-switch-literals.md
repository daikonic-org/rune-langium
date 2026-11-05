---
'@rune-langium/codegen': patch
---

Emit regex literals for pattern-valued switch results in TypeScript exports and
source projections, including nested arms and field/argument destinations. Keep
switch selectors, guards and ordinary string results as strings. Propagate native
pattern destinations through extract, then and reduce result bodies, preserving
strings in callback inputs, predicates and sorting keys.
