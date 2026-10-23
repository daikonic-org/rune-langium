// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * @packageDocumentation
 *
 * ReactFlow-based graph and form components for exploring and editing Rune DSL
 * models in the browser.
 *
 * @remarks
 * Use `RuneTypeGraph` for an interactive type graph, the exported panel and
 * editor components for custom shells, and the store/layout helpers when you
 * need to embed the editor in a larger application.
 */

// @rune-langium/visual-editor — Public API

// Main component
export { RuneTypeGraph } from './components/RuneTypeGraph.js';

// Canonical kind badge (single color source for all four surfaces)
export { KindBadge, KIND_LABEL, KIND_LETTER } from './components/KindBadge.js';
export type { KindBadgeProps } from './components/KindBadge.js';

export { useTypeNavigationMenu } from './components/TypeNavigationMenu.js';
export type { TypeNavigationAction } from './components/TypeNavigationMenu.js';

// Shared type header (namespace eyebrow + editable/read-only name + KindBadge)
export { TypeHeader } from './components/TypeHeader.js';
export type { TypeHeaderProps } from './components/TypeHeader.js';

// Panel components (for custom layouts)
export { OtherForm } from './components/panels/OtherForm.js';
export type { OtherFormProps } from './components/panels/OtherForm.js';
export { EditorFormPanel } from './components/panels/EditorFormPanel.js';
export type { EditorFormPanelProps } from './components/panels/EditorFormPanel.js';
export { NamespaceExplorerPanel } from './components/panels/NamespaceExplorerPanel.js';
export type { NamespaceExplorerPanelProps } from './components/panels/NamespaceExplorerPanel.js';
export { selectionState, toggleVisible } from './utils/explorer-selection.js';
export type { ExplorerSelection, ExplorerSelectionAction } from './utils/explorer-selection.js';

// Editor components (P2)
export { TypeCreator } from './components/editors/TypeCreator.js';
export type { TypeCreatorProps } from './components/editors/TypeCreator.js';
export { AttributeEditor } from './components/editors/AttributeEditor.js';
export type { AttributeEditorProps } from './components/editors/AttributeEditor.js';

// New editor form sub-components
export { TypeSelector, getKindBadgeClasses, getKindDotClass, getKindLabel } from './components/editors/TypeSelector.js';
export type {
  TypeSelectorProps,
  TypeSelectorTriggerProps,
  TypeSelectorPopoverProps,
  TypeSelectorGroup
} from './components/editors/TypeSelector.js';
export { CardinalityPicker } from './components/editors/CardinalityPicker.js';
export type { CardinalityPickerProps } from './components/editors/CardinalityPicker.js';
export { MetadataSection } from './components/editors/MetadataSection.js';
export type { MetadataSectionProps } from './components/editors/MetadataSection.js';
export { AttributeRow } from './components/editors/AttributeRow.js';
export type { AttributeRowProps } from './components/editors/AttributeRow.js';
export { DataTypeForm } from './components/editors/DataTypeForm.js';
export type { DataTypeFormProps } from './components/editors/DataTypeForm.js';
export { EnumValueRow } from './components/editors/EnumValueRow.js';
export type { EnumValueRowProps } from './components/editors/EnumValueRow.js';
export { EnumForm } from './components/editors/EnumForm.js';
export type { EnumFormProps } from './components/editors/EnumForm.js';
export { ChoiceOptionRow } from './components/editors/ChoiceOptionRow.js';
export type { ChoiceOptionRowProps } from './components/editors/ChoiceOptionRow.js';
export { ChoiceForm } from './components/editors/ChoiceForm.js';
export type { ChoiceFormProps } from './components/editors/ChoiceForm.js';
export { FunctionForm } from './components/editors/FunctionForm.js';
export type { FunctionFormProps } from './components/editors/FunctionForm.js';

// Types
export type {
  Dehydrated,
  DomainNodeData,
  AnyGraphNode,
  GraphNodeMeta,
  RootAstElement,
  TypeKind,
  EdgeKind,
  EdgeData,
  ValidationError,
  ExpressionEditorSlotProps,
  FunctionBodyEditorSlotProps,
  TypeOption,
  SourceRefOption,
  CommonFormActions,
  DataFormActions,
  EnumFormActions,
  ChoiceFormActions,
  FuncFormActions,
  TypeAliasFormActions,
  FormActionsKindMap,
  AllEditorFormActions,
  EditorFormActions,
  GraphFilters,
  LayoutDirection,
  LayoutOptions,
  NodeStyleConfig,
  EdgeStyleConfig,
  RuneTypeGraphConfig,
  RuneTypeGraphCallbacks,
  RuneTypeGraphProps,
  RuneTypeGraphRef,
  TypeGraphNode,
  TypeGraphEdge,
  NamespaceTypeEntry,
  VisibilityState,
  NavigateToNodeCallback
} from './types.js';
export { BUILTIN_TYPES } from './types.js';

