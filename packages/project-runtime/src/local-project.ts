// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { readProjectSnapshot } from '@rune-langium/project-config';
import { createNodeProjectFileAdapter } from './node-files.js';
import { validateProjectTarget } from './build-project.js';

export async function openLocalProject(root: string, options: { privateRoot?: string } = {}) {
  const adapter = await createNodeProjectFileAdapter(root, options);
  const snapshot = await readProjectSnapshot({ workspaceId: root, adapter, validateTarget: validateProjectTarget });
  return { snapshot, adapter };
}
