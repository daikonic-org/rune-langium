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
import { ANNOTATIONS_ROSETTA, type RuneDslKeywordNames } from '@rune-langium/core';
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

// Fixed grammar constructs are checked against core's generated keyword contract.
const ANNOTATION_HEADS = new Set<string>([
  'docReference',
  'regulatoryReference',
  'synonym',
  'ruleReference',
  'label'
] satisfies RuneDslKeywordNames[]);
const ANNOTATION_FIELDS = new Set<string>([
  'for',
  'as',
  'rationale',
  'rationale_author',
  'structured_provision',
  'provision',
  'reportedField',
  'value',
  'meta',
  'hint',
  'merge',
  'dateFormat',
  'pattern',
  'removeHtml',
  'mapper',
  'path',
  'maps',
  'tag',
  'componentID',
  'definition'
] satisfies RuneDslKeywordNames[]);
const STANDARD_ANNOTATIONS = [...ANNOTATIONS_ROSETTA.matchAll(/^annotation\s+([a-zA-Z_][a-zA-Z_0-9]*)/gm)].map(
  (match) => match[1]!
);
interface BracketContext {
  head: boolean;
  annotation: boolean;
  attribute: boolean;
  expression: boolean;
}

// ────────────────────────────────────────────────────────────────────────────
// Stream parser state
// ────────────────────────────────────────────────────────────────────────────

interface RuneDslState {
  /** Whether we're inside a multi-line comment. */
  inBlockComment: boolean;
  inString: '"' | "'" | null;
  /** Whether the previous token was a type keyword. */
  expectTypeName: boolean;
  expectAnnotationName: boolean;
  annotationNames: Set<string>;
  brackets: BracketContext[];
  expressionIndent: number | null;
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
    return {
      inBlockComment: false,
      inString: null,
      expectTypeName: false,
      expectAnnotationName: false,
      annotationNames: new Set(STANDARD_ANNOTATIONS),
      brackets: [],
      expressionIndent: null
    };
  },

  copyState(state: RuneDslState): RuneDslState {
    return {
      ...state,
      annotationNames: new Set(state.annotationNames),
      brackets: state.brackets.map((frame) => ({ ...frame }))
    };
  },

  languageData: { commentTokens: { line: '//', block: { open: '/*', close: '*/' } } },

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

    if (stream.sol()) {
      const line = stream.string.trimStart();
      const indent = stream.indentation();
      if (state.expressionIndent !== null && line && !line.startsWith('//') && indent <= state.expressionIndent)
        state.expressionIndent = null;
      if (/^(?:set|add|alias)\b[^:]*:/.test(line)) state.expressionIndent = indent;
    }
    // Skip whitespace
    if (stream.eatSpace()) return null;
    const frame = state.brackets[state.brackets.length - 1];

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

    if (stream.match('[')) {
      const prefix = stream.string.slice(0, stream.start).trimEnd();
      const expression =
        state.expressionIndent !== null ||
        Boolean(frame && !frame.annotation) ||
        /\b(?:extract|filter|reduce|sort|min|max|then)\s*(?:[a-zA-Z_][a-zA-Z_0-9]*\s*)?$/.test(prefix) ||
        /(?:[:,(=+*/-]|->)\s*$/.test(prefix);
      state.brackets.push({ head: true, annotation: false, attribute: false, expression });
      return 'bracket';
    }
    if (stream.match(']')) {
      state.brackets.pop();
      return 'bracket';
    }

    // Strings
    const quote = stream.peek();
    if (quote === '"' || quote === "'") {
      if (frame) frame.head = false;
      stream.next();
      state.inString = quote;
      return consumeString(stream, state);
    }

    // Numbers
    if (stream.match(/^[0-9]+(?:\.[0-9]+)?/)) {
      if (frame) frame.head = false;
      return 'number';
    }

    // Identifiers and keywords
    if (stream.match(/^[a-zA-Z_][a-zA-Z_0-9]*/)) {
      const word = stream.current();
      if (frame?.head) {
        frame.head = false;
        // A comma/navigation/operator after the head identifies an expression even without an enclosing declaration.
        const expressionTail = /^\s*(?:,|->|[+*/=<>!]|-(?!\w))/.test(stream.string.slice(stream.pos));
        if (!frame.expression && !expressionTail && (ANNOTATION_HEADS.has(word) || state.annotationNames.has(word))) {
          frame.annotation = true;
          frame.attribute = !ANNOTATION_HEADS.has(word);
          return 'annotation';
        }
      }
      if (frame?.annotation) {
        if (frame.attribute) {
          frame.attribute = false;
          return 'propertyName';
        }
        if (ANNOTATION_FIELDS.has(word)) return 'propertyName';
      }

      if (BOOLEANS.has(word)) return 'bool';

      if (state.expectTypeName) {
        state.expectTypeName = false;
        if (state.expectAnnotationName) {
          state.annotationNames.add(word);
          state.expectAnnotationName = false;
        }
        return 'typeName';
      }

      if (TYPE_KEYWORDS.has(word)) {
        state.expectTypeName = true;
        state.expectAnnotationName = word === 'annotation';
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
