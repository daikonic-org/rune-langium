---
"@rune-langium/visual-editor": patch
---

Retain Inspector synonym Add commands while source parsing temporarily blocks
commits, without bypassing workspace, row identity, or source permission guards.
Keep metadata drafts usable during the structural edit lock.

Studio captures its live semantic edit journal through the shared source flush
before an older parse can consume one-shot patches. New user edits also publish
when React has not yet adopted the latest parse baseline.
Explicit source flushes also invalidate older React observer snapshots so stale
effects cannot overwrite newer edits.
Resume valid dirty member names after a row remount, and retain the selected
member through rename acknowledgement without crossing workspace boundaries.
