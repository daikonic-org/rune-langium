// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/** Concrete codecs validate each linked node, including descendants behind base-typed fields. */
export function runeCodecRuntimeSource(): string {
  return `
const runeCodecValue = (input: unknown, declared: RuneValueType, operation: 'wire' | 'validate' | 'encode', concrete = new WeakMap<object, RuneValueType>(), tagged = false, active = new WeakSet<object>()): unknown => {
  input = runeObjectRaw(input);
  if (input == null) return input;
  if (Array.isArray(input)) return input.map(value => runeCodecValue(value, declared, operation, concrete, tagged, active));
  const model = typeof input === 'object' ? concrete.get(input) ?? runeValueConcreteType(input, declared) : declared;
  if (model.native) return input;
  if (typeof input !== 'object') throw new TypeError('Expected a Rune model object');
  if (active.has(input)) throw new TypeError('Cannot serialize a cyclic Rune value');
  active.add(input);
  try {
    const codec = model.codec?.();
    const encoded = operation === 'encode' ? codec?.encode(input) ?? input : input;
    if (encoded == null || typeof encoded !== 'object' || Array.isArray(encoded)) throw new TypeError('Rune codec did not produce a model object');
    const result = Object.fromEntries(Object.entries(encoded));
    for (const field of Object.values(model.fields)) {
      const child = runeValueType(field)?.();
      if (!child || child.native || !Object.hasOwn(encoded, field.key)) continue;
      const original: unknown = Reflect.get(input, field.key);
      const projected: unknown = Reflect.get(encoded, field.key);
      const item = (source: unknown, target: unknown): unknown => {
        if (!field.metadata) return runeCodecValue(operation === 'encode' ? source : target, child, operation, concrete, tagged, active);
        if (target == null || typeof target !== 'object' || Array.isArray(target)) return target;
        const envelope = Object.fromEntries(Object.entries(target));
        if (Object.hasOwn(envelope, 'value')) {
          const value = operation === 'encode' && source != null && typeof source === 'object' ? Reflect.get(source, 'value') : envelope.value;
          envelope.value = runeCodecValue(value, child, operation, concrete, tagged, active);
        }
        return envelope;
      };
      result[field.key] = Array.isArray(projected) ? projected.map((value, index) => item(Array.isArray(original) ? original[index] : original, value)) : item(original, projected);
    }
    if (operation === 'wire') return codec?.wire?.(result) ?? result;
    if (operation === 'validate') {
      codec?.validate?.(result);
      concrete.set(result, model);
    }
    if (operation === 'encode' && tagged && model.kind !== 'choice') result['@type'] = model.identity;
    return result;
  } finally { active.delete(input); }
};`;
}
