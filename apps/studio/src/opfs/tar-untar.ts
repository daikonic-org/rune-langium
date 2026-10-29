// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * extractTarGz — gunzip + ustar parse + write into OPFS.
 *
 * Why not `tar-stream`: the curated mirrors are < 5MB compressed and we
 * already pay the bundle cost of `pako`. A purpose-built ustar parser
 * is small and ships at ~1KB gzipped vs ~30KB for tar-stream.
 *
 * Supported entry kinds: regular files (typeflag '0' or NUL) and directories
 * (typeflag '5'). Paths are bounded by ustar's 100-byte name + 155-byte
 * prefix.
 *
 * Rejected (throws): hard links (typeflag '1'), symbolic links ('2'), and
 * any entry whose path contains a traversal segment, an empty segment,
 * `.` / `..`, a backslash, a leading `/`, or a NUL.
 *
 * Skipped (silently): PAX global headers ('g') and PAX extended headers
 * ('x') — for our curated sources the next ustar header is sufficient. Any
 * other unknown typeflag is rejected to fail loudly rather than silently
 * truncate to "we ignore the data."
 */

import { gzip, inflate } from 'pako';
import type { OpfsFs } from './opfs-fs.js';
import { withInstrumentation, Capture } from '../services/instrumentation/core.js';

export interface ExtractOptions {
  /** Called once per emitted file; useful for progress UI. */
  onEntry?: (path: string, sizeBytes: number) => void;
  /**
   * Filter — return false to skip an entry. Defaults to accepting all.
   * Useful for narrowing a curated archive to a specific subdirectory.
   */
  shouldExtract?: (path: string) => boolean;
  /**
   * Optional prefix prepended to every entry path before it's written to
   * the FS. e.g. with `pathPrefix: '/cdm-ws'` an entry `foo/a.txt` lands at
   * `/cdm-ws/foo/a.txt`. Lets callers scope an archive to a workspace
   * subdirectory without wrapping the whole `OpfsFs` interface.
   */
  pathPrefix?: string;
}

const BLOCK = 512;

interface UstarHeader {
  /** Full path, ustar-name. May start with leading './'. */
  name: string;
  /** Size in bytes. */
  size: number;
  /** Tar typeflag character. '0' / '\0' = file, '5' = dir, others see notes above. */
  typeflag: string;
}

export const extractTarGz = withInstrumentation(
  async function extractTarGz(gzBytes: Uint8Array, fs: OpfsFs, options: ExtractOptions = {}): Promise<void> {
    // Step 1: gunzip. pako throws on bad headers; we let that propagate so
    // the caller can surface 'archive_decode' per FR-002.
    const tar = inflate(gzBytes);

    const prefix = options.pathPrefix ? options.pathPrefix.replace(/\/$/, '') : '';

    // Step 2: walk 512-byte blocks.
    let offset = 0;
    while (offset + BLOCK <= tar.byteLength) {
      const headerBlock = tar.subarray(offset, offset + BLOCK);
      if (headerBlock.every((byte) => byte === 0)) {
        // Two zero blocks signal end-of-archive; one is enough for us to stop.
        break;
      }
      const header = parseUstarHeader(headerBlock);
      offset += BLOCK;

      const dataBlocks = Math.ceil(header.size / BLOCK);
      const dataEnd = offset + header.size;
      if (header.typeflag === '5') {
        const cleaned = cleanPath(header.name);
        if (cleaned && (!options.shouldExtract || options.shouldExtract(cleaned + '/'))) {
          try {
            await fs.mkdir(`${prefix}/${cleaned}`);
          } catch (err) {
            // Re-throw with the offending path so the curated-loader's
            // FR-002 mapper has somewhere to point the user.
            throw withCause(new Error(`tar: mkdir ${cleaned}/ failed: ${errMessage(err)}`), err);
          }
        }
      } else if (header.typeflag === '0' || header.typeflag === '\0' || header.typeflag === '') {
        const cleaned = cleanPath(header.name);
        if (cleaned && (!options.shouldExtract || options.shouldExtract(cleaned))) {
          const data = tar.subarray(offset, dataEnd);
          try {
            await fs.writeFile(`${prefix}/${cleaned}`, data);
          } catch (err) {
            throw withCause(new Error(`tar: writeFile ${cleaned} failed: ${errMessage(err)}`), err);
          }
          options.onEntry?.(cleaned, header.size);
        }
      } else if (header.typeflag === 'g' || header.typeflag === 'x') {
        // PAX headers — next ustar header carries the canonical name.
      } else if (header.typeflag === '1' || header.typeflag === '2') {
        throw new Error(`tar: links not supported (path=${header.name})`);
      } else {
        throw new Error(`tar: unsupported typeflag '${header.typeflag}' (path=${header.name})`);
      }

      offset += dataBlocks * BLOCK;
    }
    // `gzBytes` is raw archive binary (may be a curated public bundle OR a
    // user-uploaded instance bundle — see instance-bundle.ts's importBundle);
    // entries within can carry user instance data, so nothing about the
    // archive's content is captured. `options.pathPrefix` is an app-computed
    // workspace path — safe.
  },
  {
    op: 'extractTarGz',
    capture: Capture.Input,
    sanitize: (value, which) => {
      if (which !== 'input') return undefined;
      const [, , options] = value as [Uint8Array, unknown, ExtractOptions | undefined];
      return { pathPrefix: options?.pathPrefix };
    }
  }
);

