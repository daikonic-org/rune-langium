// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { z } from 'zod';
import type { CodeListValue } from '@rune-langium/codegen/export';
const date = z.iso.date();
const text = z.string().min(1);
const entry = z.object({
  value: text,
  label: text,
  description: text.optional(),
  source: text.optional(),
  effectiveDate: date.optional(),
  deprecatedDate: date.optional()
});
const cdmCode = entry.omit({ label: true });
const cdmIdentity = z.object({
  shortName: text,
  version: text,
  canonicalUri: text.regex(/^[a-zA-Z][a-zA-Z\d+.-]*:/),
  canonicalVersionUri: text.optional()
});
const cdm = z.object({
  identification: cdmIdentity.passthrough(),
  codes: z.array(cdmCode.passthrough())
});
const curatedCdm = z.object({
  identification: cdmIdentity
    .extend({
      description: text.optional(),
      publicationDate: text.optional(),
      codeShortId: text.optional(),
      locationUri: text.optional()
    })
    .partial({ shortName: true, canonicalUri: true, version: true }),
  codes: z.array(cdmCode).default([])
});

/** Preserve the published object for function results, including metadata-only lists. */
export function decodeCuratedCdmCodeList(content: string, filenameVersion: string) {
  const { identification, codes } = curatedCdm.parse(JSON.parse(content));
  const { shortName, canonicalUri, version = filenameVersion } = identification;
  if (!shortName || !canonicalUri) return undefined;
  return { identification: { ...identification, shortName, canonicalUri, version }, codes };
}
export interface CodeListExpectation {
  format: 'json' | 'cdm-json';
  canonicalUri?: string;
  version?: string;
}
/** Decode saved bytes once; scheme URIs are identities and are never dereferenced. */
export function decodeProjectCodeList(
  text: string,
  expected: CodeListExpectation = { format: 'json' }
): {
  values: CodeListValue[];
  canonicalUri?: string;
  version?: string;
} {
  const raw: unknown = JSON.parse(text);
  let values: CodeListValue[], canonicalUri: string | undefined, version: string | undefined;
  if (expected.format === 'cdm-json') {
    const parsed = cdm.parse(raw);
    ({ canonicalUri, version } = parsed.identification);
    values = parsed.codes.map(({ description, ...code }) => ({
      ...code,
      label: code.value,
      ...(description ? { description } : {})
    }));
  } else {
    const parsed = z.union([z.array(entry), z.record(entry.shape.value, entry.shape.label)]).parse(raw);
    values = Array.isArray(parsed) ? parsed : Object.entries(parsed).map(([value, label]) => ({ value, label }));
  }
  if (expected.canonicalUri !== undefined && expected.canonicalUri !== canonicalUri)
    throw new Error('The code-list scheme URI differs from the configured identity.');
  if (expected.version !== undefined && expected.version !== version)
    throw new Error('The code-list version differs from the configured version.');
  if (new Set(values.map((code) => code.value)).size !== values.length)
    throw new Error('Expected distinct code-list entries with string value and label.');
  return { values, ...(canonicalUri ? { canonicalUri } : {}), ...(version ? { version } : {}) };
}
