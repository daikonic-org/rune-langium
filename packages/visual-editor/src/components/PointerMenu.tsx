// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@rune-langium/design-system/ui/dropdown-menu';

/** Shared non-modal menu placement for graph and declaration context actions. */
export function PointerMenu({
  position,
  onClose,
  children,
  testId
}: {
  position: { x: number; y: number } | null;
  onClose(): void;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <DropdownMenu
      open={position !== null}
      modal={false}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {typeof document !== 'undefined' &&
        createPortal(
          <DropdownMenuTrigger
            nativeButton={false}
            render={
              <span
                aria-hidden
                style={{
                  position: 'fixed',
                  left: position?.x ?? 0,
                  top: position?.y ?? 0,
                  width: 0,
                  height: 0,
                  pointerEvents: 'none'
                }}
              />
            }
          />,
          document.body
        )}
      <DropdownMenuContent
        align="start"
        sideOffset={0}
        data-testid={testId}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.stopPropagation()}
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
