// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { createContext, useContext, useRef, useCallback, type ReactNode } from 'react';

export interface EditorCommitRegistry {
  register(flush: () => void | boolean): () => void;
  flush(): void;
}

export function createEditorCommitRegistry(): EditorCommitRegistry {
  const callbacks = new Set<() => void | boolean>();
  return {
    register(flush) {
      callbacks.add(flush);
      return () => {
        callbacks.delete(flush);
      };
    },
    flush() {
      // A flush can change field registration; newly mounted callbacks wait for the next flush.
      let blocked = false;
      // eslint-disable-next-line unicorn/no-useless-spread
      for (const flush of [...callbacks]) if (flush() === false) blocked = true;
      if (blocked) throw new Error('A valid Inspector edit is waiting for the current Rune source to parse.');
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

/** Local access to the provider's existing aggregate, also registered with an optional host. */
export function useInspectorCommitLifecycle(hostRegister?: (flush: () => void) => () => void) {
  const current = useRef<(() => void) | undefined>(undefined);
  const register = useCallback(
    (flush: () => void) => {
      current.current = flush;
      const dispose = hostRegister?.(flush);
      return () => {
        if (current.current === flush) current.current = undefined;
        dispose?.();
      };
    },
    [hostRegister]
  );
  return { register, flush: useCallback(() => current.current?.(), []) };
}
