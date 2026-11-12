# Function composer

Status: **implemented for local candidate review**, 2026-11-11. This replaces the
earlier CDM-specific direction. Compose shares the retained Explore editor owner;
production deployment has not been initiated.

## Product decision

Build **Compose**, a dedicated Studio perspective in the current project. Its
editor is the **Function composer**. A function has inputs, named intermediate
expressions or function calls, and an output. The composer shows those
relationships without requiring a graphical representation of every operator or
statement. The existing expression builder edits one expression.

Keep one ordinary Rune function as the executable definition. CDM functions can
be called like any other library functions. CDM lifecycle objects, creation
annotations, approval states and lineage do not define this editor's semantics or
eligibility. A function's name or output type does not decide whether it opens in
the composer.

## Explicit opt-in: `[composition]`

Define a normal Rune annotation in a small Studio model dependency:

```rune
namespace rune.studio
version "1.0.0"

annotation composition: <"Edit this function using the function composer.">
```

Use it on functions intended for composition editing:

```rune
namespace example.calculations
version "1.0.0"
import rune.studio.*

func MyCalculation:
    [composition]
    inputs:
        value number (1..1)
    output:
        result number (1..1)
    alias adjusted: value * 2
    set result: adjusted
```

This is a Studio convention, not a built-in Rune or CDM annotation.
Match the resolved identity `rune.studio.composition`, rather than a short-name
string. Another annotation named `composition` does not opt a function in. No
grammar change, synthetic base function, special return type or new runtime is
needed. Use a direct marker; eligibility is not inherited silently.

Any resolved function can be called as a step without carrying this marker. The
marker opts its own body into the composer, subject to supported-body and access
checks. Existing CDM annotations remain ordinary model metadata; there is no CDM
compatibility profile, constructor-name classifier or automatic lifecycle discovery.

## Editing boundary

| Check                | Requirement                                    | Result otherwise                                              |
| -------------------- | ---------------------------------------------- | ------------------------------------------------------------- |
| Opt-in               | Resolved `[composition]` annotation            | Normal function inspector and source; callable as a step      |
| Supported body       | Complete, source-preserving representation     | Source view with located reasons; no partial rewrite          |
| Access and readiness | Current parsed document and local write access | Loading, retained invalid draft, or view-only reference state |

The initial representation has typed inputs, named call/expression steps and one
whole-output assignment. Aliases must form an acyclic dependency graph. A per-item
call can show its collection and scoped item binding. Other expression internals
stay in the existing focused expression editor. Conditions, documentation and
annotations remain in the existing inspector/source and are preserved.

Initially keep multiple/nested output assignments, output accumulation, root
dispatch implementations and inherited bodies requiring merges in Source. Calling
such a function is still supported: the parent only needs its canonical signature.
An annotation cannot make an unsupported body safe to rewrite. Expand the supported
representation only with matching source-preservation and semantic tests.

## Nested compositions

A nested composition is a call to another Rune function. Show it as a collapsed
call node with the callee name, argument bindings and output type/cardinality.
There is one callee definition, even when several call sites use it.

Drill-in opens the callee's inspector. If it is marked and supported, open its
composer with breadcrumbs back to the parent. Otherwise retain the normal source
and inspector. Restore the parent's draft, selection and viewport on return.
Editing a shared callee changes that function, without copying or inlining its body
into callers. Signature changes propagate through existing Core diagnostics.

Keep iteration, conditional scope and dependencies from the actual Rune source.
Possible branches must not appear as an unconditional sequence. There is no common
before/after signature: a call can consume or return numbers, objects or collections.

## Prior art and chosen patterns

These are interaction references, not execution semantics to import:

