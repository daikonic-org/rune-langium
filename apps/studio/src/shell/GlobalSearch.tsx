// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { nameFromNodeId, selectNodeRepository, useEditorStore } from '@rune-langium/visual-editor';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger
} from '@rune-langium/design-system/ui/dialog';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@rune-langium/design-system/ui/command';
import type { CommandEntryGroup } from '@rune-langium/design-system/ui/command';
import { Kbd } from '@rune-langium/design-system/ui/kbd';
import { useWorkspaceOptional } from './providers/workspace-context.js';
import { PERSPECTIVES, resolveEffectivePerspective } from './perspectives/perspective-registry.js';
import { usePerspectiveStore } from '../store/perspective-store.js';
import { viewTypeInExplore, useExploreNavigationStore } from '../services/explore-navigation.js';
import { useExploreFileNavStore } from './explore-file-nav-store.js';
import { withInstrumentation } from '../services/instrumentation/core.js';
import { isUserWorkspaceFile } from '../services/workspace.js';

interface SearchAction {
  detail: string;
  run(): boolean;
}

/** Search the same declarations, files and destinations used by the workbench. */
export const GlobalSearch = withInstrumentation(
  function GlobalSearch({ hasWorkspace, hasExploreContent }: { hasWorkspace: boolean; hasExploreContent: boolean }) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [error, setError] = useState('');
    const workspace = useWorkspaceOptional();
    const nodesById = useEditorStore((state) => state.nodesById);
    const navigateToType = useExploreNavigationStore((state) => state.navigateToType);
    const repository = selectNodeRepository(nodesById);
    const needle = query.trim().toLocaleLowerCase();

    useEffect(() => {
      const handleKeyDown = (event: KeyboardEvent) => {
        if (
          event.metaKey !== event.ctrlKey &&
          !event.defaultPrevented &&
          !event.shiftKey &&
          !event.altKey &&
          !event.repeat &&
          event.key.toLowerCase() === 'k'
        ) {
          event.preventDefault();
          setOpen((value) => !value);
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    useEffect(() => {
      if (!open) {
        setQuery('');
        setError('');
      }
    }, [open]);

    const groups = useMemo<CommandEntryGroup<SearchAction>[]>(() => {
      const matches = (value: string) => value.toLocaleLowerCase().includes(needle);
      return [
        {
          id: 'types',
          items:
            hasExploreContent && navigateToType
              ? repository
                  .all()
                  .filter((node) => matches(node.id))
                  .slice(0, 20)
                  .map((node) => ({
                    label: nameFromNodeId(node.id),
                    searchText: node.id,
                    value: { detail: node.id, run: () => viewTypeInExplore(node.id) }
                  }))
              : []
        },
        {
          id: 'files',
          items: (workspace?.files ?? [])
            .filter((file) => isUserWorkspaceFile(file) && matches(file.path))
            .slice(0, 20)
            .map((file) => ({
              label: file.name,
              searchText: file.path,
              value: {
                detail: file.path,
                run: () => {
                  useExploreFileNavStore.getState().requestSourceFile(file.path);
                  usePerspectiveStore.getState().setActivePerspective('explore');
                  return true;
                }
              }
            }))
        },
        {
          id: 'commands',
          items: PERSPECTIVES.filter(
            (perspective) =>
              resolveEffectivePerspective(perspective.id, { hasWorkspace, hasExploreContent }) === perspective.id &&
              matches(`Open ${perspective.label}`)
          ).map((perspective) => ({
            label: `Open ${perspective.label}`,
            value: {
              detail: perspective.label,
              run: () => {
                usePerspectiveStore.getState().setActivePerspective(perspective.id);
                return true;
              }
            }
          }))
        }
      ];
    }, [hasExploreContent, hasWorkspace, navigateToType, needle, repository, workspace?.files]);

    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger
          render={
            <button
              type="button"
              className="studio-topbar__search"
              aria-label="Search types, text &amp; files…"
              title="Search Studio"
              aria-keyshortcuts="Meta+K Control+K"
            >
              <Search className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-left">Search types, text &amp; files…</span>
              <Kbd className="shrink-0">⌘K</Kbd>
            </button>
          }
        />
        <DialogContent className="max-h-[85vh] overflow-hidden">
          <DialogTitle>Search Studio</DialogTitle>
          <DialogDescription>
            Open a type, workspace file or destination. Refine your search to see more matches.
          </DialogDescription>
          <Command
            items={groups}
            onItemSelect={(action) => {
              if (action.run()) setOpen(false);
              else setError('Explore is still loading. Try opening this type again.');
            }}
          >
            <CommandInput
              aria-label="Search types, files and commands"
              placeholder="Type a name or namespace…"
              autoFocus
              onChange={(event) => {
                setQuery(event.target.value);
                setError('');
              }}
            />
            <CommandList>
              <CommandEmpty>No matches. Try a type name, namespace, file or destination.</CommandEmpty>
              {groups.map((group) => (
                <CommandGroup<SearchAction>
                  key={group.id}
                  id={group.id}
                  heading={
                    group.id === 'types'
                      ? 'Types and declarations'
                      : group.id === 'files'
                        ? 'Workspace files'
                        : 'Commands'
                  }
                >
                  {(item) => (
                    <CommandItem key={item.value.detail} value={item}>
                      <span className="min-w-0">
                        <span className="block truncate">{item.label}</span>
                        {item.value.detail !== item.label && (
                          <span className="block truncate text-xs text-muted-foreground">{item.value.detail}</span>
                        )}
                      </span>
                    </CommandItem>
                  )}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </DialogContent>
      </Dialog>
    );
  },
  { op: 'GlobalSearch' }
);
