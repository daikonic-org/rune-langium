# Namespace aliases and hosted semantic snapshots

## Reproduction

The production `GetFpmlEquityExercise` view displayed unresolved `fpml.Exercise`
and `fpml.EquityExerciseValuationSettlement` chips despite loading their models.
The source imports several namespaces with the same `fpml` alias. Core already
supports that syntax; UI projections had discarded the declaring file's imports.
Alias expansion now uses Core's shared ordered candidate builder, with bindings
retained per declaration rather than namespace. This also covers files sharing a
namespace but using different aliases, inherited rows and canonical navigation.
Authored labels remain unchanged. Overriding an inherited field resolves its
parent-file alias to a qualified reference in the child's source.

An isolated production browser replay also reproduced the reported LSP timeout.
The final publish retained 183 semantic documents; prior uploads were acknowledged,
but publication had no response after 30,014 ms. A concurrent read-only Cloudflare
tail reported that the Durable Object isolate exceeded its memory limit and reset.
This identifies a server memory failure, not evidence for increasing the timeout.
User browser tabs and their state were preserved; no deployment was performed.

## Language-server change

Closed semantic dependencies need exports and local scopes, without an eager link
of every function body. They now resolve references lazily through the real
Langium linker. Live source still links and validates normally. Lazy references
do not populate Langium's reverse-reference index: source changes therefore clear
cached dependency targets and rebuild the actual open source set. A JSON-RPC
regression changes an inner type through `didOpen` and verifies refreshed diagnostics
in another open source through an intermediate snapshot. Close/restore, removal,
changed dependency and definition-navigation checks remain enabled.

## Local measurements and limits

The pinned local artifacts contain 145 CDM and 42 FpML documents (187 total),
42,854,608 compact JSON bytes. This is a different cohort from the production
183-document reproduction, so these results are not a deployed before/after claim.

| Local Node replay phase | Former eager snapshot linking | Lazy snapshot linking |
| --- | ---: | ---: |
| Upload | 721 ms | 687 ms |
| Publish | 16,185 ms | 142 ms |
| Snapshot documents eagerly linked | 187 | 0 |
| Open selected source | 295 ms | 221 ms |
| Selected source error diagnostics | 0 | 0 |

Node used `--max-old-space-size=256` and explicit collection for measurements;
its heap/RSS do not establish a Cloudflare isolate memory bound. A local Workerd
Durable Object using the final built LSP server accepted all 187 documents and
returned HTTP 200 for publication in 289 ms (284 ms inside the Worker). This
verifies the hosted runtime locally, not production deployment or acceptance.

## Verification

- Core: 369 tests, including ordered repeated alias expansion and special names.
- Visual editor: graph edges, Structure kinds, Inspector navigation and ancestor
  file scopes, plus the complete package suite.
- LSP server: 80 tests; hosted worker: 43 tests.
- Browser: repeated aliases navigate the correct declaration rather than an
  unrelated same-named type. Shared tree checks cover 1280 px and 800 px.
- Studio typography and hairlines use one shared body profile, also imported by
  component-design previews. Explorer, Inspector, forms, Export, Settings and a
  portaled workspace picker were visually checked; source keeps its mono face.

The final full suites passed 1,684 visual-editor and 2,091 Studio tests (two
existing Studio skips). Browser checks passed nine tree/alias/workspace journeys
and five enum journeys, including returning an open Details section to Values.
Source lint, workspace types, Studio stylesheet checks and the production build
passed. The shared Dockview stylesheet still reports the same 24 preexisting
Stylelint findings as HEAD; comparison ignores line-number movement only.
An initial concurrent full run missed the unchanged 100 ms rename-cascade budget;
the fresh full run passed without altering that budget. The final Impeccable
layout and typography detectors reported no findings.

Full phone Explorer layout remains a separate host-layout limit: its crowded
panel can be only 92 px wide. Narrow chrome and expression checks do not claim
that this entire tree layout is usable on a phone. Production verification awaits
an authorized merge and the hosted Worker deployment lifecycle.
