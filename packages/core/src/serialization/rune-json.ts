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
export const RUNE_JSON_NUMBER_TEXT_FIELD = '@numberText';
const jsonNumberPattern = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;
function rawJsonText(value: unknown): string | undefined {
  if (
    !value ||
    typeof value !== 'object' ||
    !('rawJSON' in value) ||
    !('isRawJSON' in JSON) ||
    typeof JSON.isRawJSON !== 'function' ||
    !JSON.isRawJSON(value)
  )
    return undefined;
  const text: unknown = Reflect.get(value, 'rawJSON');
  return typeof text === 'string' ? text : undefined;
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && rawJsonText(value) === undefined;
}
function plainJsonRecord(value: unknown): value is Record<string, unknown> {
  return record(value) && [null, Object.prototype].includes(Object.getPrototypeOf(value));
}

type JsonNumberText = string | { readonly [key: string]: JsonNumberText };

function rawJsonNumber(text: string): unknown {
  if (!('rawJSON' in JSON) || typeof JSON.rawJSON !== 'function')
    throw new Error('Exact JSON numbers require JSON.rawJSON support.');
  return JSON.rawJSON(text);
}

/** Use raw number tokens while the JSON codec moves fields into their canonical positions. */
export function parseJsonNumberText(text: string): unknown {
  return JSON.parse(text, (_key: string, value: unknown, context?: { source?: string }) => {
    if (typeof value !== 'number') return value;
    if (context?.source === undefined) throw new Error('Exact JSON numbers require JSON.parse source context.');
    return context.source === String(value) ? value : rawJsonNumber(context.source);
  });
}

/** Restore ordinary numbers and keep their source spelling on the owning record. */
export function retainJsonNumberText(input: unknown): unknown {
  const capture = (value: unknown): { value: unknown; text?: JsonNumberText } => {
    const raw = rawJsonText(value);
    if (raw !== undefined && jsonNumberPattern.test(raw)) return { value: Number(raw), text: raw };
    if (!Array.isArray(value) && !plainJsonRecord(value)) return { value };
    const entries: [string, unknown][] = [];
    const text: [string, JsonNumberText][] = [];
    for (const [key, child] of Object.entries(value)) {
      const captured = capture(child);
      entries.push([key, captured.value]);
      if (captured.text !== undefined) text.push([key, captured.text]);
    }
    if (Array.isArray(value)) {
      return { value: entries.map(([, item]) => item), ...(text.length ? { text: Object.fromEntries(text) } : {}) };
    }
    if (text.length && own(value, RUNE_JSON_NUMBER_TEXT_FIELD))
      throw new Error('Exact JSON number metadata conflicts with input.');
    if (text.length) entries.push([RUNE_JSON_NUMBER_TEXT_FIELD, Object.fromEntries(text)]);
    const result = Object.fromEntries(entries);
    const kind = encodingKinds.get(value);
    return { value: kind ? withRuneJsonEncoding(result, kind) : result };
  };
  const captured = capture(input);
  if (typeof captured.text === 'string')
    throw new TypeError('Exact JSON number text requires a containing object or array.');
  if (Array.isArray(captured.value) && captured.text !== undefined)
    Object.defineProperty(captured.value, RUNE_JSON_NUMBER_TEXT_FIELD, {
      value: captured.text,
      enumerable: true,
      writable: true,
      configurable: true
    });
  return captured.value;
}

