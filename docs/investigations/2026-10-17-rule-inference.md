# Reporting and eligibility rule inference

The Vehicle Emissions demo at `rosetta-models/demo` commit
`b94474090da78493d256edede6cfd2b87aa94dd2` exposed two inference gaps:

- Navigation from another reporting rule did not infer its returned type. Three
  references failed after calls to the `Engine` rule, which also shares its name
  with an imported Data declaration.
- A root `item` in a rule did not use the rule's declared input. Six registration
  rules each failed twice when navigating through the `Vehicle` Choice.

All 17 demo source files parsed. With the current Rune dependency documents,
linking reported 15 unresolved references before the fix and zero afterward.
This verifies source linking, not complete semantic validation or execution of
all demo functions. The external demo is not copied into the repository or
published as a curated model by this change.

## Resolution

Core resolves rule results through the existing guarded expression inference
used for aliases. Root implicit variables fall back to the enclosing rule's
input after collection and switch bindings have been considered. Negative tests
verify that unrelated fields do not become available through global fallback.
Mutually recursive rules terminate without inventing a result type.

Codegen follows rule expressions in its shared type, cardinality and collection
analysis. Generated TypeScript imports Choice rule input types. Python uses one
branch renderer for conditionals and switches, including scalar `empty` results;
this prevents a downstream scalar navigation from reading an empty list as an
object. Shared fixtures exercise both present and absent Choice arms and scalar
and collection rule calls through strictly compiled TypeScript and executed
Python.

## Why the corpus missed it

The saved Python projection report inspected during diagnosis covered 1,295
functions and 929 conditions across Rune, FpML and CDM, but **zero rules**. It
reported zero syntax exclusions and zero unlinked declarations for that cohort;
there is no evidence these particular errors were hidden in the scanned models.
The Vehicle Emissions demo was not among the three corpus sources.

Core's CDM grammar census checks parsing rather than workspace linking. The
optional projection census records and excludes syntax-invalid documents and
unlinked declarations, then checks the remaining generated Python syntax. Its
green result alone is not a full workspace linkage guarantee. The curated
artifact builder separately requires every selected document to pass
`assertValidDocuments` before publication.

The new authored fixtures in `test/fixtures/regressions/rule-inference/` are
always present. Core requires correct reference ownership and scope isolation;
codegen requires successful linking, strict generated TypeScript compilation,
and runtime results in both languages. They do not depend on optional local
corpus checkouts.
