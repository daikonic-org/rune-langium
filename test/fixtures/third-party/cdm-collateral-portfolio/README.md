# CDM collateral and portfolio

[Sources and checksums](sources.json) pin the CDM 7.9.0 declarations and the
original `CheckEligibilityByDetails` body. Identical dependency slices are
reused from the billing fixture and verified against this manifest. The
two declarations have no handwritten Java implementation at the pinned commit.

The [cases](cases.json) check the selected collateral schedule and its haircut,
absent products, a missing selection and a foreign schedule. They also check
total and period-only positions, empty changes and groups, separate units,
previous-state keys, and errors for unresolved or negative quantities. The
project provides issuer facts, event quantities, grouping and lineage. Both
generated targets execute the same installed Rune overrides.

The Prototype fixture uses the [pinned currency map](../currency-list/README.md)
as a Rune enum input. It converts the selected wire code to CDM's existing
currency type at the original eligibility boundary.
