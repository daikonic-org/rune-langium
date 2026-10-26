// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/** Rune wire metadata mapped to the shared generated-runtime representation. */
const metadata = {
  '@key': 'globalKey',
  '@key:external': 'externalKey',
  '@key:scoped': 'scopedKey',
  '@scheme': 'scheme'
} as const;
const references = {
  '@ref': 'globalReference',
  '@ref:external': 'externalReference'
} as const;
const own = (value: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(value, key);
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export type RuneJsonEncodingKind = 'data' | 'data-metadata' | 'envelope';
const encodingKinds = new WeakMap<object, RuneJsonEncodingKind>();
/** Ephemeral declaration/wire context for serialization; never persisted or inferred from field names. */
export function withRuneJsonEncoding<T extends object>(value: T, kind: RuneJsonEncodingKind | object): T {
  const resolved = typeof kind === 'string' ? kind : encodingKinds.get(kind);
  if (!resolved) throw new Error('Rune JSON declaration context is unavailable.');
  encodingKinds.set(value, resolved);
  return value;
}

/**
 * Keep model/type/version and unknown fields; never dereference or prune keys.
 * Structural and semantic validation remains with the selected model's runtime.
 */
export function decodeRuneJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeRuneJson);
  if (!record(value)) return value;
  const entries: [string, unknown][] = [];
  const meta: [string, unknown][] = [];
  const refs: [string, unknown][] = [];
  for (const [key, child] of Object.entries(value)) {
    if (own(metadata, key)) meta.push([metadata[key as keyof typeof metadata], decodeRuneJson(child)]);
    else if (own(references, key)) refs.push([references[key as keyof typeof references], decodeRuneJson(child)]);
    else if (key === '@ref:scoped') refs.push(['reference', { reference: decodeRuneJson(child), scope: 'DOCUMENT' }]);
    else if (key !== '@data') entries.push([key, decodeRuneJson(child)]);
  }
  if (meta.length && own(value, 'meta')) throw new Error('Rune JSON contains conflicting wire and legacy metadata.');
  if (own(value, '@data')) {
    if (entries.length || own(value, 'value') || (value['@data'] !== null && typeof value['@data'] === 'object'))
      throw new Error('Rune @data must not mix with object attributes.');
    return withRuneJsonEncoding(
      { value: decodeRuneJson(value['@data']), meta: Object.fromEntries(meta), ...Object.fromEntries(refs) },
      'envelope'
    );
  }
  for (const [key] of refs)
    if (own(value, key)) throw new Error('Rune JSON contains conflicting wire and legacy references.');
  const body = Object.fromEntries(entries);
  // Scoped locations and schemes belong to attributes rather than a Data type.
  if ((own(value, '@key:scoped') || own(value, '@scheme') || refs.length) && entries.length) {
    return withRuneJsonEncoding(
      { value: body, meta: Object.fromEntries(meta), ...Object.fromEntries(refs) },
      'envelope'
    );
  }
  return withRuneJsonEncoding(
    { ...body, ...(meta.length ? { meta: Object.fromEntries(meta) } : {}), ...Object.fromEntries(refs) },
    refs.length ? 'envelope' : meta.length ? 'data-metadata' : 'data'
  );
}

