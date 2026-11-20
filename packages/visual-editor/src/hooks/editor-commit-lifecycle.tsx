// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { createContext, useContext, useRef, useCallback, type ReactNode } from 'react';

export interface EditorCommitRegistry {
  register(flush: () => void | boolean, hasPending?: () => boolean): () => void;
  flush(): void;
  hasPending(): boolean;
}

export function createEditorCommitRegistry(): EditorCommitRegistry {
  const callbacks = new Map<() => void | boolean, (() => boolean) | undefined>();
  return {
    register(flush, hasPending) {
      callbacks.set(flush, hasPending);
      return () => {
        callbacks.delete(flush);
      };
    },
    flush() {
      // A flush can change field registration; newly mounted callbacks wait for the next flush.
      let blocked = false;
      // eslint-disable-next-line unicorn/no-useless-spread
      for (const flush of [...callbacks.keys()]) if (flush() === false) blocked = true;
      if (blocked) throw new Error('A valid Inspector edit is waiting for the current Rune source to parse.');
    },
    hasPending() {
      for (const hasPending of callbacks.values()) if (hasPending?.()) return true;
      return false;
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
export function useInspectorCommitLifecycle(hostRegister?: EditorCommitRegistry['register']) {
  const current = useRef<(() => void | boolean) | undefined>(undefined);
  const register = useCallback<EditorCommitRegistry['register']>(
    (flush, hasPending) => {
      current.current = flush;
      const dispose = hostRegister?.(flush, hasPending);
      return () => {
        if (current.current === flush) current.current = undefined;
        dispose?.();
      };
    },
    [hostRegister]
  );
  return { register, flush: useCallback(() => current.current?.(), []) };
}
