// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import JSZip from 'jszip';
import { randomUUID } from 'node:crypto';

/** Retain endpoint/status evidence without session credentials. */
export function redactEvidenceText(text) {
  return text
    .replace(/(\/ws\/)[a-zA-Z0-9_.%~-]+/g, '$1[REDACTED]')
    .replace(/([?&](?:token|access_token|session_token)=)[^\s"'<>\\&#]+/gi, '$1[REDACTED]')
    .replace(/("(?:token|access_token|session_token)"\s*:\s*")[^"\\]*(?:\\.[^"\\]*)*(")/gi, '$1[REDACTED]$2')
    .replace(/\bBearer\s+[^\s"'<>\\,]+/gi, 'Bearer [REDACTED]');
}

function redactStructuredText(text) {
  function redactJson(line) {
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      return redactEvidenceText(line);
    }
    if (!value || typeof value !== 'object') return redactEvidenceText(line);
    let changed = false;
    function visit(input, key = '') {
      if (typeof input === 'string') {
        const output = /^(token|access_token|session_token)$/i.test(key)
          ? '[REDACTED]'
          : /^\s*[{[]/.test(input)
            ? redactStructuredText(input)
            : redactEvidenceText(input);
        if (output !== input) changed = true;
        return output;
      }
      if (Array.isArray(input)) return input.map((entry) => visit(entry));
      if (input && typeof input === 'object')
        return Object.fromEntries(Object.entries(input).map(([name, entry]) => [name, visit(entry, name)]));
      return input;
    }
    const output = visit(value);
    return changed ? JSON.stringify(output) : line;
  }
  // Trace events are JSONL; response bodies inside those events are JSON strings.
  try {
    JSON.parse(text);
    return redactJson(text);
  } catch {
    return text.split('\n').map(redactJson).join('\n');
  }
}

async function redactBytes(bytes, archive = false, location = 'artifact') {
  if (archive) {
    let zip;
    try {
      zip = await JSZip.loadAsync(bytes);
    } catch (cause) {
      throw new Error(`Cannot inspect ZIP evidence: ${redactEvidenceText(location)} (${bytes.length} bytes)`, {
        cause
      });
    }
    let changed = false;
    for (const entry of Object.values(zip.files)) {
      if (entry.dir) continue;
      const original = await entry.async('nodebuffer');
      const redacted = await redactBytes(original, entry.name.endsWith('.zip'), `${location}!${entry.name}`);
      if (!original.equals(redacted)) {
        // Playwright blob merging expects the original entry set, without synthesized directories.
        zip.file(entry.name, redacted, { createFolders: false });
        changed = true;
      }
    }
    return changed ? zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }) : bytes;
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return bytes;
  }
  // Playwright embeds its report data (including errors) in a base64 ZIP.
  const replacements = [];
  let prefix;
  do {
    prefix = `__rune_zip_${randomUUID()}_`;
  } while (text.includes(prefix));
  for (const match of text.matchAll(/data:application\/zip;base64,([a-zA-Z0-9+/=]+)/g)) {
    const original = Buffer.from(match[1], 'base64');
    const redacted = await redactBytes(original, true, `${location}!embedded-report@${match.index}`);
    const placeholder = `${prefix}${replacements.length}__`;
    replacements.push([
      placeholder,
      original.equals(redacted) ? match[0] : `data:application/zip;base64,${redacted.toString('base64')}`
    ]);
    text = text.replace(match[0], placeholder);
  }
  // Scan the surrounding structure without interpreting opaque Base64 as credentials.
  text = redactStructuredText(text);
  for (const [placeholder, redacted] of replacements) text = text.replaceAll(placeholder, redacted);
  return Buffer.from(text);
}

/** Corrupt archives fail closed; callers must not upload unchecked evidence. */
export async function redactTestArtifacts(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }
  let changed = 0;
  for (const entry of entries) {
    const file = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Refusing unchecked evidence symlink: ' + file);
    if (entry.isDirectory()) changed += await redactTestArtifacts(file);
    else if (entry.isFile()) {
      const original = await readFile(file);
      const redacted = await redactBytes(original, entry.name.endsWith('.zip'), file);
      if (!original.equals(redacted)) {
        await writeFile(file, redacted);
        changed++;
      }
    }
  }
  return changed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('Specify test artifact directories');
  for (const directory of process.argv.slice(2)) {
    const changed = await redactTestArtifacts(directory);
    console.log(`Redacted ${changed} artifact files in ${directory}`);
  }
}
