// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Target-language reserved-word sets, shared by render-ts.ts and render-py.ts's
 * RosettaSymbolReference case. A Rune $refText that survives Langium's `^`-strip
 * (see render-expression.ts's escapeId()) is a bare identifier string that can
 * still collide with a target language's OWN reserved words even though it was
 * never a Rune reserved word — e.g. a Rune field named `^from` in Rune source
 * has $refText === "from", which is a Python keyword and would be a SyntaxError
 * if emitted verbatim as an identifier.
 */

/** TypeScript/JavaScript keywords reserved as bindings in strict ES modules. */
export const TS_RESERVED_WORDS: ReadonlySet<string> = new Set([
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'interface',
  'let',
  'new',
  'null',
  'package',
  'private',
  'protected',
  'public',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield'
]);

/** Python 3 hard keywords (keyword.kwlist). Soft keywords (match, case, type, _) remain valid identifiers in normal contexts and are intentionally excluded. */
export const PY_RESERVED_WORDS: ReadonlySet<string> = new Set([
  'False',
  'None',
  'True',
  'and',
  'as',
  'assert',
  'async',
  'await',
  'break',
  'class',
  'continue',
  'def',
  'del',
  'elif',
  'else',
  'except',
  'finally',
  'for',
  'from',
  'global',
  'if',
  'import',
  'in',
  'is',
  'lambda',
  'nonlocal',
  'not',
  'or',
  'pass',
  'raise',
  'return',
  'try',
  'while',
  'with',
  'yield'
]);
