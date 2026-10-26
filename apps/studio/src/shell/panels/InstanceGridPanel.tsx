// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { ReferenceExampleImport } from '../../components/ReferenceExampleImport.js';
import { WorkflowImport } from '../../components/WorkflowImport.js';
import { Input } from '@rune-langium/design-system/ui/input';
import { Button } from '@rune-langium/design-system/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@rune-langium/design-system/ui/dialog';
import { WorkspaceTypePicker } from '../../components/WorkspaceTypePicker.js';
import { useInstanceStore } from '../../store/instance-store.js';
import { filterInstances, usePrototypeViewStore } from '../../store/prototype-view-store.js';
import { withInstrumentation } from '../../services/instrumentation/core.js';

function fieldValue(data: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, segment) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    return (value as Record<string, unknown>)[segment];
  }, data);
}

function displayFieldValue(value: unknown): string {
  if (value === undefined || value === null) return '—';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

export const InstanceGridPanel = withInstrumentation(
  function InstanceGridPanel(): ReactElement {
    const instances = useInstanceStore((state) => state.instances);
    const validationStatus = useInstanceStore((state) => state.validationStatus);
    const saveStates = useInstanceStore((state) => state.saveStates);
    const retrySave = useInstanceStore((state) => state.retrySave);
    const dispatchGenerateSchema = useInstanceStore((state) => state.dispatchGenerateSchema);
    const duplicateInstance = useInstanceStore((state) => state.duplicateInstance);
    const renameInstance = useInstanceStore((state) => state.renameInstance);
    const removeInstance = useInstanceStore((state) => state.removeInstance);
    const view = usePrototypeViewStore((state) => state.state);
    const patch = usePrototypeViewStore((state) => state.patch);
    const schema = useInstanceStore((state) => (view.typeFqn ? state.schemas.get(view.typeFqn) : undefined));
    const rows = filterInstances(Object.values(instances), view.query, view.typeFqn);
    const selectedOutsideFilter = view.selectedId && !rows.some((record) => record.id === view.selectedId);
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renamedName, setRenamedName] = useState('');
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const renaming = renamingId ? instances[renamingId] : undefined;
    const deleting = deletingId ? instances[deletingId] : undefined;
    const fields = useMemo(() => (schema?.targetId === view.typeFqn ? schema.fields : []), [schema, view.typeFqn]);

    useEffect(() => {
      if (view.typeFqn) dispatchGenerateSchema(view.typeFqn);
    }, [dispatchGenerateSchema, view.typeFqn]);

    const closeRename = () => {
      setRenamingId(null);
      setRenamedName('');
    };

    const confirmRename = () => {
      if (!renaming || !renamedName.trim()) return;
      try {
        renameInstance(renaming.id, renamedName);
        closeRename();
      } catch (error) {
        setActionError(error instanceof Error ? error.message : String(error));
      }
    };

    const confirmDelete = async () => {
      if (!deleting) return;
      const id = deleting.id;
      setActionError(null);
      try {
        await removeInstance(id);
        if (usePrototypeViewStore.getState().state.selectedId === id) patch({ selectedId: null });
        setDeletingId(null);
      } catch (error) {
        setActionError(error instanceof Error ? error.message : String(error));
      }
    };

    return (
      <section data-testid="prototype-grid" className="flex h-full min-h-0 flex-col" aria-label="Example table">
        <div className="flex flex-wrap gap-2 border-b border-border p-2">
          <Input
            aria-label="Search examples"
            value={view.query}
            onChange={(event) => patch({ query: event.target.value })}
            placeholder="Search name or type"
            className="h-8 min-w-48 flex-1"
          />
          <WorkflowImport
            multiple
            label="Import examples…"
            typeFqn={view.typeFqn ?? undefined}
            onImport={(values, typeFqn, codec) => {
              if (!typeFqn) throw new Error('Choose an object type.');
              values.forEach((data, index) =>
                useInstanceStore
                  .getState()
                  .createInstance(typeFqn, `Imported ${typeFqn.split('.').slice(-1)[0]} ${index + 1}`, {
                    data,
                    provenance: { codec: codec ?? 'json', importedAt: Date.now() }
                  })
              );
            }}
          />
          <ReferenceExampleImport />
          <div className="w-64 max-w-full">
            <WorkspaceTypePicker
              label="Filter example type"
              value={view.typeFqn}
              onSelect={(typeFqn) => patch({ typeFqn })}
              filterKinds={['data', 'choice']}
              allowClear
            />
          </div>
        </div>
        {selectedOutsideFilter && (
          <p className="border-b border-border px-3 py-1 text-xs text-muted-foreground">
            Selected example is outside this filter.
          </p>
        )}
        <div className="studio-scroll min-h-0 flex-1 overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-background text-xs text-muted-foreground">
              <tr>
                <th className="p-2">Name</th>
                <th className="p-2">Type</th>
                {fields.map((field) => (
                  <th key={field.path} className="p-2">
                    {field.label}
                  </th>
                ))}
                <th className="p-2">Validation</th>
                <th className="p-2">Save</th>
                <th className="p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {!rows.length ? (
                <tr>
                  <td colSpan={5 + fields.length} className="p-3 text-xs text-muted-foreground">
                    {view.query || view.typeFqn ? (
                      <>
                        No examples match these filters.{' '}
                        <Button variant="ghost" size="xs" onClick={() => patch({ query: '', typeFqn: null })}>
                          Clear filters
                        </Button>
                      </>
                    ) : (
                      'Import JSON examples to reuse inputs.'
                    )}
                  </td>
                </tr>
              ) : null}
              {rows.map((record) => (
                <tr
                  key={record.id}
                  role="row"
                  tabIndex={0}
                  aria-selected={record.id === view.selectedId}
                  className="cursor-pointer border-t border-border/60 hover:bg-accent aria-[selected=true]:bg-accent"
                  onClick={() => patch({ selectedId: record.id, bindingRequestId: (view.bindingRequestId ?? 0) + 1 })}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      patch({ selectedId: record.id, bindingRequestId: (view.bindingRequestId ?? 0) + 1 });
                    }
                  }}
                >
                  <td className="p-2 font-medium">{record.name}</td>
                  <td className="p-2 text-muted-foreground">{record.typeFqn}</td>
                  {fields.map((field) => (
                    <td
                      key={field.path}
                      className="max-w-48 truncate p-2"
                      title={displayFieldValue(fieldValue(record.data, field.path))}
                    >
                      {displayFieldValue(fieldValue(record.data, field.path))}
                    </td>
                  ))}
                  <td className="p-2 capitalize">{validationStatus[record.id] ?? 'pending'}</td>
                  <td className="p-2">
                    <div className="flex items-center gap-1">
                      <span className="capitalize">{saveStates[record.id]?.state ?? 'unsaved'}</span>
                      {saveStates[record.id]?.state === 'failed' ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          aria-label={`Retry saving ${record.name}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            setActionError(null);
                            void retrySave(record.id).catch((error) =>
                              setActionError(error instanceof Error ? error.message : String(error))
                            );
                          }}
                        >
                          Retry
                        </Button>
                      ) : null}
                    </div>
                  </td>
                  <td className="p-2">
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={(event) => {
                          event.stopPropagation();
                          patch({
                            selectedId: duplicateInstance(record.id)
                          });
                        }}
                      >
                        Duplicate
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={(event) => {
                          event.stopPropagation();
                          setActionError(null);
                          setRenamingId(record.id);
                          setRenamedName(record.name);
                        }}
                      >
                        Rename
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={(event) => {
                          event.stopPropagation();
                          setActionError(null);
                          setDeletingId(record.id);
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {actionError ? (
          <p role="alert" className="border-t border-border p-2 text-sm text-destructive">
            {actionError}
          </p>
        ) : null}
        <Dialog open={Boolean(renaming)} onOpenChange={(open) => !open && closeRename()}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Rename example</DialogTitle>
              <DialogDescription>Choose a name for {renaming?.name}.</DialogDescription>
            </DialogHeader>
            <Input
              aria-label="Example name"
              value={renamedName}
              onChange={(event) => setRenamedName(event.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={closeRename}>
                Cancel
              </Button>
              <Button type="button" disabled={!renamedName.trim()} onClick={confirmRename}>
                Rename
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        <Dialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeletingId(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Delete example?</DialogTitle>
              <DialogDescription>
                Delete {deleting?.name}? Its saved example data will be removed from this workspace.
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setDeletingId(null)}>
                Cancel
              </Button>
              <Button type="button" variant="destructive" onClick={() => void confirmDelete()}>
                Delete example
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </section>
    );
  },
  { op: 'InstanceGridPanel' }
);
