---
'@rune-langium/codegen': patch
---

Preserve native sort comparators and JSON array shape on projected arrays.
Avoid repeated subtree validation while reading materialized recursive models,
while retaining fresh mutation and factory checks. Emit native regex literals
for metadata-wrapped pattern values without converting metadata strings.
