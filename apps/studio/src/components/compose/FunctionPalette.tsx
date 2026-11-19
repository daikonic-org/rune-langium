// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Daikonic contributors

import { useId, useMemo, type DragEvent } from 'react';
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
import { ListCard } from '@rune-langium/design-system/ui/list-card';
import { Plus, Workflow } from 'lucide-react';
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
  compositionIds: ReadonlySet<string>;
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
    compositionIds,
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
    const standardFunctions = useMemo(
      () =>
        compositionIds.size
          ? selectNodeRepository(
              new Map(
                functions
                  .all()
                  .filter((node) => !compositionIds.has(node.id))
                  .map((node) => [node.id, node])
              )
            )
          : functions,
      [functions, compositionIds]
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
    const compositionListId = useId();
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
        title={compositionIds.has(id) ? 'Add composition as a step' : 'Add function call'}
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
    const queryText = search.query.toLowerCase();
    const matches = entries.filter((entry) => entry.title.toLowerCase().includes(queryText));
    const compositions = matches.filter((entry) => compositionIds.has(entry.value));
    const suggestions = matches.filter((entry) => entry.suggested).slice(0, 5);

    return (
      <div className="function-composer__functions">
        {compositions.length > 0 && (
          <section aria-label="Compositions">
            <h2 className="section-heading">
              Compositions <NumberChiclet>{compositions.length}</NumberChiclet>
            </h2>
            <ul className="studio-scroll max-h-44 overflow-auto rounded-md border border-border bg-card p-1">
              {compositions.map((entry) => (
                <li key={entry.value} className="flex min-w-0 items-center gap-1">
                  <div
                    className="relative min-w-0 flex-1 rounded-sm px-2 py-1 hover:bg-accent data-[active=true]:bg-accent"
                    data-active={entry.value === selectedNodeId || undefined}
                    draggable={canAdd}
                    onDragStart={(event) => dragFunction(event, entry.value)}
                  >
                    <ListCard
                      icon={<Workflow />}
                      name={entry.label}
                      description={entry.namespace}
                      descriptionId={`${compositionListId}-${entry.value}`}
                    />
                    <button
                      type="button"
                      className="absolute inset-0 w-full rounded-sm"
                      aria-label={`Open ${entry.label} ${entry.namespace ?? ''}`}
                      aria-current={entry.value === selectedNodeId || undefined}
                      aria-describedby={entry.namespace ? `${compositionListId}-${entry.value}` : undefined}
                      title={entry.title}
                      onClick={() => onOpen(entry.value)}
                    />
                  </div>
                  {addButton(entry.value, entry.label)}
                </li>
              ))}
            </ul>
          </section>
        )}
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
        <section aria-label="Function library">
          <h2 className="section-heading">
            Functions <NumberChiclet>{standardFunctions.all().length}</NumberChiclet>
          </h2>
          <div className="function-composer__catalog">
            <NamespaceExplorerPanel
              compact
              fitContent
              nodeRepository={standardFunctions}
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
      </div>
    );
  },
  { op: 'FunctionPalette', capture: 0 }
);
