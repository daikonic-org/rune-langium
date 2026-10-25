// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import type { SymbolIdentity } from '@rune-langium/project-config';
/** Callbacks are registered by the installed host, never loaded from a repository path. */
export interface ImplementationProvider {
  id: string;
  supports(symbol: SymbolIdentity): boolean;
  invoke(args: readonly unknown[]): unknown;
}
