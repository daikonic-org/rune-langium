// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * LspConnectionBadge — user-facing LSP connection state (019 Phase 2, Task 2.4).
 *
 * Renders a compact status badge suited to the editor footer:
 *  - status === 'connected': silent in production, a green dot in dev
 *  - status === 'connecting': "Connecting…" with a spinner
 *  - status === 'error' or status === 'disconnected':
 *      "Language services unavailable" + a Retry button
 *
 * The badge OWNS the user-visible copy. The transport-provider's
 * dev-mode error message exposes implementation detail like
 * "Pages Function LSP unreachable" — useful for logs, but not what end
 * users should read in the footer.
 *
 * State is passed in (rather than subscribed via a provider handle)
 * because the studio's EditorPage already subscribes upstream and re-
 * renders on TransportState changes; threading a state prop matches
 * the existing ConnectionStatus contract and avoids prop-drilling the
 * provider instance through the tree.
 */

import { AlertTriangle, RefreshCw } from 'lucide-react';
import type { ReactElement } from 'react';
import type { TransportState } from '../services/transport-provider.js';
import { withInstrumentation } from '../services/instrumentation/core.js';
import { Button } from '@rune-langium/design-system/ui/button';

export interface LspConnectionBadgeProps {
  state: TransportState;
  /** Called when the user clicks Retry. No-op if omitted. */
  onRetry?: () => void;
}

export const LspConnectionBadge = withInstrumentation(
  function LspConnectionBadge({ state, onRetry }: LspConnectionBadgeProps): ReactElement | null {
    if (state.status === 'connected') {
      // Dev-only success indicator; production is silent on success.
      if (typeof window !== 'undefined' && import.meta.env?.DEV) {
        return (
          <span data-testid="lsp-badge-connected" className="text-success text-xs">
            ●
          </span>
        );
      }
      return null;
    }

    if (state.status === 'connecting') {
      return (
        <span
          role="status"
          data-testid="lsp-badge-connecting"
          className="text-warning text-xs inline-flex items-center gap-1"
        >
          <RefreshCw aria-hidden="true" className="size-3 motion-safe:animate-spin" />
          Connecting…
        </span>
      );
    }

    // 'error' or 'disconnected' — surface FR-014 copy + recovery affordance.
    return (
      <span
        role="status"
        data-testid="lsp-badge-error"
        className="text-(--color-danger-base) text-xs inline-flex items-center gap-2"
      >
        <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0" />
        Language services unavailable
        {onRetry && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            data-testid="lsp-badge-retry"
            onClick={onRetry}
            className="shrink-0 underline underline-offset-2 hover:no-underline"
          >
            Retry
          </Button>
        )}
      </span>
    );
  },
  { op: 'LspConnectionBadge' }
);
