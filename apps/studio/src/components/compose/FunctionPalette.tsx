// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Daikonic contributors

import { useMemo, type DragEvent } from 'react';
import type { FunctionComposition } from '@rune-langium/core';
import {
  NamespaceExplorerPanel,
  buildTypeOptions,
  selectNodeRepository,
  type NodeRepository,
  type NamespaceExplorerPanelProps
} from '@rune-langium/visual-editor';
import { Button } from '@rune-langium/design-system/ui/button';
import { NumberChiclet } from '@rune-langium/design-system/ui/number-chiclet';
import { Plus } from 'lucide-react';
import { withInstrumentation } from '../../services/instrumentation/core.js';

export const COMPOSITION_FUNCTION_MIME = 'application/x-rune-composition-function';
const EMPTY = new Set<string>();
const ignoreNamespaceVisibility = () => {};
function dragFunction(event: DragEvent<HTMLElement>, id: string) {
  event.dataTransfer.setData(COMPOSITION_FUNCTION_MIME, id);
  event.dataTransfer.effectAllowed = 'copy';
}

interface FunctionPaletteProps {
  /** Full project inventory, including deferred curated declarations. */
  repository: NodeRepository;
  query: string;
  callables?: FunctionComposition['callables'];
  portContext?: string;
  selectedNodeId?: string;
  canAdd: boolean;
  onOpen: (id: string) => void;
  onAdd: (id: string) => void;
}

/** Compose supplies call actions; the Type Explorer owns search and navigation. */
export const FunctionPalette = withInstrumentation(
  function FunctionPalette({
    repository,
    query,
    callables,
    portContext,
    selectedNodeId,
    canAdd,
    onOpen,
    onAdd
  }: FunctionPaletteProps) {
    const functions = useMemo(
      () => selectNodeRepository(new Map(repository.byType('RosettaFunction').map((node) => [node.id, node]))),
      [repository]
    );
    const entries = useMemo(() => {
      const signatures = new Map(callables?.map((entry) => [`${entry.identity}#RosettaFunction`, entry]));
      return buildTypeOptions(functions, false).map((option) => {
        const callable = signatures.get(option.value);
        const signature = callable
          ? `${callable.inputs.map((input) => `${input.name}: ${input.type} ${input.cardinality}`).join(', ')} → ${callable.output ? `${callable.output.type} ${callable.output.cardinality}` : 'no output'}`
          : '';
        return {
          ...option,
          description: callable?.documentation || signature || option.namespace,
          title: [`${option.namespace}.${option.label}`, signature, callable?.documentation].filter(Boolean).join('\n'),
          suggested: Boolean(portContext && callable?.accepts[portContext]?.length)
        };
      });
    }, [functions, callables, portContext]);
    const entriesById = useMemo(() => new Map(entries.map((entry) => [entry.value, entry])), [entries]);
    const search = useMemo(
      () => ({ query: query.trim(), textByNode: new Map(entries.map((entry) => [entry.value, entry.title])) }),
      [query, entries]
    );
    const addButton = (id: string, name: string) => (
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label={`Add ${name}`}
        title="Add function call"
        disabled={!canAdd}
        draggable={canAdd}
        onDragStart={(event) => dragFunction(event, id)}
        onClick={() => onAdd(id)}
      >
        <Plus className="size-3" />
      </Button>
    );
    const presentation: NamespaceExplorerPanelProps['getNodePresentation'] = (id) => {
      const entry = entriesById.get(id);
      return {
        title: entry?.title,
        description: entry?.description,
        accessibleName: entry ? `Open ${entry.label} ${entry.namespace ?? ''}` : undefined,
        actions: addButton(id, entry?.label ?? id),
        draggable: canAdd,
        onDragStart: (event) => dragFunction(event, id)
      };
    };
    const suggestions = entries
      .filter((entry) => entry.suggested && entry.title.toLowerCase().includes(query.trim().toLowerCase()))
      .slice(0, 5);

    return (
      <section className="function-composer__functions" aria-label="Function library">
        <h2>
          Functions <NumberChiclet>{entries.length}</NumberChiclet>
        </h2>
        {suggestions.length > 0 && (
          <div className="function-composer__suggestions" role="group" aria-label="Suggested functions">
            <span>Suggested</span>
            {suggestions.map((entry) => (
              <Button
                key={entry.value}
                size="xs"
                variant="secondary"
                title={entry.title}
                aria-label={`Add suggested ${entry.label} ${entry.namespace}`}
                disabled={!canAdd}
                draggable={canAdd}
                onDragStart={(event) => dragFunction(event, entry.value)}
                onClick={() => onAdd(entry.value)}
              >
                <Plus className="size-3" />
                {entry.label}
              </Button>
            ))}
          </div>
        )}
        <div className="function-composer__catalog">
          <NamespaceExplorerPanel
            compact
            fitContent
            nodeRepository={functions}
            expandedNamespaces={EMPTY}
            hiddenNodeIds={EMPTY}
            onToggleNamespace={ignoreNamespaceVisibility}
            selectedNodeId={selectedNodeId}
            onSelectNode={onOpen}
            search={search}
            getNodePresentation={presentation}
          />
        </div>
      </section>
    );
  },
  { op: 'FunctionPalette', capture: 0 }
);
