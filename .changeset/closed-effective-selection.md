---
'@rune-langium/codegen': patch
'@rune-langium/project-runtime': patch
---

Skip dependency-provenance propagation when every effective declaration is
already explicitly selected. Preserve namespace overrides and partial-export
dependency closure while avoiding whole-corpus work in generated previews.
Reference review also avoids constructing a baseline graph when there are no
saved example, workflow or presentation schemas to compare. Proposed graph
validation remains unchanged.
