// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { handleCodegenDownload } from '../services/codegen-download-handler.js';
import type { CodegenDownloadReply } from '../services/codegen-download-client.js';
import type { ProjectRuntimeInput } from '../services/project-runtime-input.js';

self.onmessage = async (event: MessageEvent<Record<string, unknown> & { project?: ProjectRuntimeInput }>) => {
  try {
    const { project, ...payload } = event.data;
    const response = await handleCodegenDownload({
      project,
      request: new Request(self.location.origin + '/api/codegen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
    });
    const body = await response.arrayBuffer();
    const reply: CodegenDownloadReply = { body, status: response.status, headers: [...response.headers.entries()] };
    self.postMessage(reply, { transfer: [body] });
  } catch (error) {
    const reply: CodegenDownloadReply = { error: error instanceof Error ? error.message : String(error) };
    self.postMessage(reply);
  }
};
