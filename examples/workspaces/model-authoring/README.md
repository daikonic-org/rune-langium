# Model authoring

A small, standalone Rune workspace: enter a quote, double its amount with Rune,
and retain the input, workflow and form presentation as ordinary files.
No reference download, login or business-function provider is required.

Open this directory as a Studio workspace, or copy its files into your own
repository. In Prototype, open **Double quote** from **Saved workflow**, then
choose **Execute**. The input is `{ "amount": 10, "currency": "USD" }`; the expected
result is `{ "amount": 20, "currency": "USD" }`. Use **Save as example…** to retain
a result. Execution alone does not write another example.

The Amount control uses USD display formatting. Formatting never rounds the
stored number. Quote layout, workflow bindings and example identities live in
`layouts/`, `workflows/` and `examples/`. The checked expected result is intentional
fixture data under `fixtures/expected/`. Generated code and ordinary exports are
ignored; credentials, handles and personal panel layout do not belong here.

`rune-config.yml` contains upstream Rune model settings. Native build targets are
named in `build-config.yml`, and Studio file roots in `studio-config.yml`.
There is no default target. After building rune-langium, run from its repository root:

```sh
node packages/cli/dist/index.js build --project examples/workspaces/model-authoring --target typescript
node packages/cli/dist/index.js build --project examples/workspaces/model-authoring --target schema
```

This source example is MIT licensed. The published
[rune-starter](https://github.com/daikonic-org/rune-starter) GitHub template packages
this workspace with pinned toolchain verification. The
[rune-cdm-example](https://github.com/daikonic-org/rune-cdm-example) repository was
generated from that template and adds a verified CDM release and amount-adjustment
workflow. The launcher pins checked revisions of both repositories. Opening a
public copy grants no writable push remote. Use the template, fork, clone or
explicitly connect your own repository to commit changes.

## Reference implementation demonstration

The separate owned fixture at
[`packages/project-runtime/test/fixtures/implementations`](../../../packages/project-runtime/test/fixtures/implementations/)
contains an empty reference `Double`, a reference `Caller`, and an explicit local
replacement computing `value * 2`. Tests inject a checked immutable cohort, prove
`Caller(10) = 20`, reject missing required input, and show that removing the mapping
restores an unavailable implementation. Its `fixture-1` tag and `org/cdm` transport
identity are test data, not an upstream CDM release or a published service.
The browser journey uses a typed Quote wrapper around that same reference caller.
This standalone starter uses only local Rune so it can run without that fixture
transport.

## Capability boundaries

This example implements only multiplication of a supplied number. It does not
implement a CDM payment schedule, external observations, pricing, decimal parity,
holiday calendars or business-day adjustment. Reference models may require
providers for those operations even when their types load successfully.

Pinned CDM/FpML Maven evidence is recorded in the repository's
[`project-import` fixture inventory](../../../test/fixtures/third-party/project-import/README.md).
That inventory preserves exact upstream commits and metadata hashes. Java plugins,
generators and dependencies are import evidence; Studio does not execute Maven,
install Java implementations or translate them automatically to Rune. Native
capability reports must identify unresolved functions, resources and targets.

| Pinned metadata requirement | Native status in this example |
| --- | --- |
| CDM `CodeListTransformer` (`exec-maven-plugin`) converts code-list XML to JSON. | Java transformation is not executed. A mapped, checked JSON resource is required for native code-list validation. |
| CDM copies `rune-fpml:rosetta-source` Rune files from a Maven dependency. | Dependency coordinates require an explicit exact release mapping; they are not treated as a floating reference or downloaded by Maven. |
| CDM declares `strata-basics`, `rune-common` and `rune-runtime`. | Java implementation availability is not implied by these declarations. No Strata calendar or financial provider is installed. |
| FpML invokes `rune-maven-plugin` and registers `src/generated/java`. | Java generation remains unavailable. This example's TypeScript and JSON Schema targets use the native generators explicitly. |
| Build-produced or filtered Rune source, schemas and code lists. | They must be supplied as checked project/reference files. A successful metadata import does not manufacture missing inputs. |

These rows inventory the pinned build metadata, not every native function in the
full upstream models. Per-function capability diagnostics remain the authority
for a selected workflow. Schedules, external observations, decimal parity and
calendar/business-day behavior require separate implementation and parity tests.
