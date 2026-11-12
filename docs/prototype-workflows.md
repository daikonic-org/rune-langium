# Prototype workflows and object building

Rune Studio is source-available. Prototype provides two complementary surfaces:

- **Workflow** applies an optional Rune function to inputs and displays its output. **New workflow** starts with no function or predetermined input type. Named recipes remain in the repository; complete edited recipe drafts are retained when switching between saved recipes in the same session.
- **Object builder** creates, imports, edits and exports one typed object without a function panel. Choose a type or select an example from the library. Switching surfaces retains their separate drafts while Prototype remains mounted.

Node menus provide **Import input**, **Use stored object** and **Clear input**.
Clearing changes the working input, not its stored example. **Undo clear** restores
that input without overwriting edits to other function parameters. Editing the
cleared input or selecting a different type ends that undo opportunity.

Use **Compose function** to open the dedicated **Compose** perspective and turn
several steps into a reusable Rune function. Choose **New composition**, give it
a namespace and name, define typed inputs and a named output, then compose steps:

1. Choose **Function call** to select a workspace function, including a previously
   composed function. Bind each named argument to an input, an earlier step or a
   Rune expression. Available names are listed beneath each step.
2. Choose **Rune expression** for selection, conditions, `extract` or `filter`.
   For example, `periods extract period [FixedAmountCalculation(payout, period, notional)]`
   applies an existing calculation to each period.
3. Set the output expression and review the generated Rune source.
4. **Create function** saves source, the ordinary composition marker model and a
   Prototype recipe together. **Try in Prototype** opens its inputs for testing.
   Set values or bind stored examples and **Execute**.

The source is an ordinary `.rosetta` file with named aliases. It can be inspected,
edited, called by other functions and exported through the normal tools. Types
and references are checked by the normal workspace pipeline before execution.
The recipe stores input bindings and output names, never a second step graph or
execution results. Creation refuses existing files/functions; open their marked,
supported body in Compose to edit it. Bind ordinary arguments on their node to
variables or entered Rune values. The bottom variable tray supports drag/drop and
keyboard binding to inputs/outputs. Output rebinding replaces an existing variable's
definition while preserving consumers, or defines a new variable. Cycles and stale
writes are refused. Complex expressions and the canonical signature remain in the
inspector; Source stays available for unsupported bodies. Cancel discards an
unsaved creation draft. Unapplied node drafts survive nested navigation within the
mounted workspace. See the [Compose contract](design/function-composer/spec.md).

Rune JSON node imports use the declared input type, including the element type
for list inputs. Linked decoding accepts concrete Choice arms and derived Data
values only when assignable to that declaration; unrelated types are rejected
before replacing the current input. Headerless list objects use the same decoder.
Object aliases resolve through the shared Rune type resolver. Nested Choice
imports restore each declared slot from the concrete wire type; cyclic or
ambiguous alternatives are rejected rather than guessed.
Concrete type headers distinguish Data attributes from same-named Choice slots.
Rune JSON export rejects unsupported metadata-envelope siblings instead of
discarding them; plain JSON retains those fields.
Saving an edited Rune JSON example uses the existing linked worker context, so
cloned working values retain their metadata roles, original codec and wire
headers. A changed workspace or unapplied saved revision rejects the save rather
than using a different declaration context.

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
