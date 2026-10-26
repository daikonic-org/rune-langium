// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { withInstrumentation } from '../../services/instrumentation/core.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { canonicalProjectJson, ProjectSnapshotError, type ProjectDiagnostic } from '@rune-langium/project-config';
import type { ReferenceDocument } from '@rune-langium/project-runtime/references';
import {
  createProjectReferenceTransport,
  loadProjectReferences,
  projectReferenceCache
} from '../../services/project-references.js';
import {
  captureProjectRuntimeInput,
  projectRuntimeSources,
  type ProjectRuntimeInput
} from '../../services/project-runtime-input.js';
import type { WorkspaceFile } from '../../services/workspace.js';
import type { ProjectState, ProjectRuntimeState } from './project-context.js';

/** Capture availability is separate from each host's applied-receipt acknowledgement. */
export const useProjectRuntime = withInstrumentation(
  function useProjectRuntime(project: ProjectState, files: readonly WorkspaceFile[]): ProjectRuntimeState {
    const [attempt, setAttempt] = useState(0);
    const retry = useCallback(() => setAttempt((value) => value + 1), []);
    const saved = project.snapshot;
    const managed = Boolean(
      saved?.files.has('build-config.yml') ||
      saved?.files.has('build-config.yaml') ||
      project.diagnostics.some((issue) => /^(build-config|rune-config|studio-config)/.test(issue.path))
    );
    const referenceKey =
      managed && saved && project.status === 'ready'
        ? canonicalProjectJson({
            workspaceId: saved.workspaceId,
            references: saved.project.build.references,
            lock: saved.lock ?? null
          })
        : undefined;
    const sourceKey =
      managed && project.status === 'ready'
        ? canonicalProjectJson(Object.fromEntries(projectRuntimeSources(files)))
        : undefined;
    const filesRef = useRef(files);
    filesRef.current = files;
    const savedRef = useRef(saved);
    savedRef.current = saved;
    const [references, setReferences] = useState<{
      key?: string;
      documents?: readonly ReferenceDocument[];
      diagnostics?: readonly ProjectDiagnostic[];
    }>({});
    const [captured, setCaptured] = useState<{
      workspaceId: string;
      revision: string;
      referenceKey: string;
      sourceKey: string;
      input?: ProjectRuntimeInput;
      diagnostics?: readonly ProjectDiagnostic[];
    }>();
    useEffect(() => {
      const snapshot = savedRef.current;
      if (!referenceKey || !snapshot) {
        setReferences((current) => (current.key ? {} : current));
        return;
      }
      const abort = new AbortController();
      let cancelled = false;
      setReferences({ key: referenceKey });
      void loadProjectReferences(snapshot, createProjectReferenceTransport(), projectReferenceCache, abort.signal)
        .then((result) => {
          if (!cancelled)
            setReferences({ key: referenceKey, documents: result.documents, diagnostics: result.diagnostics });
        })
        .catch((error) => {
          if (!cancelled) setReferences({ key: referenceKey, diagnostics: diagnostic(error) });
        });
      return () => {
        cancelled = true;
        abort.abort();
      };
    }, [referenceKey, attempt]);
    const revision = saved?.revision;
    const documents = references.key === referenceKey ? references.documents : undefined;
    useEffect(() => {
      const snapshot = savedRef.current;
      if (!snapshot || !revision || !referenceKey || !sourceKey || !documents || references.diagnostics?.length) {
        setCaptured(undefined);
        return;
      }
      let cancelled = false;
      const identity = { workspaceId: snapshot.workspaceId, revision, referenceKey, sourceKey };
      void captureProjectRuntimeInput(snapshot, filesRef.current, documents)
        .then((input) => {
          if (!cancelled) setCaptured({ ...identity, input });
        })
        .catch((error) => {
          if (!cancelled) setCaptured({ ...identity, diagnostics: diagnostic(error) });
        });
      return () => {
        cancelled = true;
      };
    }, [project.workspaceId, revision, referenceKey, documents, references.diagnostics, sourceKey]);
    if (project.status === 'unavailable') return { managed: false, status: 'legacy', diagnostics: [] };
    if (project.status === 'loading') return { managed, status: 'loading', diagnostics: [] };
    if (project.status === 'invalid') return { managed, status: 'unavailable', diagnostics: project.diagnostics };
    if (!managed) return { managed: false, status: 'legacy', diagnostics: [] };
    if (references.key === referenceKey && references.diagnostics?.length)
      return { managed: true, status: 'unavailable', diagnostics: references.diagnostics, retry, refresh: retry };
    if (
      !documents ||
      !captured ||
      captured?.workspaceId !== project.workspaceId ||
      captured?.revision !== revision ||
      captured?.referenceKey !== referenceKey ||
      captured?.sourceKey !== sourceKey
    )
      return { managed: true, status: 'loading', diagnostics: [], refresh: retry };
    if (captured.diagnostics?.length)
      return { managed: true, status: 'unavailable', diagnostics: captured.diagnostics, retry, refresh: retry };
    return captured.input
      ? { managed: true, status: 'captured', input: captured.input, diagnostics: [], refresh: retry }
      : { managed: true, status: 'loading', diagnostics: [], refresh: retry };
  },
  { op: 'useProjectRuntime', capture: 0 }
);

function diagnostic(error: unknown): readonly ProjectDiagnostic[] {
  return error instanceof ProjectSnapshotError
    ? error.diagnostics
    : [
        {
          code: 'PROJECT_RUNTIME_UNAVAILABLE',
          path: 'build-config.yml',
          severity: 'error',
          message: error instanceof Error ? error.message : 'Project unavailable. Reload the workspace and retry.'
        }
      ];
}
