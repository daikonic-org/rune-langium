---
'@rune-langium/codegen': patch
'@rune-langium/visual-editor': patch
'@rune-langium/lsp-server': patch
---

Simplify typed TypeScript body projections with object equality methods, named narrowing guards, native presence checks, enum switches and plain function calls. Combine inspector documentation and annotations, retain readonly child metadata and allow function editors to fill their available space.

Settle late diagnostic/logging notifications when a WebSocket disconnects during sending, preserving other send failures.

Export TypeScript enum value objects so displayed enum members resolve in generated modules, preserving JSON strings and protecting runtime-reserved names through the shared allocator.

Preserve output cardinality in projected switch statement returns through the shared assignment value renderer.
