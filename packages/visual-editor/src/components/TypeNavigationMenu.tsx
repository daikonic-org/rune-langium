// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { useRef, useState, type MouseEvent, type KeyboardEvent } from 'react';
import { DropdownMenuItem } from '@rune-langium/design-system/ui/dropdown-menu';
import type { NavigateToNodeCallback } from '../types.js';
import { PointerMenu } from './PointerMenu.js';

export interface TypeNavigationAction {
  label: string;
  onSelect: NavigateToNodeCallback;
}

interface TypeNavigationActions {
  onNavigate?: NavigateToNodeCallback;
  onInspect?: NavigateToNodeCallback;
  additionalActions?: readonly TypeNavigationAction[];
}

function isEditableTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest('input, textarea, [contenteditable="true"]'));
}

function menuOrigin(event: MouseEvent | KeyboardEvent) {
  return event.target instanceof Element
    ? (event.target.closest('button, [tabindex]') ?? event.currentTarget)
    : event.currentTarget;
}

export function TypeNavigationMenuItems({
  nodeId,
  onNavigate,
  onInspect,
  additionalActions,
  onClose
}: TypeNavigationActions & { nodeId: string; onClose(): void }) {
  const activate = (action: NavigateToNodeCallback) => {
    onClose();
    action(nodeId);
  };
  return (
    <>
      {onNavigate && <DropdownMenuItem onClick={() => activate(onNavigate)}>Go to type</DropdownMenuItem>}
      {onInspect && <DropdownMenuItem onClick={() => activate(onInspect)}>Inspect type</DropdownMenuItem>}
      {additionalActions?.map((action) => (
        <DropdownMenuItem key={action.label} onClick={() => activate(action.onSelect)}>
          {action.label}
        </DropdownMenuItem>
      ))}
    </>
  );
}

/** Targets must already be resolved by the owning link, tree or Structure adapter. */
export function useTypeNavigationMenu(actions: TypeNavigationActions) {
  const [target, setTarget] = useState<{ nodeId: string; x: number; y: number } | null>(null);
  const origin = useRef<Element | null>(null);
  const hasActions = Boolean(actions.onNavigate || actions.onInspect || actions.additionalActions?.length);
  const close = () => {
    setTarget(null);
    if (origin.current instanceof HTMLElement && origin.current.isConnected)
      origin.current.focus({ preventScroll: true });
  };
  const open = (event: MouseEvent, nodeId: string | undefined) => {
    if (!nodeId || !hasActions || isEditableTarget(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    origin.current = menuOrigin(event);
    const bounds = event.currentTarget.getBoundingClientRect();
    setTarget({ nodeId, x: event.clientX || bounds.left, y: event.clientY || bounds.bottom });
  };
  const onKeyDown = (event: KeyboardEvent, nodeId: string | undefined) => {
    if (
      !nodeId ||
      !hasActions ||
      isEditableTarget(event.target) ||
      (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10'))
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    origin.current = menuOrigin(event);
    const bounds = event.currentTarget.getBoundingClientRect();
    setTarget({ nodeId, x: bounds.left, y: bounds.bottom });
  };
  const menu = target ? (
    <PointerMenu position={target} onClose={close} testId="type-navigation-menu">
      <TypeNavigationMenuItems nodeId={target.nodeId} {...actions} onClose={close} />
    </PointerMenu>
  ) : null;
  const targetProps = (nodeId: string | undefined, label?: string) => ({
    ...(nodeId && label && hasActions
      ? { role: 'group', tabIndex: 0, 'aria-label': label, 'aria-haspopup': 'menu' as const }
      : {}),
    onContextMenu: (event: MouseEvent) => open(event, nodeId),
    onKeyDown: (event: KeyboardEvent) => onKeyDown(event, nodeId)
  });
  return { open, onKeyDown, menu, targetProps, hasActions };
}
