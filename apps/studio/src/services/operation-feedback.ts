// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { useActivityStore, type AddActivityMeta } from '../store/activity-store.js';
import { useOutputStore, fmtLine } from '../store/output-store.js';
import { withInstrumentation } from './instrumentation/core.js';
import { allocateOpId } from './op-log.js';

/** Record an operation independently of whether its owner also displays a toast. */
export const recordOperation = withInstrumentation(
  function recordOperation(
    tag: string,
    message: string,
    level: 'info' | 'success' | 'warn' | 'error' = 'info',
    metadata: AddActivityMeta = {}
  ): number {
    const opId = metadata.opId ?? allocateOpId();
    const meta = { op: tag, ...metadata, opId };
    useActivityStore.getState().addActivity(tag, level !== 'error', message, meta);
    useOutputStore.getState().addLine(fmtLine(tag, message), level, meta);
    return opId;
  },
  { op: 'recordOperation' }
);
