---
'@rune-langium/core': patch
'@rune-langium/project-runtime': patch
'@rune-langium/studio': patch
---

Reuse canonical source-pack presence metadata during curated installation. Warm
workspace loading skips unrelated serialized model JSON while present packs
retain their original source, checksum and provenance checks. Invalidate stale
derived metadata and include actual timing overruns in candidate UX gate errors.
Overlap document hashing and derived-cache waits through a bounded worker queue.
