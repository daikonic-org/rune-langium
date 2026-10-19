# Rune Studio

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People exploring, authoring and reviewing Rune DSL models, and engineers working
with the models and their generated artifacts. CDM, FpML and Rune's standard
library are existing model sources. The priority among domain authors, reviewers
and tooling engineers remains an open product decision.

## Product Purpose

Rune Studio is a source-available browser workbench for Rune models. Users can
understand model structure, edit source and structured details, inspect conditions
and function implementations, try sample data, and generate artifacts without
using an Eclipse-based desktop workbench.

Success means users can follow a declaration across views, understand its logic,
make an intentional edit and see consistent results without losing their work.
Polish, quality, consistency, DRY and extensibility are explicit product priorities:
shared constructs should behave consistently across views, reuse authoritative
implementations and support new capabilities through shared extension points.

## Positioning

Studio combines a TypeScript-native Rune language toolchain with coordinated
Graph, Structure, Source and Inspector views. Generated previews and validation
reuse the same authoritative tooling as exports rather than independent UI
approximations. See [architecture and invariants](../../docs/agents/architecture.md).

## Operating Context

- Multi-file `.rosetta` workspaces and large reference corpora coexist.
- Browser, local-folder and Git-backed workspaces have different persistence and
  access capabilities; users need to understand which workspace they are using.
- Reference models can load progressively and reuse local caches. A visible
  declaration does not by itself mean all dependencies or its preview are ready.
- Companion panes share limited space. Desktop workflows and compact browser
  access both matter; phone support must not be inferred from desktop screenshots.
- Local development and deployed production have different service availability.
  Their validation evidence must remain distinct.

## Capabilities and Constraints

- Explore declarations, namespaces, inheritance, members and references through
  Type explorer, Graph and Structure.
- Edit Rune source and structured declaration/member details, including metadata,
  annotations and synonyms. Comments remain source-only.
- Inspect whole function implementations and individual conditions with Rune,
  TypeScript and Python views; use the expression builder for focused edits.
- Keep generated projections readable for correctly typed inputs. Native language
  constructs and enum members are preferred; executable generation must retain
  guards needed by its actual runtime contract.
- Preview forms, structural validation and function execution using sample data.
  Loading, pending validation, unavailable services and genuine errors must be
  distinguished from successful readiness.
- Generate artifacts for selected declarations and their required dependencies.
  Large helper blocks should not obscure the user's generated declarations.
- Curated reference declarations and original source are browsable; reference-only
  capabilities do not authorize mutating their source models.
- Preserve drafts, undo history, selection and unsaved changes across view changes.

## Brand Commitments

The product is Rune Studio, within DAIKONIC. Refinements preserve its existing
identity and terminology. Licensing distinguishes the source-available Studio
application from the MIT-licensed tooling packages. Init does not establish a new
visual identity or replace the existing interface.

## Evidence on Hand

- [Studio capabilities](README.md) and the [repository overview](../../README.md).
- [Architecture and invariants](../../docs/agents/architecture.md) and the
  [testing guide](../../docs/TESTING.md) are authoritative for runtime boundaries
  and verification commands.
- Pinned CDM expression fixtures live in
  [test/fixtures/third-party/cdm-expression](../../test/fixtures/third-party/cdm-expression/).
- Local browser journeys are in [test/e2e](test/e2e/); production journeys are in
  [test/prod-ux](test/prod-ux/). Their results and screenshots are evidence for
  specific runs, not a blanket compatibility or accessibility claim.

## Product Principles

1. Treat DRY as a correctness rule: reuse authoritative language semantics and
   shared constructs across surfaces rather than maintaining parallel versions.
2. Keep equivalent constructs, interactions, source identity and model relationships
   consistent across navigation, structured edits, previews and exports.
3. Make polish and quality part of completion: readable projections, usable
   layouts, accessible interactions and honest readiness must preserve user work
   and the contracts of actual execution and generated APIs.
4. Reveal large models progressively without discarding their complete contents.
5. Build for extensibility through shared components and explicit extension points,
   so new model constructs and capabilities do not require duplicated behavior.

## Accessibility & Inclusion

Core actions need meaningful names, visible focus and keyboard access. Supporting
metadata must not obscure the primary action's name. Compact layouts must retain
access to code and details rather than compressing them below a usable size.
Existing browser checks use Axe and interaction journeys; unresolved contrast,
mobile and browser coverage limits must be reported explicitly.

## Open Decisions

- Audience priority is awaiting confirmation; the supported workflows above are
  established product facts.