/** Convert only explicit canonical metadata envelopes; ordinary `value` fields stay ordinary. */
export function encodeRuneJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(encodeRuneJson);
  if (!record(value)) return value;
  const kind = encodingKinds.get(value);
  const meta = kind !== 'data' && record(value.meta) ? value.meta : undefined;
  const wrapperKeys = new Set(['value', 'meta', 'reference', 'globalReference', 'externalReference']);
  const shape = Object.keys(value).every((key) => wrapperKeys.has(key));
  if (
    !kind &&
    (own(value, 'meta') ||
      (shape && ['reference', 'globalReference', 'externalReference'].some((key) => own(value, key))))
  )
    throw new Error(
      'This record has no supported unambiguous Rune JSON representation without declaration context. Save as JSON or supply linked context.'
    );
  const envelope = kind === 'envelope';
  if (envelope && !shape)
    throw new Error(
      'This metadata envelope has no supported Rune JSON representation; save as JSON to retain sibling fields.'
    );
  const referenceEnvelope =
    envelope && ['reference', 'globalReference', 'externalReference'].some((key) => own(value, key));
  const wrapped = own(value, 'value') && envelope && (meta || referenceEnvelope);
  const ordinary = Object.entries(value).filter(([key]) => !key.startsWith('@') && key !== 'meta');
  if (
    !wrapped &&
    !referenceEnvelope &&
    !own(value, '@type') &&
    ordinary.length === 1 &&
    record(ordinary[0]![1]) &&
    own(ordinary[0]![1] as object, '@type')
  )
    throw new Error(
      'A typed container requires linked declaration context for Rune JSON serialization; use canonical JSON or supply that context.'
    );

  const result: [string, unknown][] = [];
  if (wrapped) {
    const payload = encodeRuneJson(value.value);
    if (record(payload)) result.push(...Object.entries(payload));
    else result.push(['@data', payload]);
  } else {
    for (const [key, child] of Object.entries(value)) {
      if (
        (key !== 'meta' || kind === 'data') &&
        (!referenceEnvelope || !['reference', 'globalReference', 'externalReference'].includes(key))
      )
        result.push([key, encodeRuneJson(child)]);
    }
  }
  if (meta) {
    const known = new Set(Object.values(metadata));
    if (Object.keys(meta).some((key) => !known.has(key as (typeof metadata)[keyof typeof metadata])))
      throw new Error('This metadata has no supported Rune JSON representation; save as JSON to retain it.');
    for (const [wire, key] of Object.entries(metadata))
      if (own(meta, key)) result.push([wire, encodeRuneJson(meta[key])]);
  } else if (kind !== 'data' && own(value, 'meta')) result.push(['meta', encodeRuneJson(value.meta)]);
  for (const [wire, key] of Object.entries(references))
    if (referenceEnvelope && own(value, key)) result.push([wire, encodeRuneJson(value[key])]);
  if (referenceEnvelope && own(value, 'reference')) {
    const ref = value.reference;
    if (
      !record(ref) ||
      Object.keys(ref).some((key) => !['reference', 'scope'].includes(key)) ||
      (ref.scope !== undefined && ref.scope !== 'DOCUMENT') ||
      !own(ref, 'reference')
    )
      throw new Error('This scoped reference has no supported Rune JSON representation; save as JSON to retain it.');
    result.push(['@ref:scoped', encodeRuneJson(ref.reference)]);
  }
  if (new Set(result.map(([key]) => key)).size !== result.length)
    throw new Error('Rune JSON serialization would overwrite an existing field.');
  return Object.fromEntries(result);
}

export type ProjectDataFormat = 'JSON' | 'RUNE_JSON';
export function projectDataFormat(value: string): ProjectDataFormat | undefined {
  if (value === 'JSON' || value === 'json') return 'JSON';
  if (value === 'RUNE_JSON' || value === 'rune-json') return 'RUNE_JSON';
  return undefined;
}
/** Host-neutral codec shared by repository files, generated-tool imports and Studio. */
export function parseProjectPayload(input: string | Uint8Array, format: string): unknown {
  const selected = projectDataFormat(format);
  if (!selected) throw new Error('No installed codec supports serialization format ' + format + '.');
  const value: unknown = JSON.parse(
    typeof input === 'string' ? input : new TextDecoder('utf-8', { fatal: true }).decode(input)
  );
  return selected === 'RUNE_JSON' ? decodeRuneJson(value) : value;
}
export function serializeProjectPayload(value: unknown, format: string): string {
  const selected = projectDataFormat(format);
  if (!selected) throw new Error('No installed codec supports serialization format ' + format + '.');
  const text = JSON.stringify(selected === 'RUNE_JSON' ? encodeRuneJson(value) : value, null, 2);
  if (text === undefined) throw new Error('The JSON codec cannot serialize this value.');
  return text;
}

/** Detect Rune wire markers structurally, including payloads without root headers. */
export function isRuneJsonPayload(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(isRuneJsonPayload);
  if (!record(value)) return false;
  return Object.entries(value).some(
    ([key, child]) =>
      own(metadata, key) ||
      own(references, key) ||
      ['@data', '@ref:scoped', '@model', '@type', '@version'].includes(key) ||
      isRuneJsonPayload(child)
  );
}
