---
'@rune-langium/codegen': patch
---

Support both key selectors and native sort comparators on projected arrays,
using callback parameter count, with an explicit comparator form for ambiguous
default/rest callbacks. Preserve JSON array shape on projected arrays.
Preserve native in-place reversal and supplied array-callback receivers.
Avoid repeated subtree validation while reading materialized recursive models,
while retaining fresh mutation and factory checks. Emit native regex literals
for metadata-wrapped pattern values without converting metadata strings.
