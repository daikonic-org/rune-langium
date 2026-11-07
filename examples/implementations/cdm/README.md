# CDM functions in Rune

These owned Rune sources implement three CDM 7.9.0 functions using the standard
`override namespace` syntax. They require the linked CDM model and its matching
Rune standard library. They use no installed JavaScript callbacks.

| Source | Function | Behavior |
| --- | --- | --- |
| [event-common.rosetta](event-common.rosetta) | `EmptyExecutionDetails` | Returns an absent optional value. |
| [event-common.rosetta](event-common.rosetta) | `EmptyTransferHistory` | Returns an empty list. |
| [date-list.rosetta](date-list.rosetta) | `PopOffDateList` | Removes the last position, retaining earlier duplicate dates. |

Copy the chosen `.rosetta` files into a source directory selected by your
project's `build-config.yml`. For `PopOffDateList`, also include
[date-list-state.rosetta](date-list-state.rosetta). For example:

```yaml
sources:
  - model/**/*.rosetta
  - implementations/**/*.rosetta
```

Open or build the project normally. Core links CDM callers to these declarations;
TypeScript export, Python projection and Prototype then consume the same Rune
bodies. No explicit declaration-redirect mapping is needed. An existing override
for the same function must be replaced or excluded before adding another one;
competing overrides are diagnosed rather than silently ordered.

These are explicit project sources, not automatically installed native defaults.
Omitting the clearing source leaves those original CDM functions unavailable.
Omitting the date-list override retains the existing bundled native implementation.
The Rune date-list reduction copies its accumulated prefix at each step, so the
native implementation remains more suitable for very large lists.

The [inventory](../../../docs/implementations/README.md) verifies these exact
source bytes and callable signatures against the full pinned reference cohort.
Tests also execute owned minimal callers in all TypeScript layouts, Python and
the real Prototype worker, including empty/single/duplicate dates, source and
serialized references, removal and signature drift. This is a first milestone
for [#646](https://github.com/daikonic-org/rune-langium/issues/646), not full CDM coverage.
