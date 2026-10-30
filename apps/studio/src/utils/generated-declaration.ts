// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import type { Target } from '@rune-langium/codegen/export';
import type { CodePreviewFile } from '../store/codegen-store.js';
import type { FormPreviewTarget } from '../store/preview-store.js';
import { withInstrumentation } from '../services/instrumentation/core.js';

type Declaration = Pick<FormPreviewTarget, 'name' | 'namespace' | 'kind' | 'sourceUri' | 'sourceRange'>;

/** Exact object-member paths in the emitters' two-space JSON.stringify output. */
function jsonDeclarationLines(lines: string[], path: string[]): number[] {
  const parents: { indent: number; key: string }[] = [];
  const matches: number[] = [];
  lines.forEach((line, index) => {
    const indent = line.length - line.trimStart().length;
    while (parents.length && parents[parents.length - 1]!.indent >= indent) parents.pop();
    const member = /^\s*("(?:\\.|[^"\\])*"):\s*([[{])/.exec(line);
    if (!member) return;
    const key = JSON.parse(member[1]!) as string;
    const current = [...parents.map((parent) => parent.key), key];
    if (member[2] === '{' && current.length === path.length && current.every((part, i) => part === path[i]))
      matches.push(index);
    parents.push({ indent, key });
  });
  return matches;
}

/** Locate declarations only in the active output's implemented emitter format. */
export const findGeneratedDeclarationLine = withInstrumentation(
  function findGeneratedDeclarationLine(
    target: Target,
    file: CodePreviewFile,
    declaration: Declaration
  ): number | undefined {
    const { name, namespace, kind } = declaration;
    const lines = file.content.split('\n');
    let candidates: number[] = [];
    if (target === 'json-schema' || target === 'openapi') {
      let document: Record<string, unknown>;
      try {
        document = JSON.parse(file.content);
      } catch {
        return undefined;
      }
      if (!document || typeof document !== 'object' || Array.isArray(document)) return undefined;
      const title =
        target === 'json-schema' ? document.title : (document.info as { title?: unknown } | undefined)?.title;
      const bundled = target === 'json-schema' && typeof title === 'string' && title.startsWith('Bundle: ');
      if (namespace && typeof title === 'string' && !bundled && title !== namespace) return undefined;
      const functionTarget = kind === 'RosettaFunction' || kind === 'function';
      const path =
        target === 'json-schema'
          ? ['$defs', bundled ? `${namespace}.${name}` : name]
          : functionTarget
            ? ['paths', `/functions/${name}`]
            : ['components', 'schemas', name];
      candidates = jsonDeclarationLines(lines, path);
    } else {
      const outputNamespace =
        target === 'xsd'
          ? /targetNamespace="urn:rune:([^"]+)"/.exec(file.content)?.[1]
          : target === 'sql'
            ? /^-- SQL DDL generated from namespace (\S+) \(/m.exec(file.content)?.[1]
            : /^(?:\/\/) Source namespace: (\S+)$/m.exec(file.content)?.[1];
      if (namespace && outputNamespace && outputNamespace !== namespace) return undefined;
      const xmlName = name
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/'/g, '&apos;');
      const modelType = target === 'typescript' && ['data', 'choice'].includes(kind.toLowerCase());
      lines.forEach((line, index) => {
        let identifier: string | undefined;
        if (target === 'typescript' || target === 'zod') {
          const match =
            /^\s*(?:export\s+)?(?:async\s+)?(const|class|interface|type|function|enum)\s+([$_\p{ID_Start}][$_\u200c\u200d\p{ID_Continue}]*)/u.exec(
              line
            );
          // Data/Choice expose both a public type and a same-name value factory.
          // Navigate to the type; repeated type declarations remain ambiguous.
          if (!modelType || (match && ['type', 'interface', 'class'].includes(match[1]!))) identifier = match?.[2];
        } else if (target === 'sql') {
          const table = /^CREATE TABLE (?:"([^"]+)"|\[([^\]]+)\]) \($/.exec(line);
          identifier = table?.[1] ?? table?.[2];
        } else if (target === 'xsd') {
          const type = /^<xs:(?:complexType|simpleType) name="([^"]+)"\s*\/?>/.exec(line);
          if (type?.[1] === xmlName) identifier = name;
        }
        if (identifier === name) candidates.push(index);
      });
    }
    if (candidates.length === 1) return candidates[0];
    // Most emitters have no maps. OpenAPI currently copies pre-wrap JSON Schema
    // offsets, so only structurally verified TS/JSON Schema maps may disambiguate.
    if ((target === 'typescript' || target === 'json-schema') && declaration.sourceUri && declaration.sourceRange) {
      const start = declaration.sourceRange.start;
      const mapped = new Set(
        file.sourceMap
          .filter(
            (entry) =>
              entry.sourceUri === declaration.sourceUri &&
              entry.sourceLine === start.line + 1 &&
              entry.sourceChar === start.character + 1 &&
              candidates.includes(entry.outputLine)
          )
          .map((entry) => entry.outputLine)
      );
      if (mapped.size === 1) return [...mapped][0];
    }
    return undefined;
  },
  { op: 'findGeneratedDeclarationLine' }
);
