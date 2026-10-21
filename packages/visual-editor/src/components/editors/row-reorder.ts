// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import type { DragEvent } from 'react';

/** Native row reordering shared by attribute and enum editors. */
export function rowReorderHandlers(index: number, onReorder: (from: number, to: number) => void) {
  return {
    onDragStart(event: DragEvent) {
      event.dataTransfer.setData('text/plain', String(index));
      event.dataTransfer.effectAllowed = 'move';
    },
    onDragOver(event: DragEvent) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    },
    onDrop(event: DragEvent) {
      event.preventDefault();
      const fromIndex = Number(event.dataTransfer.getData('text/plain'));
      if (!Number.isNaN(fromIndex) && fromIndex !== index) onReorder(fromIndex, index);
    }
  };
}
