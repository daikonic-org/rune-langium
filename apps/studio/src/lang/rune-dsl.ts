// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * Rune DSL CodeMirror language support (T015).
 *
 * Provides syntax highlighting for .rosetta files using CodeMirror's
 * StreamLanguage parser. Keywords are sourced from the Langium grammar.
 */

import { StreamLanguage, type StringStream } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { withInstrumentation } from '../services/instrumentation/core.js';

// ────────────────────────────────────────────────────────────────────────────
// Keywords extracted from rune-dsl.langium
// ────────────────────────────────────────────────────────────────────────────

const KEYWORDS = new Set([
  'namespace',
  'version',
  'import',
  'as',
  'type',
  'extends',
  'enum',
  'choice',
  'annotation',
  'basicType',
  'recordType',
  'typeAlias',
  'metaType',
  'func',
  'function',
  'library',
  'rule',
  'reporting',
  'report',
  'source',
  'synonym',
  'body',
  'corpus',
  'segment',
  'override',
  'scope',
  'if',
  'then',
  'else',
  'switch',
  'default',
  'and',
  'or',
  'exists',
  'absent',
  'is',
  'contains',
  'disjoint',
  'count',
  'all',
  'any',
  'extract',
  'filter',
  'reduce',
  'map',
  'flatten',
  'distinct',
  'first',
  'last',
  'reverse',
  'sort',
  'min',
  'max',
  'sum',
  'join',
  'from',
  'for',
  'in',
  'to',
  'with',
  'using',
  'when',
  'condition',
  'set',
  'add',
  'remove',
  'only',
  'single',
  'multiple',
  'optional',
  'required',
  'inputs',
  'output',
  'eligibility',
  'provision',
  'merge',
  'root',
  'super',
  'item',
  'value',
  'path',
  'empty'
]);

const TYPE_KEYWORDS = new Set([
  'type',
  'enum',
  'choice',
  'basicType',
  'recordType',
  'typeAlias',
  'metaType',
  'annotation'
]);

const BOOLEANS = new Set(['True', 'False']);

// ────────────────────────────────────────────────────────────────────────────
// Stream parser state
// ────────────────────────────────────────────────────────────────────────────

interface RuneDslState {
  /** Whether we're inside a multi-line comment. */
  inBlockComment: boolean;
  inString: '"' | "'" | null;
  /** Whether the previous token was a type keyword. */
  expectTypeName: boolean;
}

// ────────────────────────────────────────────────────────────────────────────
// Stream parser implementation
// ────────────────────────────────────────────────────────────────────────────

function consumeString(stream: StringStream, state: RuneDslState): string {
  while (!stream.eol()) {
    const character = stream.next();
    if (character === '\\') stream.next();
    else if (character === state.inString) {
      state.inString = null;
      break;
    }
  }
  return 'string';
}

export const runeDslStreamParser = {
  name: 'rune-dsl',

  startState(): RuneDslState {
    return { inBlockComment: false, inString: null, expectTypeName: false };
  },

  token(stream: StringStream, state: RuneDslState): string | null {
    if (state.inString) return consumeString(stream, state);

    // Continue block comment
    if (state.inBlockComment) {
      if (stream.match('*/')) {
        state.inBlockComment = false;
      } else {
        stream.next();
      }
      return 'comment';
    }

    // Skip whitespace
    if (stream.eatSpace()) return null;

    // Block comment start
    if (stream.match('/*')) {
      state.inBlockComment = true;
      return 'comment';
    }

    // Line comment
    if (stream.match('//')) {
      stream.skipToEnd();
      return 'comment';
    }

    // Strings
    const quote = stream.peek();
    if (quote === '"' || quote === "'") {
      stream.next();
      state.inString = quote;
      return consumeString(stream, state);
    }

    // Numbers
    if (stream.match(/^[0-9]+(?:\.[0-9]+)?/)) return 'number';

    // Identifiers and keywords
    if (stream.match(/^[a-zA-Z_][a-zA-Z_0-9]*/)) {
      const word = stream.current();

      if (BOOLEANS.has(word)) return 'bool';

      if (state.expectTypeName) {
        state.expectTypeName = false;
        return 'typeName';
      }

      if (TYPE_KEYWORDS.has(word)) {
        state.expectTypeName = true;
        return 'keyword';
      }

      if (KEYWORDS.has(word)) return 'keyword';

      return 'variableName';
    }

    // Operators / punctuation
    if (stream.match(/^[<>!=]+/)) return 'operator';
    if (stream.match(/^[-+*/]/)) return 'operator';

    // Skip unrecognised character
    stream.next();
    return null;
  }
};

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

export const runeDslLanguage = withInstrumentation(
  function runeDslLanguage(): Extension {
    return StreamLanguage.define(runeDslStreamParser);
    // Output is a CodeMirror Extension object — not meaningfully capturable.
  },
  { op: 'runeDslLanguage' }
);
