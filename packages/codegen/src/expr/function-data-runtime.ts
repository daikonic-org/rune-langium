// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { runeFuncDataSource } from './metadata-runtime.js';

/** Convert model instances to the structural function boundary, preserving typed Temporal values. */
export function functionDataRuntimeSource(typescript: boolean, exported = false): string {
  const prefix = exported ? 'export ' : '';
  const type = (value: string) => (typescript ? value : '');
  return `${typescript ? runeFuncDataSource(exported) : ''}
${prefix}const runeToFuncData = ${type('<T>')}(input${type(': T')})${type(': RuneFuncData<T>')} => {
  const seen = new WeakMap${type('<object, unknown>')}();
  const convert = (value${type(': unknown')})${type(': unknown')} => {
    if (value == null || typeof value !== 'object') return value;
    if (/^\\[object Temporal\\./.test(Object.prototype.toString.call(value))) return value;
    if (seen.has(value)) return seen.get(value);
    if (Array.isArray(value)) {
      const result${type(': unknown[]')} = [];
      seen.set(value, result);
      for (const item of value) result.push(convert(item));
      return result;
    }
    const result${type(': Record<string, unknown>')} = {};
    seen.set(value, result);
    for (const [key, item] of Object.entries(value)) if (typeof item !== 'function') Object.defineProperty(result, key, { value: convert(item), enumerable: true, writable: true, configurable: true });
    return result;
  };
  return convert(input)${type(' as RuneFuncData<T>')};
};`;
}
