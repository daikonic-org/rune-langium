// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/** Read a bounded body, canceling the transport before rejecting oversized input. */
export async function readStreamBytes(
  stream: ReadableStream<Uint8Array>,
  limit: number,
  limitMessage: string
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > limit) throw new Error(limitMessage);
      chunks.push(next.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
