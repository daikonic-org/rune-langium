---
'@rune-langium/codegen': minor
---

Project generated factories, object fields and deep selections to cardinality-shaped
values: undefined, a scalar/model, or an array-backed RuneList. Replace public
RuneView/unwrap usage with cardinality aliases and bounded tuples. Cache private
RuneValue field slots behind RuneObject proxies, validate writes before committing,
and serialize canonical collection storage. Normalize exported collection operations
and assignment paths for scalar-or-array structural inputs.
