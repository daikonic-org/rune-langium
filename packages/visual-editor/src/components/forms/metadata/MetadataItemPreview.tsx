// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { Disclosure } from '@rune-langium/design-system/ui/collapsible';
import { renderNode } from '@rune-langium/codegen/rosetta';
import type { MetadataItem } from '../../../store/metadata-target.js';

/** Read-only rich payloads use the same Rune renderer as source publication. */
export function MetadataItemPreview({ item, label }: { item: MetadataItem; label: string }) {
  const text = renderNode(item, () => '');
  return text ? (
    <Disclosure label={label} className="max-w-full text-xs">
      <pre className="px-1 py-1.5 whitespace-pre-wrap break-all">{text}</pre>
    </Disclosure>
  ) : null;
}
