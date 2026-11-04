---
'@rune-langium/core': patch
'@rune-langium/codegen': patch
---

Share Choice wire normalization between generated model APIs and preview adapters,
preserving wrapper headers and key metadata. Keep Data extending Choice as typed
Data during serialization, and validate required fields on matching external type
headers instead of accepting the header alone.
