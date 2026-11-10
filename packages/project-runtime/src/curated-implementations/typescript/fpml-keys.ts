// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import type { FpmlHashLayout, FpmlKeyRecipe } from '../fpml-keys.js';

export function fpmlKey(recipe: FpmlKeyRecipe, layout: FpmlHashLayout) {
  const rows = Object.entries(layout).map(([name, row]) => '  ' + JSON.stringify(name) + ': ' + JSON.stringify(row));
  return {
    call: true,
    dependencies: ['@js-temporal/polyfill'],
    expression:
      '(prefix: string, ' +
      (recipe.includeId ? 'id: string | undefined, ' : '') +
      'value: unknown) => ' +
      '$rune$fpmlKey(prefix, value, ' +
      JSON.stringify(recipe.type) +
      ', ' +
      [recipe.missing, recipe.modulus, recipe.includePrefix, recipe.includeId ? 'id ?? null' : 'undefined'].join(', ') +
      ')',
    moduleSource: fpmlHashSource.replace('/* hash layout */', () => rows.join(',\n'))
  };
}

const fpmlHashSource = String.raw`const $rune$fpmlKey = (() => {
  type Field = readonly [string, string, number];
  const layout: Readonly<Partial<Record<string, readonly [string | null, readonly Field[]]>>> = {
/* hash layout */
  };
  const record = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
  const numberText = (value: unknown): string | undefined =>
    record(value) && 'isRawJSON' in JSON && typeof JSON.isRawJSON === 'function' &&
    JSON.isRawJSON(value) && typeof value.rawJSON === 'string' ? value.rawJSON : undefined;
  const mix = (hash: number, value: number) => (Math.imul(31, hash) + value) | 0;
  function stringHash(value: string): number {
    let hash = 0;
    for (let index = 0; index < value.length; index++) hash = mix(hash, value.charCodeAt(index));
    return hash;
  }
  function decimalHash(value: unknown): number {
    const text = typeof value === 'number' ? String(value) : numberText(value);
    const match = text && /^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(text);
    if (!match) throw new TypeError('Expected a finite FpML decimal');
    const fraction = match[3] ?? '';
    const scale = BigInt(fraction.length) - BigInt(match[4] ?? 0);
    if (scale < -2147483648n || scale > 2147483647n) throw new RangeError('FpML decimal scale exceeds Java BigDecimal');
    const hex = BigInt(match[2] + fraction).toString(16);
    let hash = 0;
    let end = hex.length % 8 || 8;
    for (let start = 0; start < hex.length; start = end, end += 8)
      hash = mix(hash, Number.parseInt(hex.slice(start, end), 16));
    return mix(match[1] === '-' ? -hash : hash, Number(scale));
  }
  function timeHash(value: Temporal.PlainTime): number {
    const seconds = value.hour * 3600 + value.minute * 60 + value.second;
    const nanos = BigInt(seconds) * 1000000000n
      + BigInt(value.millisecond * 1000000 + value.microsecond * 1000 + value.nanosecond);
    return Number(BigInt.asIntN(32, nanos ^ (nanos >> 32n)));
  }
  function offsetSeconds(text: string): number {
    if (text === 'Z') return 0;
    const [hours, minutes, seconds = 0] = text.slice(1).split(':').map(Number);
    if (hours > 18 || minutes > 59 || seconds > 59 || (hours === 18 && (minutes || seconds)))
      throw new RangeError('Invalid FpML timezone offset: ' + text);
    return (text.startsWith('-') ? -1 : 1) * (hours * 3600 + minutes * 60 + seconds);
  }
  function timestampHash(text: string): number {
    const match = /^(.*?)(Z|[+-]\d{2}:\d{2}(?::\d{2})?)(?:\[([^\]]+)\])?$/.exec(text);
    if (!match) throw new TypeError('Expected an FpML timestamp with an offset');
    const [, local, offset, zone] = match;
    const sourceOffset = offsetSeconds(offset);
    const fixed = zone?.match(/^(UTC|GMT|UT)?(Z|[+-]\d{2}:\d{2}(?::\d{2})?)$/);
    let time: Temporal.PlainDateTime;
    let offsetValue: number;
    let zoneHash: number;
    if (zone === undefined || fixed) {
      offsetValue = fixed ? offsetSeconds(fixed[2]) : sourceOffset;
      time = Temporal.PlainDateTime.from(local).add({ seconds: offsetValue - sourceOffset });
      zoneHash = fixed?.[1] ? stringHash(fixed[1] + (offsetValue === 0 ? '' : fixed[2])) : offsetValue;
    } else {
      const zoned = Temporal.ZonedDateTime.from(local + offset + '[' + (zone === 'UT' ? 'UTC' : zone) + ']', { offset: 'use' });
      time = zoned.toPlainDateTime();
      offsetValue = zoned.offsetNanoseconds / 1000000000;
      zoneHash = stringHash(zone);
    }
    const date = (time.year & 0xfffff800) ^ ((time.year << 11) + (time.month << 6) + time.day);
    return date ^ timeHash(time.toPlainTime()) ^ offsetValue ^ ((zoneHash << 3) | (zoneHash >>> 29));
  }
  function hash(value: unknown, declared: string): number {
    if (value == null) return 0;
    switch (declared) {
      case 'java.lang.String':
        if (typeof value === 'string') return stringHash(value);
        break;
      case 'java.lang.Boolean':
        if (typeof value === 'boolean') return value ? 1231 : 1237;
        break;
      case 'java.lang.Integer':
        if (typeof value === 'number' && value === (value | 0)) return value;
        const parsed = Number(numberText(value));
        if (parsed === (parsed | 0)) return parsed;
        break;
      case 'java.math.BigDecimal':
        return decimalHash(value);
      case 'java.time.LocalTime':
        if (typeof value === 'string') return timeHash(Temporal.PlainTime.from(value));
        break;
      case 'java.time.ZonedDateTime':
        if (typeof value === 'string') return timestampHash(value);
        break;
      default:
        if (record(value)) {
          const actual = value['@type'] ?? declared;
          if (typeof actual !== 'string') throw new TypeError('Invalid FpML type tag');
          let ancestor: string | null | undefined = actual;
          while (ancestor && ancestor !== declared) ancestor = layout[ancestor]?.[0];
          if (ancestor !== declared) throw new TypeError(actual + ' does not extend ' + declared);
          return fieldsHash(value, actual);
        }
    }
    throw new TypeError('Invalid FpML hash field of type ' + declared);
  }
  function fieldsHash(value: Record<string, unknown>, type: string): number {
    const row = layout[type];
    if (!row) throw new TypeError('Unknown FpML hash layout: ' + type);
    const [parent, fields] = row;
    let result = parent ? fieldsHash(value, parent) : 0;
    for (const [key, declared, flags] of fields) {
      const child = value[key];
      const enumeration = (flags & 2) !== 0;
      let contribution = 0;
      if (child != null) {
        if (flags & 1) {
          const items: unknown[] = Array.isArray(child) ? child : [child];
          if (items.length) contribution = enumeration
            ? Math.imul(items.length, stringHash(declared))
            : items.reduce<number>((total, item) => mix(total, hash(item, declared)), 1);
        } else contribution = enumeration ? stringHash(declared) : hash(child, declared);
      }
      result = mix(result, contribution);
    }
    return result;
  }
  return (prefix: string, value: unknown, type: string, missing: number, modulus: number, includePrefix: boolean, id?: string | null): string => {
    if (typeof prefix !== 'string') throw new TypeError('FpML key prefix is required');
    const data = value == null ? value : runeValueJSON(value, undefined, { format: 'RUNE_JSON', preserveNumberText: true });
    const body = data == null ? missing : hash(data, type);
    const result = (body + (includePrefix ? stringHash(prefix) : 0) + (id === undefined ? 0 : id === null ? 3 : stringHash(id))) | 0;
    return prefix + '-$' + Math.abs(result % modulus);
  };
})();`;
