# Safari reference-loading memory investigation

## Report and scope

An iPhone Safari page process repeatedly failed while the saved reference models
were loading, before the namespace explorer finished hydration. Interaction is
not required; the report says the workspace becomes stable after loading. An
older Dockview/React exception is separate evidence and has not been established
as the cause of this process failure.

The physical iPhone process failure was not reproduced. A persistent Playwright
WebKit 27.2 context with the iPhone 13 viewport loaded CDM, reopened the workspace,
waited for automatic receipt acknowledgement without interaction, then selected
BusinessCenters and TradeState successfully. This is host WebKit evidence, not a
physical-device memory-limit test. Ephemeral WebKit contexts could not open OPFS;
the replay used a disposable persistent profile instead of changing app storage.

## Confirmed allocations and changes

Allocation sampling of master `79c1f976` identified avoidable copies during startup:

- Source synchronization retained a roughly 67 MB joined content fingerprint
  containing read-only reference declarations. Its existing writable source
  baseline already excludes those namespaces. The fingerprint now uses that
  same boundary and outgoing edges; canonical reference ASTs remain intact.
- LSP preparation compacted every model before discovering the active semantic
  closure, retaining roughly 59 MB of compact payloads. It now builds compact
  payloads only for that closure, releases payloads outside it, and releases the
  cache entirely when no editor/override root needs models. Dependency metadata
  still uses the shared Core reader and all override roots remain included.
- Managed preview messages carried serialized references both in the captured
  project and the parallel file inventory. The inventory now carries source,
  URI and a reference marker; the captured project remains the sole AST payload.
  Legacy messages retain their serialized-file path. Projection source checks,
  receipt acknowledgement and stale-generation rejection remain authoritative.

Each defect has a preserved regression that failed before its change. The shared
real-worker, projection, source-edit and save-barrier tests check the adjoining
behavior rather than replacing semantic validation with a memory shortcut.

## Controlled replay

Baseline and modified production builds ran on separate local preview ports with
fresh Chromium contexts, the same iPhone viewport and public reference bytes.
The harness relayed the public artifacts/parse endpoint for local-origin CORS;
both local builds used the same offline LSP transport. Hosted LSP availability is
not established by this comparison. Sampling and steps were identical: create a
disposable workspace, accept CDM Nightly, select BusinessCenters, reopen, wait for
automatic project receipt acknowledgement, select BusinessCenters and TradeState.

The verified cohort was
`cohort-e7a48fb64f5f1d9281369eec3d707bdc53a4c570f383901a0a3e6a51ae18f4eb`:
148 CDM documents, 42 FpML documents and 2 Rune documents. CDM/FpML/Rune serialized
artifact SHA-256 prefixes were `0be757fc6bd5`, `5cc22eaeddbb`, `6edfc1df94ff`.
These are experiment provenance, not a persisted Nightly pin.

| Chromium main-thread metric | Baseline | Modified |
| --- | ---: | ---: |
| JS heap used at automatic ready, before further interaction | 939,603,816 B | 660,688,500 B |
| JS heap used after selections and explicit diagnostic collection | 451,347,332 B | 338,523,508 B |

The sampled automatic-ready heap was approximately 30% lower, and retained heap
approximately 25% lower in this replay. These are point measurements, not process
RSS, aggregate worker memory, a peak-memory bound, or a guarantee about iPhone
Safari. Raw logs/profiles are in `/tmp/rune-safari-repro/` on the development host.
A physical iPhone retest remains necessary before declaring the reported crash
resolved. No saved user workspace or browser cache was cleared.
