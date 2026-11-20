# Daikonic Transit webfonts

Upright and italic WOFF2 faces sourced from the
[Daikonic Transit 2026.11.20 release](https://github.com/daikonic-org/transit-typeface/releases/tag/Transit-2026.11.20).

| Family | Version | Use |
| --- | --- | --- |
| Sans | 0.111 | Headings, wordmark and display text |
| System | 0.120 | UI and body with automatic optical sizing |
| Code | 1.042 | CodeMirror and inline expressions, Book 350 at 94% width |

The Code faces come from the release's WOFF2 archive with `wdth` pinned to
94 using FontTools 4.68.0. They retain variable weights from 350 to 500 and
the upstream contextual alternates and ligatures.

See [manifest.json](manifest.json) for exact file checksums and variable-axis
ranges. JetBrains Mono remains the general monospace token. Faces use
`font-display: swap` and load when used.

Fonts retain the [SIL Open Font License](OFL.txt) and [upstream notices](NOTICE.txt).
These files ship together in the package and the combined site's `fonts/` directory.
