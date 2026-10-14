// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import type { GeneratedProjection } from '@rune-langium/codegen/export';
import { formatGeneratedProjection } from '../../src/services/projection-format.js';

function projection(language: GeneratedProjection['language'], code: string): GeneratedProjection {
  return {
    language,
    code,
    subject: { uri: 'file:///model.rosetta', nodeId: 'example.Check', region: { from: 1, to: 4 } },
    sourceMap: [{ outputLine: 0, sourceUri: 'file:///model.rosetta', sourceLine: 2, sourceChar: 3 }],
    requiredHelpers: []
  };
}

describe('generated projection formatting', () => {
  beforeAll(() => vi.stubEnv('SSR', true));
  afterAll(() => vi.unstubAllEnvs());
  it('wraps nested TypeScript predicates while retaining their result and source identity', async () => {
    const input = projection(
      'typescript',
      'data.agreementType !== "Other" ? data.otherAgreement == null : data.agreementType !== "MasterAgreement" ? data.masterAgreementType?.value == null : data.agreementType !== "Confirmation" ? data.contractualDefinitionsType?.length === 0 && data.contractualTermsSupplement == null : false'
    );
    const formatted = await formatGeneratedProjection(input, 'condition');
    expect(formatted.code.split('\n').length).toBeGreaterThan(3);
    expect(formatted.subject).toBe(input.subject);
    expect(formatted.sourceMap).toBe(input.sourceMap);
    expect(formatted.code).not.toContain('$projection');
    for (const agreementType of ['Other', 'MasterAgreement', 'Confirmation']) {
      const data = { agreementType };
      expect(new Function('data', `return (${formatted.code})`)(data)).toBe(
        new Function('data', `return (${input.code})`)(data)
      );
    }
  });

  it.each(['typescript', 'python'] as const)(
    'formats %s bodies without adding a signature or losing string contents',
    async (language) => {
      const code =
        language === 'typescript'
          ? 'const literal = "source: function { len(values) }";\nreturn literal;'
          : 'literal = "source: function { len(values) }"\nreturn literal';
      const formatted = await formatGeneratedProjection(projection(language, code), 'function');
      expect(formatted.code).toContain('source: function { len(values) }');
      expect(formatted.code).toContain('return literal');
      expect(formatted.code).not.toMatch(/function \$projection|def _projection/);
      expect(formatted.code.startsWith(' ')).toBe(false);
    }
  );

  it('wraps Python predicates using a Python formatter', async () => {
    const formatted = await formatGeneratedProjection(
      projection(
        'python',
        '(data.get("agreementType") != "Other" and data.get("otherAgreement") is None and data.get("masterAgreementType") is None and data.get("contractualDefinitionsType") is None)'
      ),
      'condition'
    );
    expect(formatted.code.split('\n').length).toBeGreaterThan(3);
    expect(formatted.code).not.toContain('_projection');
  });
});