function parseUstarHeader(block: Uint8Array): UstarHeader {
  const dec = new TextDecoder('utf-8');
  const slice = (start: number, end: number): string => {
    const sub = block.subarray(start, end);
    // Trim trailing NULs.
    let last = sub.length;
    while (last > 0 && sub[last - 1] === 0) last--;
    return dec.decode(sub.subarray(0, last));
  };

  const name = slice(0, 100);
  const sizeOctal = slice(124, 136).trim();
  const typeflag = slice(156, 157) || '\0';
  const prefix = slice(345, 500);

  const size = sizeOctal.length > 0 ? parseInt(sizeOctal, 8) : 0;
  const fullName = prefix.length > 0 ? `${prefix}/${name}` : name;
  return { name: fullName, size, typeflag };
}

function cleanPath(raw: string): string {
  let p = raw;
  if (p.startsWith('./')) p = p.slice(2);
  if (p.endsWith('/')) p = p.slice(0, -1);
  if (p.length === 0) return '';

  // Reject absolute paths, NUL bytes, and Windows separators outright.
  if (p.startsWith('/') || p.includes('\\') || p.includes('\0')) {
    throw new Error(`tar: rejected unsafe path (${raw})`);
  }

  // Walk segments and reject any that would escape the root or are empty.
  // This catches '..' as a whole segment without rejecting legitimate
  // names like 'a..b.txt'.
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.' || seg === '..') {
      throw new Error(`tar: rejected path-traversal entry (${raw})`);
    }
  }
  return p;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function withCause(err: Error, cause: unknown): Error {
  (err as Error & { cause?: unknown }).cause = cause;
  return err;
}

export interface TarEntry {
  path: string;
  data: Uint8Array;
}

/**
 * Builds one 512-byte ustar header. Field offsets mirror parseUstarHeader
 * above exactly: name 0-100, mode 100-108, uid 108-116, gid 116-124,
 * size 124-136, mtime 136-148, checksum 148-156, typeflag 156, magic
 * 257-263, version 263-265. Only the regular-file typeflag ('0') is
 * produced — no dirs/links, matching extractTarGz's create-side needs.
 */
function ustarHeaderBytes(path: string, size: number): Uint8Array {
  const header = new Uint8Array(BLOCK);
  const enc = new TextEncoder();
  const nameBytes = enc.encode(path);
  if (nameBytes.length > 100) {
    throw new Error(`tar: entry path exceeds 100-byte ustar name limit: ${path}`);
  }
  header.set(nameBytes, 0);
  header.set(enc.encode('0000644\0'), 100);
  header.set(enc.encode('0000000\0'), 108);
  header.set(enc.encode('0000000\0'), 116);
  const sizeOctal = size.toString(8).padStart(11, '0') + '\0';
  header.set(enc.encode(sizeOctal), 124);
  header.set(enc.encode('00000000000\0'), 136);
  header.set(enc.encode('        '), 148); // checksum placeholder while computing
  header[156] = '0'.charCodeAt(0); // typeflag: regular file
  header.set(enc.encode('ustar\0'), 257);
  header.set(enc.encode('00'), 263);

  let checksum = 0;
  for (const b of header) checksum += b;
  const checksumOctal = checksum.toString(8).padStart(6, '0') + '\0 ';
  header.set(enc.encode(checksumOctal), 148);
  return header;
}

function padTo512(data: Uint8Array): Uint8Array {
  const remainder = data.byteLength % BLOCK;
  if (remainder === 0) return data;
  const padded = new Uint8Array(data.byteLength + (BLOCK - remainder));
  padded.set(data);
  return padded;
}

export const createTarGz = withInstrumentation(
  function createTarGz(entries: TarEntry[]): Uint8Array {
    const parts: Uint8Array[] = [];
    for (const entry of entries) {
      parts.push(ustarHeaderBytes(entry.path, entry.data.byteLength));
      parts.push(padTo512(entry.data));
    }
    parts.push(new Uint8Array(BLOCK * 2)); // end-of-archive: two zero blocks

    const totalLength = parts.reduce((sum, p) => sum + p.byteLength, 0);
    const tar = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of parts) {
      tar.set(part, offset);
      offset += part.byteLength;
    }
    return gzip(tar);
    // `entries[].data` is raw file content (may be user instance data);
    // output is a raw binary archive — only an entry count is safe.
  },
  {
    op: 'createTarGz',
    capture: Capture.Input,
    sanitize: (value, which) => (which === 'input' ? { entryCount: (value as [TarEntry[]])[0].length } : undefined)
  }
);
