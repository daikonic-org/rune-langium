// SPDX-License-Identifier: MIT

import { parseProjectPayload } from '@rune-langium/core/serialization';

export interface ImportDiagnostic {
  kind: 'parse-error' | 'unmapped-field' | 'coercion' | 'identity-mismatch';
  path?: string;
  message: string;
}

export interface ImportCodecResult {
  data: unknown;
  diagnostics: ImportDiagnostic[];
}

export interface ImportCodec {
  id: string;
  label: string;
  canTarget(typeFqn: string): boolean;
  import(input: Uint8Array | string, targetTypeFqn: string): ImportCodecResult;
}

/**
 * Parse-and-pass-through: unknown fields are preserved verbatim (import is
 * non-destructive by construction). Schema-level diagnostics (unknown
 * fields, type mismatches) come from the normal instance validation
 * pipeline once the InstanceRecord exists — not from this codec.
 */
export const jsonCodec: ImportCodec = {
  id: 'json',
  label: 'Plain JSON',
  canTarget: () => true,
  import(input: Uint8Array | string, _targetTypeFqn: string): ImportCodecResult {
    try {
      return { data: parseProjectPayload(input, 'JSON'), diagnostics: [] };
    } catch (err) {
      return {
        data: undefined,
        diagnostics: [{ kind: 'parse-error', message: err instanceof Error ? err.message : String(err) }]
      };
    }
  }
};

/** Rune serialization preserves metadata and requires an exact declared root type. */
export const runeJsonCodec: ImportCodec = {
  id: 'RUNE_JSON',
  label: 'Rune JSON',
  canTarget: () => true,
  import(input, targetTypeFqn) {
    try {
      const data = parseProjectPayload(input, 'RUNE_JSON');
      const identity =
        data && typeof data === 'object' && !Array.isArray(data)
          ? (data as Record<string, unknown>)['@type']
          : undefined;
      if (identity !== undefined && identity !== targetTypeFqn.split('#')[0])
        return {
          data: undefined,
          diagnostics: [
            {
              kind: 'identity-mismatch',
              message: 'Rune JSON type ' + String(identity) + ' differs from the selected input type.'
            }
          ]
        };
      return { data, diagnostics: [] };
    } catch (error) {
      return {
        data: undefined,
        diagnostics: [{ kind: 'parse-error', message: error instanceof Error ? error.message : String(error) }]
      };
    }
  }
};
