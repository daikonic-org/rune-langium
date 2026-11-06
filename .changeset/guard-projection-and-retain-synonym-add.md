---
"@rune-langium/visual-editor": patch
---

Retain Inspector synonym Add commands while source parsing temporarily blocks
commits, without bypassing workspace, row identity, or source permission guards.
Keep metadata drafts usable during the structural edit lock.

Studio publishes accepted metadata through the existing source flush before an
older parse can consume its one-shot patches.
Explicit source flushes also invalidate older React observer snapshots so stale
effects cannot overwrite newer edits.
