// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Daikonic contributors

import { useMemo, useState } from 'react';
import { readWorkflows } from '@rune-langium/project-config';
import { Button } from '@rune-langium/design-system/ui/button';
import { SearchInput } from '@rune-langium/design-system/ui/input';
import { useProject } from '../providers/project-context.js';
import { withInstrumentation } from '../../services/instrumentation/core.js';

export const WorkflowListPanel = withInstrumentation(
  function WorkflowListPanel({ onOpen }: { onOpen(id: string): void }) {
    const { snapshot } = useProject();
    const [query, setQuery] = useState('');
    const workflows = useMemo(() => snapshot && readWorkflows(snapshot).workflows, [snapshot]);
    const needle = query.trim().toLowerCase();
    const matches = workflows?.filter(({ name }) => name.toLowerCase().includes(needle)) ?? [];
    return (
      <section aria-label="Saved workflows" className="flex h-full min-h-0 flex-col gap-2 p-2">
        {workflows?.length ? (
          <>
            <SearchInput
              aria-label="Search workflows"
              placeholder="Search workflows…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <ul className="studio-scroll min-h-0 flex-1 overflow-auto">
              {matches.map(({ id, name }) => (
                <li key={id}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto w-full justify-start whitespace-normal text-start"
                    onClick={() => onOpen(id)}
                  >
                    {name}
                  </Button>
                </li>
              ))}
              {!matches.length && <li className="p-2 text-xs text-muted-foreground">No matching workflows.</li>}
            </ul>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">No saved workflows.</p>
        )}
      </section>
    );
  },
  { op: 'WorkflowListPanel', capture: 0 }
);
