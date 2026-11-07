---
'@rune-langium/studio': patch
'@rune-langium/visual-editor': patch
---

Show effect-based feedback across Source, Inspector, Structure, Graph, Form and
sample JSON after edits: green additions, blue modifications and red, inert removal
snapshots. Keep active editing controls, initial display, navigation and
background hydration quiet, and respect reduced
motion. Source and generated code use range-local CodeMirror decorations.
Preserve measured Graph dimensions when layout updates arrive in the same frame.
