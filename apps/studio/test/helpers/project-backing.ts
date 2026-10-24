// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import type { Page } from '@playwright/test';
/** Access only the fresh browser context's editable project backing, never private journals. */
export async function projectBackingFiles(
  page: Page,
  writes?: Record<string, string>
): Promise<Record<string, string>> {
  return page.evaluate(async (writes) => {
    const root = await navigator.storage.getDirectory();
    async function read(dir: FileSystemDirectoryHandle, prefix = '', result: Record<string, string> = {}) {
      for await (const [name, entry] of dir.entries()) {
        if (entry.kind === 'directory') await read(entry, prefix + name + '/', result);
        else result[prefix + name] = await (await entry.getFile()).text();
      }
      return result;
    }
    for await (const [, directory] of root.entries()) {
      if (directory.kind !== 'directory') continue;
      let files: FileSystemDirectoryHandle;
      try {
        files = await directory.getDirectoryHandle('files');
      } catch {
        continue;
      }
      const current = await read(files);
      if (!current['build-config.yml'] && !Object.keys(current).some((path) => path.endsWith('.rosetta'))) continue;
      for (const [path, text] of Object.entries(writes ?? {})) {
        const segments = path.split('/');
        const name = segments.pop()!;
        let parent = files;
        for (const part of segments) parent = await parent.getDirectoryHandle(part, { create: true });
        const handle = await parent.getFileHandle(name, { create: true });
        const writer = await handle.createWritable();
        await writer.write(text);
        await writer.close();
      }
      return writes ? read(files) : current;
    }
    throw new Error('Editable project backing not found');
  }, writes);
}