/** Invalidate a replaced value's text and shift surviving tokens after array removal. */
export function clearJsonNumberText(
  value: object,
  path: string | readonly (string | number)[],
  removeIndex = false
): void {
  const text: unknown = own(value, RUNE_JSON_NUMBER_TEXT_FIELD)
    ? Reflect.get(value, RUNE_JSON_NUMBER_TEXT_FIELD)
    : undefined;
  if (!plainJsonRecord(text)) return;
  const edit = (
    tokens: Record<string, unknown>,
    [field, ...rest]: readonly (string | number)[]
  ): Record<string, unknown> => {
    if (field === undefined) return tokens;
    const key = String(field);
    if (rest.length) {
      const child = own(tokens, key) ? tokens[key] : undefined;
      if (!plainJsonRecord(child)) return tokens;
      const updated = edit(child, rest);
      if (updated === child) return tokens;
      const remaining = { ...tokens, [key]: updated };
      if (!Object.keys(updated).length) Reflect.deleteProperty(remaining, key);
      return remaining;
    }
    const shift = removeIndex && typeof field === 'number';
    if (!shift && !own(tokens, key)) return tokens;
    return Object.fromEntries(
      Object.entries(tokens)
        .filter(([name]) => name !== key)
        .map(([name, token]) => {
          const index = Number(name);
          const moved = shift && Number.isSafeInteger(index) && String(index) === name && index > field;
          return [moved ? String(index - 1) : name, token];
        })
    );
  };
  const remaining = edit(text, typeof path === 'string' ? [path] : path);
  if (remaining === text) return;
  if (Object.keys(remaining).length) Reflect.set(value, RUNE_JSON_NUMBER_TEXT_FIELD, remaining);
  else Reflect.deleteProperty(value, RUNE_JSON_NUMBER_TEXT_FIELD);
}

/** Emit original tokens only when the associated number is still current. */
export function restoreJsonNumberText(input: unknown): unknown {
  const active = new WeakSet<object>();
  const restore = (value: unknown, hint?: unknown): unknown => {
    if (
      typeof value === 'number' &&
      typeof hint === 'string' &&
      jsonNumberPattern.test(hint) &&
      Object.is(Number(hint), value)
    )
      return rawJsonNumber(hint);
    if (!Array.isArray(value) && !plainJsonRecord(value)) return value;
    if (active.has(value)) throw new TypeError('Cannot serialize a cyclic JSON value');
    active.add(value);
    try {
      const ownText: unknown = own(value, RUNE_JSON_NUMBER_TEXT_FIELD)
        ? Reflect.get(value, RUNE_JSON_NUMBER_TEXT_FIELD)
        : hint;
      const fieldText = (key: string) => (plainJsonRecord(ownText) && own(ownText, key) ? ownText[key] : undefined);
      if (Array.isArray(value)) return value.map((child, index) => restore(child, fieldText(String(index))));
      const result = Object.fromEntries(
        Object.entries(value)
          .filter(([key]) => key !== RUNE_JSON_NUMBER_TEXT_FIELD)
          .map(([key, child]) => [key, restore(child, fieldText(key))])
      );
      const kind = encodingKinds.get(value);
      return kind ? withRuneJsonEncoding(result, kind) : result;
    } finally {
      active.delete(value);
    }
  };
  return restore(input);
}

export type RuneJsonEncodingKind = 'data' | 'data-metadata' | 'envelope' | 'envelope-data' | 'choice';
const encodingKinds = new WeakMap<object, RuneJsonEncodingKind>();
/** Ephemeral declaration/wire context for serialization; never persisted or inferred from field names. */
export function withRuneJsonEncoding<T extends object>(value: T, kind: RuneJsonEncodingKind | object): T {
  const resolved = typeof kind === 'string' ? kind : encodingKinds.get(kind);
  if (!resolved) throw new Error('Rune JSON declaration context is unavailable.');
  encodingKinds.set(value, resolved);
  return value;
}

/** Linked ASTs and generated descriptors use the same cycle-safe ancestry rule. */
export function isRuneJsonAssignableType<T>(actual: T, expected: T, parent: (type: T) => T | undefined): boolean {
  const seen = new Set<T>();
  let current: T | undefined = actual;
  while (current !== undefined && !seen.has(current)) {
    if (current === expected) return true;
    seen.add(current);
    current = parent(current);
  }
  return false;
}

