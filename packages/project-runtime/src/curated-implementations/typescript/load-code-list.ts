// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import type { CdmCodeListCatalog } from '../code-list-resources.js';

export function loadCodeList(lists: CdmCodeListCatalog) {
  const cases = [...lists].map(([domain, { identification, codes }]) => {
    const rows = codes.map(({ value, description, source, effectiveDate, deprecatedDate }) => {
      const fields = [value, description, source, effectiveDate, deprecatedDate];
      return JSON.stringify(fields.slice(0, fields.findLastIndex((field) => field !== undefined) + 1));
    });
    return (
      '      case ' +
      JSON.stringify(domain) +
      ': return { identification: ' +
      JSON.stringify(identification) +
      ', codes: [\n' +
      rows.join(',\n') +
      '\n      ] };'
    );
  });
  return {
    call: true,
    dependencies: ['@js-temporal/polyfill'],
    expression: `(domain: string) => {
  type CodeRow = [
    value: string,
    description?: string | null,
    source?: string | null,
    effectiveDate?: string | null,
    deprecatedDate?: string | null
  ];
  type List = {
    identification: { shortName: string; version: string; canonicalUri: string; [key: string]: string };
    codes: CodeRow[];
  };
  const read = (name: string): List => {
    switch (name) {
${cases.join('\n')}
    }
    throw new Error('No matching CodeList found for: ' + domain);
  };
  const list = read(domain.toLowerCase());
  return {
    identification: list.identification,
    codes: list.codes.map(([value, description, source, effectiveDate, deprecatedDate]) => ({
      value,
      ...(description == null ? {} : { description }),
      ...(source == null ? {} : { source }),
      ...(effectiveDate == null ? {} : { effectiveDate: Temporal.PlainDate.from(effectiveDate) }),
      ...(deprecatedDate == null ? {} : { deprecatedDate: Temporal.PlainDate.from(deprecatedDate) })
    }))
  };
}`
  } as const;
}