| Reference                                                                                                                                   | Pattern to borrow for Compose                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| [Node-RED palette](https://nodered.org/docs/user-guide/editor/palette/) and [sidebars](https://nodered.org/docs/user-guide/editor/sidebar/) | Searchable categorized library, direct node placement, and collapsible/resizable side panels                     |
| [Enso graph editor](https://help.enso.org/docs/getting-started/enso-graph-editor/)                                                          | Function-oriented nodes, a component browser, focused expression editing and relevant suggestions from an output |
| [Blueprint node placement](https://dev.epicgames.com/documentation/unreal-engine/placing-nodes-in-unreal-engine)                            | Context-sensitive search from a port and compatible-call discovery                                               |
| [React Flow drag/drop](https://reactflow.dev/examples/interaction/drag-and-drop)                                                            | Place palette items using the graph's screen-to-flow coordinate conversion, with a click alternative             |

Adapt those patterns to Rune: Core supplies function identity, argument/output
types and cardinalities. A production search result should show namespace,
signature and documentation; a search started from a port should prioritize
compatible functions. Wire compatibility must come from Core rather than a second
type system. Required bindings stay visible, and optional settings are disclosed.

Keep ordinary argument/output bindings on compact nodes, with documentation and complex expressions in the inspector. Reusable compositions stay
collapsed call nodes with drill-in and breadcrumbs. Provide keyboard node
placement and selection alongside dragging. Palette/inspector visibility and
width are personal view state; hiding either never changes source or discards a
draft. The Node-RED sidebar references also reinforce keeping these panels
focused rather than accumulating unrelated tooling in the inspector.

## Compose perspective

Compose gets its own activity-rail entry alongside the existing Studio
perspectives. **Open composer** in the function inspector navigates there with
the selected function. It shares the same project, source files, undo/drafts,
validation and save transaction; it does not create another project workspace.
The inspector continues to own signature, identity, annotations and details.
The creation-only popup evolves into this surface.

Use the following regions at HD 1280×720 and Full HD 1920×1080:

- **Left: palette**, with one search across Functions and Primitives. Functions
  come from the current project and loaded libraries, including nested
  compositions. A compact two-column primitive palette groups Expression, Branch
  and Fallback; For each, Filter, Sort, Distinct and Flatten; Reduce, Count and Sum;
  and the existing Output. Icons and short descriptions distinguish operations.
  Click or drag a starter, edit its Rune expression, then Apply; selecting Output
  never adds another output. Signature controls own Inputs. These are focused
  expression nodes, not graphs of their internal branches or closure bodies.
  Constructors, field selection and arithmetic remain in the expression builder.
- **Center: composition canvas**, with typed ports, data dependencies, named
  intermediate results and a reversible Rune source view.
- **Right: selected-step inspector**, with documentation, complex expression
  editing, output type/cardinality and the canonical signature/details tab.
- **Bottom: variable tray**, opened by selecting a node. Searchable tags include
  inputs, intermediate variables, the function output and scoped per-item values.
  Drag a tag to a node input/output, or select it and use the keyboard-accessible
  binding action. The tray occupies its own bounded row below the canvas.

Keep a compact header. Make the palette roughly 220–240px and the inspector
roughly 280–340px at desktop sizes, with collapse controls to recover canvas space.
On narrow screens, start with the palette collapsed and retain usable
source/details plus a pannable canvas. Opening the palette stacks it rather than
squeezing the graph and controls into three narrow columns.

Moving a node changes view state only. Save state reflects actual source persistence.
Primitive starters reuse the expression builder's operator factories and canonical
Rune renderer. Collection starters prefer a plural input, otherwise an empty list.
Defaults are editable examples, not inferred business logic. Node presentation
uses Core's outer AST expression kind, so labels/icons follow applied source edits
rather than variable names. Input, callable function and Output have distinct icons.
Back to inspector preserves drafts and selection. View-only reference declarations
use the existing Modify/override flow for local changes. Invalid or stale source
retains the draft and gates Apply, with an explicit recovery choice.

## Variable and argument bindings

Use **variable** in the designer; Rune Source retains the `alias` syntax. Preview
function schemas supply the argument rows, types and requiredness. Bind each
argument directly on its node to a variable or an entered Rune value/expression.
Argument rows show the full cardinality; requiredness is derived from its minimum,
with no independent required setting. Required rows precede optional rows visually while retaining original positional
argument indexes. A selected node expands its binding controls; selection alone
does not start a draft. The inspector does not duplicate ordinary binding forms.

An output can define a new variable or replace an existing variable's defining
expression, preserving its name and downstream references. A reference-only
variable appears as a tag on the existing producer, not a second computation.
Function inputs and per-item scoped values cannot be redefined. Per-item variables
are available only within their node's closure; function outputs cannot be read
before assignment. Refuse cyclic or unresolved bindings without publishing source.

Preparation uses private canonical parser/linker/validator analysis. If rebinding
requires ordering a later producer before an existing variable, move complete
original variable source blocks with comments and trivia in a stable topological
order. Keep conditions and neighboring declarations untouched. Restore the captured
parser workspace even after failed candidate analysis, then apply one guarded
source edit. Do not maintain graph-side execution or infer dependencies from names.

## Shared architecture

- Core owns parsing, references, types, cardinalities, expression regions and
  validation. Do not add an editor-specific parser or evaluator.
- Reuse `FunctionForm` for signature/details and `ExpressionBuilder` for one
  expression. The expression editor does not become a whole-function graph editor.
- Apply exact source-region edits through `ExpressionDocument` and the existing
  project transaction path, with revision, captured source, declaration identity,
  workspace-generation and read-only guards. Reparse and read back.
- Preserve comments, metadata, conditions, unrelated text and neighboring
  declarations. Do not regenerate an existing function wholesale with the
  creation-only DTO renderer.
- Give the React Flow instance its own view state, independent of the mounted type
  graph. Reuse graph primitives and authoritative schema adapters.
- Keep source as the execution contract. Prototype invokes the saved function;
  presentation/input-binding metadata does not contain a second executable step list.
- Preserve curated source and local edits through the existing override transaction.

Relevant seams:

- [FunctionForm](../../../packages/visual-editor/src/components/editors/FunctionForm.tsx)
- [ExpressionWorkspace](../../../apps/studio/src/components/editing/ExpressionWorkspace.tsx)
- [ExpressionBuilderDialog](../../../apps/studio/src/components/editing/ExpressionBuilderDialog.tsx)
- [ExpressionDocument](../../../apps/studio/src/services/expression-document.ts)
- [Existing creation-only builder](../../../apps/studio/src/components/WorkflowFunctionBuilder.tsx)
- [Function/recipe persistence](../../../apps/studio/src/workspace/workflow-repository.ts)

## Mockup and verification

The approved local interactive mockup shows the Compose perspective with a left Functions/Primitives palette, center
canvas and right inspector. Search filters the sample catalog; GetFixedRate can
be added by click or drag. Entries already represented select their sample node.
It also shows an ordinary callable function and a marked function whose nested
output assignments stay in Source. It makes no project writes and executes no
financial calculation. Its catalog is illustrative; production uses Core.

The main illustrative composition calls CDM `FixedAmountCalculation` per supplied
calculation period, then extracts the amount from its details result. This uses a
normal library function; it introduces no CDM lifecycle dependencies. The separate
`DoubleQuote` example uses ordinary starter types/functions.

The implementation verifies exact annotation resolution, shadowed
names, unsupported-body fallback, no-op round-trip identity, preserved comments and
metadata, stale/read-only/hydration recovery, scalar/object/collection bindings,
nested calls and scoped per-item calls. Saved functions must compile and execute
through existing tooling. Verify keyboard/click/drag placement, palette search,
port-context discovery, read-only behavior, parent-state restoration, unchanged
source after layout changes, HD/Full HD layouts and a narrow fallback.

Implement the shared opt-in/body classifier and preservation fixtures first, then
the Compose perspective with palette/inspector, composition nodes/leaf editing, and Prototype
navigation. Arbitrary function conversion, full operator graphs, lifecycle engines
and durable job orchestration remain outside this proposal.
