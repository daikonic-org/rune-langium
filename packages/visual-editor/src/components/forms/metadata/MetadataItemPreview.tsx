// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { renderNode } from '@rune-langium/codegen/rosetta';
import type { MetadataItem } from '../../../store/metadata-target.js';

/** Read-only rich payloads use the same Rune renderer as source publication. */
export function MetadataItemPreview({ item, label }: { item: MetadataItem; label: string }) {
  const text = renderNode(item, () => '');
  return text ? (
    <details className="min-w-0 max-w-full text-xs">
      <summary>{label}</summary>
      <pre className="whitespace-pre-wrap break-all">{text}</pre>
    </details>
  ) : null;
}
