# Explore execution response correlation

PR #633 retains the preview worker across workspace resets. Its review identified
a race: an old asynchronous execution could settle a new workspace's run with
the same qualified function name because the response handler discarded the
worker's echoed request ID.

The store now retains that ID in its existing latest-execution span. One shared
guard requires the function and ID to match before consuming the span, updating
output or recording activity. Request counters remain monotonic across resets;
repeated runs of one function also reject superseded replies. Both provider
response branches forward the actual request ID. No alternate worker, fallback
response path or compatibility overload was added.

Two provider regressions first failed with stale success/error output appearing
after a reset and a new same-name dispatch. They now verify that both old replies
are ignored before and after the current response, which remains able to settle.
Store regressions cover superseded runs, mismatched function names and duplicate
responses. Existing successful/error activity and diagnostic assertions remain.

Validation on the PR #633 checkout: **124 focused tests** and the complete Studio
suite (**2,181 passed**, two existing skips), production build, scoped lint/format
and diff checks passed. Normal commit and pre-push hooks remain enabled. PR #634
contains the same retained-worker path and requires the same response guard.
