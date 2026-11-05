---
'@rune-langium/codegen': patch
---

Avoid repeated subtree processing in generated Zod serialization. Derive per-node
companions from the canonical schema builder and let the shared walker dispatch
concrete child codecs once per pass. Preserve recursive public codecs, native
values, authored constraints, metadata and subtype validation.
