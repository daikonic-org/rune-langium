// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { isAttribute } from '@rune-langium/core';
import type {
  Attribute,
  ChoiceOption,
  RosettaEnumValue,
  Dehydrated,
  AnnotationRef,
  RosettaClassSynonym,
  RosettaSynonym,
  RosettaEnumSynonym
} from '@rune-langium/core';
import type { DomainNodeData } from '../types.js';
import type { EditorState } from './editor-store.js';
import { SCHEMA_BY_TYPE } from '../schemas/schema-by-type.js';
import { getEditorFieldSchema } from '../schemas/editor-field-schema.js';

export type MetadataPath =
  | readonly []
  | readonly ['attributes', number]
  | readonly ['inputs', number]
  | readonly ['output']
  | readonly ['enumValues', number];
export type MetadataNode =
  | DomainNodeData
  | Dehydrated<Attribute>
  | Dehydrated<ChoiceOption>
  | Dehydrated<RosettaEnumValue>;
export interface MetadataTarget {
  nodeId: string;
  parseEpoch: number;
  owner: DomainNodeData;
  path: MetadataPath;
  expected: MetadataNode;
}
export interface MetadataCapabilities {
  definition: boolean;
  display: boolean;
  annotations: boolean;
  synonymField?: 'synonyms' | 'enumSynonyms';
  synonymKind?: 'class' | 'body' | 'enumValue';
}
export type MetadataItem =
  | Dehydrated<AnnotationRef>
  | Dehydrated<RosettaClassSynonym>
  | Dehydrated<RosettaSynonym>
  | Dehydrated<RosettaEnumSynonym>;
export type MetadataCommand =
  | { kind: 'definition'; value: string }
  | { kind: 'display'; value: string | undefined }
  | { kind: 'append'; field: 'annotations' | 'synonyms' | 'enumSynonyms'; value: MetadataItem }
  | {
      kind: 'replace';
      field: 'annotations' | 'synonyms' | 'enumSynonyms';
      index: number;
      expected: MetadataItem;
      value: MetadataItem;
    }
  | { kind: 'remove'; field: 'annotations' | 'synonyms' | 'enumSynonyms'; index: number; expected: MetadataItem };
export type MetadataEditResult =
  | { status: 'committed' }
  | { status: 'stale' | 'readOnly' | 'unsupported' }
  | { status: 'invalid'; issues: readonly { path: readonly PropertyKey[]; message: string }[] };
export interface InspectorMetadataActions {
  captureMetadataTarget(nodeId: string, path: MetadataPath): MetadataTarget | undefined;
  applyMetadataCommand(target: MetadataTarget, command: MetadataCommand): MetadataEditResult;
}

export function readAtMetadataPath(owner: DomainNodeData, path: MetadataPath): MetadataNode | undefined {
  if (path.length === 0) return owner;
  if (path[0] === 'output') {
    const output: unknown = owner.$type === 'RosettaFunction' ? owner.output : undefined;
    return isAttribute(output) ? (output as Dehydrated<Attribute>) : undefined;
  }
  if (path.length !== 2 || !Number.isInteger(path[1]) || path[1] < 0) return undefined;
  const index = path[1];
  switch (path[0]) {
    case 'attributes':
      return owner.$type === 'Data' || owner.$type === 'Choice' || owner.$type === 'Annotation'
        ? owner.attributes[index]
        : undefined;
    case 'inputs':
      return owner.$type === 'RosettaFunction' ? owner.inputs[index] : undefined;
    case 'enumValues':
      return owner.$type === 'RosettaEnumeration' ? owner.enumValues[index] : undefined;
  }
}

export function captureMetadataTarget(
  state: Pick<EditorState, 'nodesById' | 'parseEpoch'>,
  nodeId: string,
  path: MetadataPath
): MetadataTarget | undefined {
  const owner = state.nodesById.get(nodeId)?.data;
  if (!owner) return undefined;
  const expected = readAtMetadataPath(owner, path);
  return expected
    ? { nodeId, parseEpoch: state.parseEpoch, owner, path: [...path] as MetadataPath, expected }
    : undefined;
}

export function resolveMetadataTarget(
  state: Pick<EditorState, 'nodesById' | 'parseEpoch'>,
  target: MetadataTarget
): MetadataNode | undefined {
  const owner = state.nodesById.get(target.nodeId)?.data;
  if (state.parseEpoch !== target.parseEpoch || owner !== target.owner) return undefined;
  const current = readAtMetadataPath(owner, target.path);
  return current === target.expected ? current : undefined;
}

export function getMetadataCapabilities(node: MetadataNode): MetadataCapabilities {
  const schema = SCHEMA_BY_TYPE[node.$type];
  const supports = (name: string) => Boolean(schema && getEditorFieldSchema(schema, name));
  const synonymField = supports('enumSynonyms') ? 'enumSynonyms' : supports('synonyms') ? 'synonyms' : undefined;
  const synonymKind =
    node.$type === 'RosettaEnumValue'
      ? 'enumValue'
      : node.$type === 'Data' || node.$type === 'Choice'
        ? 'class'
        : 'body';
  return {
    definition: supports('definition'),
    display: supports('display'),
    annotations: supports('annotations'),
    ...(synonymField ? { synonymField, synonymKind } : {})
  };
}
