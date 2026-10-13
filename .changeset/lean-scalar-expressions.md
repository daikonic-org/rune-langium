---
'@rune-langium/codegen': patch
---

Emit native enum and boolean comparisons, null and collection presence checks,
and guarded optional primitive comparisons over typed values. Remove scalar and
enum literal casts while retaining enum inference through constructors and
cardinality boundaries. TypeScript condition previews use a false fallback;
executable validation and missing function values retain their existing semantics.
