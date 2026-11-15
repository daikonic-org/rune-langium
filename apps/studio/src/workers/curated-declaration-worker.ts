// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { handleInspectNamespace } from '../services/curated-declaration-models.js';
import type { InspectNamespaceRequest } from './parser-worker.js';

self.onmessage = async (event: MessageEvent<InspectNamespaceRequest>) => {
  self.postMessage(await handleInspectNamespace(event.data));
};
