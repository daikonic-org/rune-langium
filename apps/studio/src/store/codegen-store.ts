// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { create } from 'zustand';
import type { SourceMapEntry, Target } from '@rune-langium/codegen/export';

export interface CodePreviewFile {
  relativePath: string;
  content: string;
  sourceMap: SourceMapEntry[];
}

interface CodePreviewContents {
  files: CodePreviewFile[];
  activeRelativePath: string;
}

export type CodePreviewSnapshot =
  | { status: 'waiting'; target: Target; previous?: CodePreviewContents }
  | ({
      status: 'ready';
      target: Target;
    } & CodePreviewContents)
  | ({
      status: 'stale';
      target: Target;
      message: string;
    } & CodePreviewContents)
  | {
      status: 'unavailable';
      target: Target;
      message: string;
    };

interface CodegenState {
  refreshRevision: number;
  refreshCodePreview: () => void;
  /**
   * Cross-namespace dependency graph from the most recent /api/parse
   * response (spec 2026-05-14 §5.2). Keys are namespace names; values are
   * the transitive dep closure (incl. self). The Download config modal reads
   * this for its auto-select cascade + the namespace checklist. Empty until
   * the first parse completes (or if the server's fail-soft path returned no
   * graph).
   */
  dependencyGraph: Record<string, string[]>;
  codePreviewTarget: Target;
  /**
   * Target the UI is currently viewing in the code-preview pane.
   * `undefined` = no target focused → show the `CodegenTargetsTable`
   * (018 Task 0.7). Set to a target name to switch to the viewer for
   * that target. Independent of `codePreviewTarget`, which tracks
   * which target the worker has most recently generated for; the two
   * are coordinated by the panel (Task 0.8), not the store.
   */
  activeTarget: Target | undefined;
  currentRequestId: string;
  currentSelectionKey: string | undefined;
  snapshot: CodePreviewSnapshot;
  beginCodePreviewRequest: (target: Target, selectionKey?: string) => string;
  setDependencyGraph: (graph: Record<string, string[]>) => void;
  setCodePreviewTarget: (target: Target) => void;
  /** Switch the viewer to `target`, or pass `undefined` to return to the targets table. */
  setActiveTarget: (target: Target | undefined) => void;
  setActiveCodePreviewFile: (relativePath: string) => void;
  receiveCodePreviewResult: (input: { target: Target; files: CodePreviewFile[] }) => void;
  markCodePreviewStale: (input: { target: Target; message: string }) => void;
  markCodePreviewUnavailable: (input: { target: Target; message: string }) => void;
  resetCodegenState: () => void;
}

const DEFAULT_TARGET: Target = 'zod';
const INITIAL_REQUEST_ID = `codegen:${DEFAULT_TARGET}:0`;

function createInitialSnapshot(target: Target = DEFAULT_TARGET): Extract<CodePreviewSnapshot, { status: 'waiting' }> {
  return {
    status: 'waiting',
    target
  };
}

function pickActiveRelativePath(files: CodePreviewFile[], previousRelativePath?: string): string | undefined {
  if (files.length === 0) {
    return undefined;
  }
  if (previousRelativePath && files.some((file) => file.relativePath === previousRelativePath)) {
    return previousRelativePath;
  }
  return files[0]?.relativePath;
}

function previousContents(snapshot: CodePreviewSnapshot, target: Target): CodePreviewContents | undefined {
  if (snapshot.target !== target) return undefined;
  if (snapshot.status === 'waiting') return snapshot.previous;
  return 'files' in snapshot ? snapshot : undefined;
}

export const useCodegenStore = create<CodegenState>((set) => ({
  refreshRevision: 0,
  refreshCodePreview: () => set((state) => ({ refreshRevision: state.refreshRevision + 1 })),
  dependencyGraph: {},
  codePreviewTarget: DEFAULT_TARGET,
  activeTarget: undefined,
  currentRequestId: INITIAL_REQUEST_ID,
  currentSelectionKey: undefined,
  snapshot: createInitialSnapshot(),
  setDependencyGraph: (graph) => set({ dependencyGraph: graph }),
  beginCodePreviewRequest: (target, selectionKey) => {
    const requestId = `codegen:${target}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    set((state) => ({
      codePreviewTarget: target,
      currentRequestId: requestId,
      currentSelectionKey: selectionKey,
      snapshot: {
        ...createInitialSnapshot(target),
        previous: state.currentSelectionKey === selectionKey ? previousContents(state.snapshot, target) : undefined
      }
    }));
    return requestId;
  },
  setCodePreviewTarget: (target) =>
    set({
      codePreviewTarget: target,
      currentRequestId: `codegen:${target}:0`,
      currentSelectionKey: undefined,
      snapshot: createInitialSnapshot(target)
    }),
  setActiveTarget: (target) => set({ activeTarget: target }),
  setActiveCodePreviewFile: (relativePath) =>
    set((state) => {
      if (!('files' in state.snapshot) || !state.snapshot.files?.some((file) => file.relativePath === relativePath)) {
        return state;
      }
      return {
        snapshot: {
          ...state.snapshot,
          activeRelativePath: relativePath
        }
      };
    }),
  receiveCodePreviewResult: (input) =>
    set((state) => {
      const previousActive = previousContents(state.snapshot, input.target)?.activeRelativePath;
      const activeRelativePath = pickActiveRelativePath(input.files, previousActive);
      if (!activeRelativePath) {
        return {
          codePreviewTarget: input.target,
          snapshot: {
            status: 'unavailable',
            target: input.target,
            message: 'No code preview files were generated.'
          }
        };
      }
      return {
        codePreviewTarget: input.target,
        snapshot: {
          status: 'ready',
          target: input.target,
          files: input.files,
          activeRelativePath
        }
      };
    }),
  markCodePreviewStale: (input) =>
    set((state) => {
      const previous = previousContents(state.snapshot, input.target);
      const previousFiles = previous?.files;
      const activeRelativePath = previous?.activeRelativePath;
      if (!previousFiles || previousFiles.length === 0 || !activeRelativePath) {
        return {
          codePreviewTarget: input.target,
          snapshot: {
            status: 'unavailable',
            target: input.target,
            message: input.message
          }
        };
      }
      return {
        codePreviewTarget: input.target,
        snapshot: {
          status: 'stale',
          target: input.target,
          message: input.message,
          files: previousFiles,
          activeRelativePath
        }
      };
    }),
  markCodePreviewUnavailable: (input) =>
    set(() => ({
      codePreviewTarget: input.target,
      snapshot: {
        status: 'unavailable',
        target: input.target,
        message: input.message
      }
    })),
  resetCodegenState: () =>
    set({
      refreshRevision: 0,
      dependencyGraph: {},
      codePreviewTarget: DEFAULT_TARGET,
      activeTarget: undefined,
      currentRequestId: INITIAL_REQUEST_ID,
      currentSelectionKey: undefined,
      snapshot: createInitialSnapshot()
    })
}));
