// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import './_studio-dark';
import { useState } from 'react';
import { DisclosureButton } from '@rune-langium/design-system';

export function MetadataDisclosure() {
  const [expanded, setExpanded] = useState(true);
  return (
    <div className="w-80">
      <DisclosureButton aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
        Metadata
      </DisclosureButton>
      {expanded && <p className="px-1 py-1.5 text-xs text-muted-foreground">Documentation</p>}
    </div>
  );
}
