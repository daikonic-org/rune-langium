// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { createContext, useContext, type ReactNode } from 'react';

export interface EditorCommitRegistry {
  register(flush: () => void): () => void;
  flush(): void;
}

export function createEditorCommitRegistry(): EditorCommitRegistry {
  const callbacks = new Set<() => void>();
  return {
    register(flush) {
      callbacks.add(flush);
      return () => {
        callbacks.delete(flush);
      };
    },
    flush() {
      // A flush can change field registration; newly mounted callbacks wait for the next flush.
      // eslint-disable-next-line unicorn/no-useless-spread
      for (const flush of [...callbacks]) flush();
    }
  };
}

const CommitContext = createContext<EditorCommitRegistry | undefined>(undefined);
export function EditorCommitProvider({ registry, children }: { registry: EditorCommitRegistry; children: ReactNode }) {
  return <CommitContext.Provider value={registry}>{children}</CommitContext.Provider>;
}
export function useEditorCommitRegistry(): EditorCommitRegistry | undefined {
  return useContext(CommitContext);
}