/** Linked ASTs and generated descriptors share recursive, cycle-safe Choice acceptance. */
export function acceptsRuneJsonChoice<T>(
  expected: T,
  matches: (type: T) => boolean,
  alternatives: (type: T) => readonly T[] | undefined
): boolean {
  const seen = new Set<T>();
  const visit = (type: T): boolean => {
    if (matches(type)) return true;
    if (seen.has(type)) return false;
    seen.add(type);
    return alternatives(type)?.some(visit) ?? false;
  };
  return visit(expected);
}

/** Prefer an exact Data arm only among matching alternatives; nested matches remain ambiguous. */
export function selectRuneJsonChoiceCandidates<T>(
  matches: readonly T[],
  isExact: (candidate: T) => boolean,
  isData: (candidate: T) => boolean
): readonly T[] {
  const exact = matches.filter(isExact);
  return exact.length && matches.every(isData) ? exact : matches;
}

/** Unwrap a declared Choice while retaining the wrapper's headers and decoded metadata. */
export function normalizeRuneJsonChoiceWrapper(
  value: unknown,
  identity: string | undefined,
  normalize: (payload: unknown) => unknown
): Record<string, unknown> | undefined {
  if (!record(value) || !own(value, '@data') || (value['@type'] !== undefined && value['@type'] !== identity))
    return undefined;
  const selected = normalize(value['@data']);
  if (!record(selected)) throw new Error('Rune JSON Choice payload must normalize as an object.');
  return {
    ...Object.fromEntries(Object.entries(value).filter(([key]) => key !== '@type' && key !== '@data')),
    ...selected
  };
}

/** Project actual Choice declarations; Data with inherited Choice arms keeps its own Data representation. */
export function projectRuneJsonChoice(
  value: Record<string, unknown>,
  identity: string | undefined,
  arms: readonly string[],
  normalize: (arm: string, value: unknown) => unknown
): object {
  const selected = arms.filter((key) => own(value, key) && value[key] != null);
  if (selected.length !== 1) throw new Error('Rune JSON serialization requires exactly one Choice option.');
  const meta = !arms.includes('meta') && record(value.meta) ? value.meta : undefined;
  if (Object.keys(value).some((key) => !key.startsWith('@') && !arms.includes(key) && !(key === 'meta' && meta)))
    throw new Error('Unknown Choice fields cannot be discarded during Rune JSON serialization.');
  const arm = selected[0]!;
  const body = normalize(arm, value[arm]);
  if (!record(body)) throw new Error('Rune JSON Choice option must serialize as an object.');
  const headers = Object.fromEntries(Object.entries(value).filter(([key]) => key !== '@type' && key.startsWith('@')));
  // A wrapper preserves distinct parent/arm headers and metadata instead of merging them into one record.
  if (meta || Object.keys(headers).length) {
    if (!identity) throw new Error('Rune JSON Choice wrapper requires its declaration identity.');
    return withRuneJsonEncoding({ ...headers, '@type': identity, '@data': body, ...(meta ? { meta } : {}) }, 'choice');
  }
  return withRuneJsonEncoding(body, body);
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
    const payload = value['@data'];
    const choice = record(payload) && typeof payload['@type'] === 'string';
    const headers = entries.every(
      ([key, child]) => ['@type', '@model', '@version'].includes(key) && typeof child === 'string'
    );
    if (choice && headers && (entries.length || (!meta.length && !refs.length))) {
      const body = withRuneJsonEncoding({ ...Object.fromEntries(entries), '@data': decodeRuneJson(payload) }, 'choice');
      if (own(value, '@key:scoped') || own(value, '@scheme') || refs.length)
        return withRuneJsonEncoding(
          { value: body, meta: Object.fromEntries(meta), ...Object.fromEntries(refs) },
          'envelope'
        );
      return withRuneJsonEncoding({ ...body, ...(meta.length ? { meta: Object.fromEntries(meta) } : {}) }, 'choice');
    }
    if (entries.length || own(value, 'value') || ((record(payload) || Array.isArray(payload)) && !choice))
      throw new Error('Rune JSON @data requires a scalar or typed Choice payload, without sibling object fields.');
    return withRuneJsonEncoding(
      { value: decodeRuneJson(value['@data']), meta: Object.fromEntries(meta), ...Object.fromEntries(refs) },
      choice ? 'envelope-data' : 'envelope'
    );
  }
  for (const [key] of refs)
    if (own(value, key)) throw new Error('Rune JSON contains conflicting wire and legacy references.');
  const body = Object.fromEntries(entries);
  // Scoped locations and schemes belong to attributes rather than a Data type.
  if ((own(value, '@key:scoped') || own(value, '@scheme') || refs.length) && entries.length) {
    return withRuneJsonEncoding(
      { value: withRuneJsonEncoding(body, 'data'), meta: Object.fromEntries(meta), ...Object.fromEntries(refs) },
      'envelope'
    );
  }
  return withRuneJsonEncoding(
    { ...body, ...(meta.length ? { meta: Object.fromEntries(meta) } : {}), ...Object.fromEntries(refs) },
    refs.length ? 'envelope' : meta.length ? 'data-metadata' : 'data'
  );
}

