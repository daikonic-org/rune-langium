# CDM functions in Rune

These owned Rune sources implement four CDM 7.9.0 functions using the standard
`override namespace` syntax. They require the linked CDM model and its matching
Rune standard library. They use no installed JavaScript callbacks.

| Source | Function | Behavior |
| --- | --- | --- |
| [event-common.rosetta](../../../packages/project-runtime/src/curated-implementations/rune/event-common.rosetta) | `EmptyExecutionDetails` | Returns an absent optional value. |
| [event-common.rosetta](../../../packages/project-runtime/src/curated-implementations/rune/event-common.rosetta) | `EmptyTransferHistory` | Returns an empty list. |
| [date-list.rosetta](../../../packages/project-runtime/src/curated-implementations/rune/date-list.rosetta) | `PopOffDateList` | Removes the last position, retaining earlier duplicate dates. |
| [frequency.rosetta](../../../packages/project-runtime/src/curated-implementations/rune/frequency.rosetta) | `PeriodsInYear` | Converts CDM frequency to the shared Rune Strata library and calls its exact `EventsPerYear` function. |

Curated publication includes the canonical files from project-runtime. Reference
installation copies them from that verified bundle into
`model/implementations/cdm/`, with provenance and the MIT license. They become
normal editable workspace sources; refresh preserves local edits. For manual
installation, copy the chosen files into a selected source directory. For
`PopOffDateList`, also include
[date-list-state.rosetta](../../../packages/project-runtime/src/curated-implementations/rune/date-list-state.rosetta). For example:

```yaml
sources:
  - model/**/*.rosetta
  - implementations/**/*.rosetta
```

For `PeriodsInYear`, also copy
[`strata-frequency.rosetta`](../../../packages/project-runtime/src/curated-implementations/rune/strata-frequency.rosetta)
and its accompanying `strata-LICENSE.txt` / `strata-NOTICE.txt`. The library is in
`com.opengamma.strata.basics.schedule`; CDM-specific constraints stay in its adapter.

Open or build the project normally. Core links CDM callers to these declarations;
TypeScript export, Python projection and Prototype then consume the same Rune
bodies. No explicit declaration-redirect mapping is needed. An existing override
for the same function must be replaced or excluded before adding another one;
competing overrides are diagnosed rather than silently ordered.

These are real project sources. Omitting them leaves those original CDM native
declarations unavailable unless an explicit project binding is supplied. There is
no second language-specific `PopOffDateList` implementation. Its Rune reduction
copies the accumulated prefix at each step, which remains a limitation for very
large lists.

The [inventory](../../../docs/implementations/README.md) verifies these exact
source bytes and callable signatures against the full pinned reference cohort.
Tests also execute owned minimal callers in all TypeScript layouts, Python and
the real Prototype worker, including empty/single/duplicate dates, source and
serialized references, removal and signature drift. This is a first milestone
for [#646](https://github.com/daikonic-org/rune-langium/issues/646), not full CDM coverage.
