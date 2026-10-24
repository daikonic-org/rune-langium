// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { vi } from 'vitest';
import type { LspClientService } from '../../src/services/lsp-client.js';
/** App lifecycle tests share one complete service double as its contract evolves. */
export function createLspClientStub(): LspClientService {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    reconnect: vi.fn().mockResolvedValue(undefined),
    syncWorkspaceFiles: vi.fn(),
    syncWorkspaceModels: vi.fn().mockResolvedValue(undefined),
    suspendProjectResolution: vi.fn(),
    getPlugin: vi.fn().mockReturnValue(null),
    claimDocumentView: vi.fn().mockReturnValue(vi.fn()),
    isInitialized: vi.fn().mockReturnValue(false),
    onDiagnostics: vi.fn().mockReturnValue(vi.fn()),
    onDisplayFile: vi.fn().mockReturnValue(vi.fn()),
    dispose: vi.fn()
  };
}
