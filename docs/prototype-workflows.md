# Prototype workflows and object building

Rune Studio is source-available. Prototype provides two complementary surfaces:

- **Workflow** applies an optional Rune function to inputs and displays its output. **New workflow** starts with no function or predetermined input type. Named recipes remain in the repository; complete edited recipe drafts are retained when switching between saved recipes in the same session.
- **Object builder** creates, imports, edits and exports one typed object without a function panel. Choose a type or select an example from the library. Switching surfaces retains their separate drafts while Prototype remains mounted.

Node menus provide **Import input**, **Use stored object** and **Clear input**.
Clearing changes the working input, not its stored example. **Undo clear** restores
that input without overwriting edits to other function parameters. Editing the
cleared input or selecting a different type ends that undo opportunity.

Validation uses the shared generated Rune schemas. A zero-minimum collection may
be omitted from an example, as it may from function inputs; applicable data and
function conditions still run. The status icon opens validation details. Named
function precondition failures include the Rune description and source when
available; the inline ellipsis opens the same details. Structural errors remain
attached to their actual field paths.

Presentation files load independently of progressive reference hydration. Type
availability notices use the live reference view after loading completes, and
appear once above the workflow. Missing types do not delete saved layouts.

A workspace copied from a starter retains its repository origin, but that origin
is not a writable Git connection. Git / Sync distinguishes a local starter copy
from a connected repository. Connect a repository you own or a fork to commit and
push; Save continues to update the local working files.
