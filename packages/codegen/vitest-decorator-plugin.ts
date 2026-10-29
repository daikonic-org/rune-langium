// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import type { Plugin } from 'vitest/config';
import { lowerExplicitDecorators } from './scripts/explicit-decorators.js';

// ESNext preserves decorators that supported Node runtimes cannot yet execute.
// Reuse the production build's lowering for authored instrumentation sites only;
// never discover or insert instrumentation into undecorated code.
export function decoratorLoweringPlugin(): Plugin {
  return {
    name: 'codegen-decorator-lowering',
    enforce: 'pre',
    transform: lowerExplicitDecorators
  };
}