/** Rune's pattern wire value has a source string and no separate flags field. */
export function serializeRunePattern(value: globalThis.RegExp): string {
  if (value.flags) throw new TypeError('Rune JSON patterns cannot represent RegExp flags');
  return value.source;
}

/** Convert only explicit canonical metadata envelopes; ordinary `value` fields stay ordinary. */
export function encodeRuneJson(value: unknown): unknown {
  if (value instanceof globalThis.RegExp) return serializeRunePattern(value);
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
  const envelope = kind === 'envelope' || kind === 'envelope-data';
  if (envelope && !shape)
    throw new Error(
      'This metadata envelope has no supported Rune JSON representation; save as JSON to retain sibling fields.'
    );
  const referenceEnvelope =
    envelope && ['reference', 'globalReference', 'externalReference'].some((key) => own(value, key));
  const wrapped = own(value, 'value') && envelope && (meta || referenceEnvelope);
  const ordinary = Object.entries(value).filter(([key]) => !key.startsWith('@') && key !== 'meta');
  if (
    !kind &&
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
    if (record(payload) && kind !== 'envelope-data') result.push(...Object.entries(payload));
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
type NumberTextOptions = { preserveNumberText?: boolean };
export function projectDataFormat(value: string): ProjectDataFormat | undefined {
  if (value === 'JSON' || value === 'json') return 'JSON';
  if (value === 'RUNE_JSON' || value === 'rune-json') return 'RUNE_JSON';
  return undefined;
}
/** Host-neutral codec shared by repository files, generated-tool imports and Studio. */
export function parseProjectPayload(
  input: string | Uint8Array,
  format: string,
  options: NumberTextOptions = {}
): unknown {
  const selected = projectDataFormat(format);
  if (!selected) throw new Error('No installed codec supports serialization format ' + format + '.');
  const text = typeof input === 'string' ? input : new TextDecoder('utf-8', { fatal: true }).decode(input);
  const value: unknown = options.preserveNumberText ? parseJsonNumberText(text) : JSON.parse(text);
  const decoded = selected === 'RUNE_JSON' ? decodeRuneJson(value) : value;
  return options.preserveNumberText ? retainJsonNumberText(decoded) : decoded;
}
export function serializeProjectPayload(value: unknown, format: string, options: NumberTextOptions = {}): string {
  const selected = projectDataFormat(format);
  if (!selected) throw new Error('No installed codec supports serialization format ' + format + '.');
  const restored = options.preserveNumberText ? restoreJsonNumberText(value) : value;
  const text = JSON.stringify(selected === 'RUNE_JSON' ? encodeRuneJson(restored) : restored, null, 2);
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
