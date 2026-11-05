---
'@rune-langium/codegen': patch
'@rune-langium/studio': patch
---

Emit model and field decorators backed by shared lazy metadata, with equivalent
registration calls for type-erasing execution hosts. Keep inherited cardinalities,
cyclic traversal and generated namespace types intact while removing repeated
runtime selection tables. Validate nested polymorphic values with their concrete
generated Zod codecs during JSON decoding and encoding.
