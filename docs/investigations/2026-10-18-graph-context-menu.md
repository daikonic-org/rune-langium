# Graph right-click menus

Right-clicking a graph node reached the existing handler but crashed the popup:
`Base UI: MenuGroupContext is missing. Menu group parts must be used within
<Menu.Group> or <Menu.RadioGroup>.` The shared dropdown label wraps Base UI's
`Menu.GroupLabel`; GraphContextMenu placed it outside a group. This was the only
production call site of that label. No global context-menu suppression was found
in Studio, visual-editor or design-system.

The node label and its actions now share `DropdownMenuGroup`. Existing menu
state, visibility/layout actions, non-modal behavior and pointer anchor remain
unchanged. Decorative action glyphs no longer become part of accessible names.

The browser regression fails before the composition fix. Afterward it verifies
opening at the pointer, hiding a node, restoring hidden nodes and fitting the
graph, opening the canvas menu, Escape dismissal and no Base UI console errors.
It also verifies that Source right-click events remain unprevented and do not
open the graph menu. This does not test a host browser's native menu UI.

The real-primitives component regressions verify the labeled node group, store
visibility change and layout callback. All 1,665 visual-editor tests and Studio
and visual-editor types pass. Local browser evidence uses isolated Chromium;
the user's browser tabs and production are unchanged.
