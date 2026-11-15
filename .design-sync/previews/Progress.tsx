// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import './_studio-dark';
import { Progress } from '@rune-langium/design-system';

// J20 pinned source: completed namespace work, independent of overall linking readiness.
export const NamespaceLinking = () => (
  <div className="grid w-full max-w-sm gap-2">
    <Progress value={2} max={5} aria-label="Namespaces" aria-valuetext="2 of 5 namespaces" />
    <span className="text-xs tabular-nums text-muted-foreground">2 of 5 namespaces</span>
  </div>
);

export const DiscoveringFiles = () => <Progress value={null} aria-label="Discovering model files" />;

export const FilesReady = () => <Progress value={42} max={42} aria-label="Model files" />;
