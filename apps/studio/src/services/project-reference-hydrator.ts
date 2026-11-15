// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { makeNodeId } from '@rune-langium/visual-editor/identifiers';
import type { WorkspaceState } from '../shell/providers/workspace-context.js';
import type { NamespaceHydrator } from './project-namespace-hydration.js';
import { materializeProjectReferenceView } from './project-reference-view.js';
import { linkDocument } from './workspace.js';
import { pathToUri } from '../utils/uri.js';
import { withInstrumentation } from './instrumentation/core.js';

interface ReferenceHydratorOptions {
  ready: Promise<WorkspaceState>;
  current(): WorkspaceState | undefined;
  selected(): string | null;
  publish(view: WorkspaceState): void;
  signal: AbortSignal;
}

/** One publication queue and immutable ownership boundary per captured project. */
export const createProjectReferenceHydrator = withInstrumentation(
  function createProjectReferenceHydrator(options: ReferenceHydratorOptions, link = linkDocument): NamespaceHydrator {
    let materialization = Promise.resolve();
    return async (namespaces, onProgress) => {
      const view = options.current() ?? (await options.ready);
      options.signal.throwIfAborted();
      const requested = new Set(namespaces);
      const materialized = new Set(view.parsedModels.map((entry) => entry.filePath));
      const targets = view.files.filter(
        (file) => file.refOnly && requested.has(file.namespace ?? '') && !materialized.has(file.path)
      );
      if ([...requested].some((namespace) => !view.files.some((file) => file.namespace === namespace)))
        throw new Error('Requested namespace is absent from the current verified reference inventory');
      const remainingCounts = new Map([...requested].map((namespace) => [namespace, 0]));
      for (const file of targets) {
        const namespace = file.namespace ?? '';
        remainingCounts.set(namespace, (remainingCounts.get(namespace) ?? 0) + 1);
      }
      let completed = [...remainingCounts.values()].filter((count) => count === 0).length;
      onProgress?.({ completed, total: requested.size });
      if (!targets.length) return;
      const load = async (file: WorkspaceState['files'][number]) => {
        const result = await link(pathToUri(file.path), true);
        options.signal.throwIfAborted();
        if (!result.linked || result.errors.length)
          throw new Error(result.errors.join('\n') || 'Reference namespace is unavailable');
        const namespace = file.namespace ?? '';
        const left = (remainingCounts.get(namespace) ?? 1) - 1;
        remainingCounts.set(namespace, left);
        if (left === 0) onProgress?.({ completed: ++completed, total: requested.size });
        return result;
      };
      const publish = (results: Awaited<ReturnType<typeof link>>[]) => {
        // Serialized publication prevents concurrent requests from losing each other's additions.
        const next = materialization.then(async () => {
          options.signal.throwIfAborted();
          const nextView = await materializeProjectReferenceView(
            options.current() ?? view,
            results.flatMap((result) => result.newModels),
            options.signal
          );
          options.signal.throwIfAborted();
          options.publish(nextView);
        });
        materialization = next.catch(() => undefined);
        return next;
      };
      // Publish the unambiguous selected declaration before unrelated files in its namespace.
      const selected = options.selected();
      const owners = new Set(
        view.deferredExports
          .filter((entry) =>
            entry.exports.some((item) => makeNodeId(entry.namespace, item.name, item.type) === selected)
          )
          .map((entry) => entry.filePath)
      );
      const priority = owners.size === 1 ? targets.find((file) => owners.has(file.path)) : undefined;
      if (priority && targets.length > 1) await publish([await load(priority)]);
      const remaining = priority && targets.length > 1 ? targets.filter((file) => file !== priority) : targets;
      await publish(await Promise.all(remaining.map(load)));
    };
  },
  {
    op: 'createProjectReferenceHydrator',
    capture: 0,
    sanitizeError: (error) => ({ signature: error instanceof Error ? error.name : 'Error' })
  }
);
