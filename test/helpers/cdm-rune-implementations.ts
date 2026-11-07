// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASICTYPES_ROSETTA, ANNOTATIONS_ROSETTA } from '../../packages/core/src/stdlib/base-types.js';

const directory = dirname(fileURLToPath(import.meta.url));

/** Owned minimal declaration cohort; the full upstream signature gate is the inventory audit. */
export const cdmRuneImplementationSources = new Map(
  ['event-common.rosetta', 'date-list-state.rosetta', 'date-list.rosetta'].map((file) => [
    `model/implementations/${file}`,
    readFileSync(resolve(directory, '../../packages/project-runtime/src/curated-implementations/rune', file), 'utf8')
  ])
);

export const cdmEventReference = `namespace cdm.event.common
type ExecutionDetails:
  venue string (0..1)
type TransferState:
  value number (0..1)
func EmptyExecutionDetails:
  [codeImplementation]
  output: executionDetails ExecutionDetails (0..1)
func EmptyTransferHistory:
  [codeImplementation]
  output: emptyTransferHistory TransferState (0..*)
func ClearExecution:
  output: result boolean (1..1)
  set result: EmptyExecutionDetails() is absent
func ClearHistory:
  output: result int (1..1)
  set result: EmptyTransferHistory() count
`;
export const cdmDateReference = `namespace cdm.base.datetime
func PopOffDateList:
  [codeImplementation]
  inputs: dates date (0..*)
  output: newList date (0..*)
func Pop:
  inputs: dates date (0..*)
  output: result date (0..*)
  set result: PopOffDateList(dates)
`;

export const cdmRuneReferenceDocuments = [
  { uri: 'cdm/event-common.rosetta', content: cdmEventReference },
  { uri: 'cdm/datetime.rosetta', content: cdmDateReference },
  { uri: 'rune-dsl/basictypes.rosetta', content: BASICTYPES_ROSETTA },
  { uri: 'rune-dsl/annotations.rosetta', content: ANNOTATIONS_ROSETTA }
];
