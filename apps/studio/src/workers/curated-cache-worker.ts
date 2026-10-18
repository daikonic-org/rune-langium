// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { createCuratedCacheSeeder } from '../services/curated-cache-seeder.js';
import type { CuratedCacheMessage } from '../services/curated-cache-seeds.js';

const seeder = createCuratedCacheSeeder();
let nextClient = 0;

function connect(port: Pick<MessagePort, 'onmessage'>) {
  const id = nextClient++;
  port.onmessage = (event: MessageEvent<CuratedCacheMessage>) => {
    const message = event.data;
    if (!message || typeof message !== 'object') return;
    if (message.type === 'seed') seeder.seed(id, message.seeds);
    else if (message.type === 'foreground' && typeof message.active === 'boolean')
      seeder.foreground(id, message.active);
    else if (message.type === 'dispose') {
      seeder.disconnect(id);
      port.onmessage = null;
    }
  };
}

// One implementation supports a SharedWorker and its dedicated-worker fallback.
const scope = globalThis as unknown as {
  onconnect?: (event: MessageEvent & { ports: MessagePort[] }) => void;
  onmessage: MessagePort['onmessage'];
};
if ('onconnect' in scope) {
  scope.onconnect = (event) => {
    const port = event.ports[0]!;
    connect(port);
    port.start();
  };
} else connect(scope);
