# Curated source transport and projection toolbar

Issues [#610](https://github.com/pradeepmouli/rune-langium/issues/610) and
[#609](https://github.com/pradeepmouli/rune-langium/issues/609).

## Worker boundary

The parser worker returned live Langium models from `parse`, `parseWorkspace`
and `linkDocument`. Those models retain parser service state through document
and reference objects. Running the real handlers followed by `structuredClone`
reproduced `DataCloneError: function () { [native code] } could not be cloned`.
An in-process test that only awaits the handler does not exercise this boundary.

Responses now use snapshots from core's canonical `serializeRuneModel`, matching
the server parse endpoint. Source regions, original expression text and reference
paths remain on the wire; live models remain registered inside the worker for
subsequent linking. Workspace responses serialize each model once and share that
snapshot between their two model lists.

The transport regressions clone real parse, workspace and deferred curated-link
responses. They verify retained body text, reference text, source coordinates,
snapshot independence and subsequent worker linking.

## Projection toolbar

The expression editor has a minimum height while its header and generated-view
caption were allowed to shrink. Under vertical pressure the caption could move
over the toolbar. Both now retain their intrinsic height. Split-file dispatch
browser checks cover both file orders and both generated languages, assert the
caption remains below Open in Source, and check that the button receives clicks.
Both new split-file assertions failed with the original header/caption classes
and passed with the non-shrinking layout.

## Verification scope

Local expression browser suite: 10 passed, one network-LSP case explicitly
skipped without a local LSP Worker. These checks use isolated browser contexts;
they do not establish deployment or production timing. Hosted curated J19 must
still be checked after deployment. No timeout budget was increased.

Studio unit suite: 2,032 passed, two skipped across 219 files. Studio application
and Pages Function types and changed-file lint/format passed. The curated cache
browser suite passed all seven checks, including actual worker transport,
reload/cross-tab reuse, legacy source and corrupt-payload recovery.