// Adapter utilities
export { astToModel, astToGraph } from './adapters/ast-to-model.js';
export { modelsToAst, graphToModels } from './adapters/model-to-ast.js';
export type { ModelOutput, SyntheticModel, SyntheticElement } from './adapters/model-to-ast.js';
export {
  formatCardinality,
  parseCardinality,
  getTypeRefText,
  getRefText,
  annotationsToDisplay,
  conditionsToDisplay,
  AST_TYPE_TO_NODE_TYPE,
  NODE_TYPE_TO_AST_TYPE,
  resolveNodeKind
} from './adapters/model-helpers.js';

// Layout
export { computeLayout, computeLayoutIncremental, clearLayoutCache } from './layout/dagre-layout.js';
export { computeLayoutAsync, cancelAsyncLayout } from './layout/layout-worker.js';
export { computeGroupedLayout, findInheritanceGroups } from './layout/grouped-layout.js';
export type { GroupInfo } from './layout/grouped-layout.js';

// Namespace tree utilities
export { buildTypeOptions } from './utils/type-options.js';

// Node-id utilities
export {
  isTypeNodeId,
  makeNodeId,
  nameFromNodeId,
  qualifiedNameFromNodeId,
  splitNodeId
} from './store/node-projection.js';

// Store (for advanced consumers)
export { createEditorStore, useEditorStore } from './store/editor-store.js';
export type { EditorStore, EditorState, EditorActions, DeferredExportEntry } from './store/editor-store.js';
export { selectNodeRepository } from './store/node-repository.js';
export type { NodeRepository, NodeOf } from './store/node-repository.js';

// History / undo-redo
export type { TrackedState } from './store/history.js';

// Expression builder
export { ExpressionBuilder } from './components/editors/expression-builder/ExpressionBuilder.js';
export type { ExpressionBuilderProps } from './components/editors/expression-builder/ExpressionBuilder.js';
export type { FunctionScope, FunctionScopeEntry } from './store/expression-store.js';

// Hooks
export { useAutoSave } from './hooks/useAutoSave.js';
export { useLatestRef } from './hooks/useLatestRef.js';
export { useNavigationArrival } from './hooks/useNavigationArrival.js';
export { useStableKey } from './hooks/useStableKey.js';
export { useExpressionAutocomplete } from './hooks/useExpressionAutocomplete.js';
export type { CompletionItem, UseExpressionAutocompleteResult } from './hooks/useExpressionAutocomplete.js';
export { useTypeRefDrop } from './hooks/useTypeRefDrop.js';
export type { UseTypeRefDropOptions, UseTypeRefDropResult } from './hooks/useTypeRefDrop.js';
export { useDiagnosticsForRange } from './hooks/useDiagnosticsForRange.js';
export type { RangeDiagnostic } from './hooks/useDiagnosticsForRange.js';
export { useModelSourceSync } from './hooks/useModelSourceSync.js';

// Validation utilities
export {
  detectCircularInheritance,
  detectDuplicateName,
  validateCardinality,
  detectDuplicateEnumValue,
  validateNotEmpty,
  validateIdentifier,
  validateExpression,
  validateGraph
} from './validation/edit-validator.js';
export type { ExpressionValidationResult } from './validation/edit-validator.js';

// Structure View shared types (spec 020)
export * from './types/structure-view.js';

// Structure View component (Phase 7/8)
export { StructureView } from './components/StructureView.js';
export type { StructureViewProps, StructureCellComponents } from './components/StructureView.js';

// Structure View adapter (Phase 2 / 14e)
export { buildStructureGraph } from './adapters/structure-graph-adapter.js';
export type {
  AdapterDocument,
  AdapterNode,
  AdapterAttribute,
  AdapterChoiceOption,
  AdapterCardinality,
  BuildOptions
} from './adapters/structure-graph-adapter.js';

// Structure cells (Phase 5)
export { NameCell } from './components/editors/structure/NameCell.js';
export type { NameCellProps } from './components/editors/structure/NameCell.js';
export { CardinalityCell } from './components/editors/structure/CardinalityCell.js';
export type { CardinalityCellProps } from './components/editors/structure/CardinalityCell.js';
export { TypeChip, typeChipKind } from './components/editors/structure/TypeChip.js';
export type { TypeChipProps, TypeChipKind } from './components/editors/structure/TypeChip.js';
export { TypePickerCell } from './components/editors/structure/TypePickerCell.js';
export type { TypePickerCellProps } from './components/editors/structure/TypePickerCell.js';
export { expressionScopeFromEntries } from './adapters/expression-scope.js';

export { createEditorCommitRegistry } from './hooks/editor-commit-lifecycle.js';
export type { EditorCommitRegistry } from './hooks/editor-commit-lifecycle.js';
export type { SourceSyncHandle, SourceSyncSnapshot } from './hooks/useModelSourceSync.js';

export { InspectorFrame } from './components/editors/inspector/InspectorFrame.js';
export type { InspectorFrameProps, InspectorSection } from './components/editors/inspector/InspectorFrame.js';
export { InspectorDetailsPane } from './components/editors/inspector/InspectorDetailsPane.js';
export { InspectorInheritanceField } from './components/editors/inspector/InspectorInheritanceField.js';
