---
'@rune-langium/codegen': patch
'@rune-langium/core': patch
---

Share shape validation through recursive factory construction without retaining
trusted state for later mutations. Preserve inherited creators across inline
namespace modules and derive Zod subclasses of foreign recursive parents from
the canonical cycle information. Qualify native pattern references with
globalThis.RegExp so authored RegExp models remain usable.
