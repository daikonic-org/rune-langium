// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/** Shared graph actions and editor options for configured form sections. */

import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type {
  CommonFormActions,
  EnumFormActions,
  ExpressionEditorSlotProps,
  SourceRefOption,
  TypeGraphNode
} from '../../../types.js';

// ---------------------------------------------------------------------------
// Context shape
// ---------------------------------------------------------------------------

export interface EditorActionsContextValue {
  nodeId: string;
  actions: CommonFormActions & Partial<Pick<EnumFormActions, 'addEnumValueSynonym' | 'removeEnumValueSynonym'>>;
  readOnly?: boolean;
  sourceReadOnly?: boolean;
  compactConditions?: boolean;
  availableAnnotations?: string[];
  allNodes?: TypeGraphNode[];
  synonymSourceOptions?: SourceRefOption[];
  renderExpressionEditor?: (props: ExpressionEditorSlotProps) => ReactNode;
  showPostConditionToggle?: boolean;
}

const EditorActionsContext = createContext<EditorActionsContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider + hook
// ---------------------------------------------------------------------------

export interface EditorActionsProviderProps extends EditorActionsContextValue {
  children: ReactNode;
}

/**
 * Wraps a `<ZodForm>` (or any tree containing declaratively-rendered
 * section components) with the `nodeId` + `actions` the sections need
 * to commit edits.
 */
export function EditorActionsProvider({ children, ...value }: EditorActionsProviderProps): ReactNode {
  return <EditorActionsContext.Provider value={value}>{children}</EditorActionsContext.Provider>;
}

/**
 * Read the editor actions context.
 *
 * Returns `null` when the section component is rendered outside an
 * `<EditorActionsProvider>`. Section components must tolerate `null`
 * (the imperative call sites pass callbacks via props instead) and
 * MUST NOT throw — see `section-component.md` §6.
 */
export function useEditorActionsContext(): EditorActionsContextValue | null {
  return useContext(EditorActionsContext);
}
