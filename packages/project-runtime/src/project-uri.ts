// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { normalizeProjectPath } from '@rune-langium/project-config';
/** Virtual project URIs are shared by browser, language-service and native graph hosts. */
export function projectSourceUri(path: string): string {
  if (normalizeProjectPath(path) !== path) throw new Error('Invalid project source path: ' + path);
  return 'file:///workspace/' + path;
}
/** Preserve the exact URI namespace used by immutable curated serialized pointers. */
export function projectReferenceUri(path: string): string {
  const [model, ...parts] = path.split('/');
  const relative = parts.join('/');
  if (!model || !/^[a-z0-9-]+$/.test(model) || !relative || normalizeProjectPath(relative) !== relative)
    throw new Error('Invalid reference document path: ' + path);
  return `file:///[${model}]/${relative}`;
}
