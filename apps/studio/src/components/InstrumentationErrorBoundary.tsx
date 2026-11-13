// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { emitRecord } from '@rune-langium/instrumentation-core';
import { signatureFor } from '../services/telemetry-capture.js';
import { Button } from '@rune-langium/design-system/ui/button';
import { CircleAlert, RotateCw } from 'lucide-react';

/**
 * React's render-crash mechanism is an Error Boundary (class component —
 * the only way React, including React 19, supports this API). This is
 * the ONE React-specific piece instrumentation doesn't get for free from
 * withInstrumentation on the component body: a component-body wrapper
 * doesn't catch effects failing (they run detached from the render call),
 * and a render crash must reach this boundary for sanitized reporting and
 * an accessible reload action.
 */
interface Props {
  children: ReactNode;
}
interface State {
  hasError: boolean;
}

export class InstrumentationErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    emitRecord({
      op: 'ReactRenderCrash',
      level: 'error',
      captured: 0,
      // signatureFor (telemetry-capture.ts) is allowlisted-name +
      // hashed-top-stack-frame, deliberately EXCLUDING error.message:
      // messages are low-entropy, guessable text that can interpolate
      // user/model content — see signatureFor's own doc comment. Never
      // put raw error.message in a shipped record.
      signature: signatureFor(error),
      // componentStack names studio's OWN components (bundled code shipped to
      // every user), not user content — safe to truncate-and-carry.
      context: { componentStack: info.componentStack?.slice(0, 500) },
      ts: Date.now()
    });
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <main className="flex min-h-dvh items-center justify-center bg-background p-6 text-foreground">
          <section role="alert" className="flex w-full max-w-md flex-col items-start gap-3">
            <CircleAlert className="size-6 text-destructive" aria-hidden="true" />
            <h1 className="text-lg font-semibold">Studio couldn’t display this view</h1>
            <p className="text-sm text-muted-foreground">Reload Studio to reopen your workspace.</p>
            <Button onClick={() => window.location.reload()}>
              <RotateCw className="size-4" aria-hidden="true" />
              Reload Studio
            </Button>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}
