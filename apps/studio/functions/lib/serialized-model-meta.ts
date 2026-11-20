// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * Cheap reader for a serialized Langium RosettaModel's namespace and dependency names — JSON only, NO Langium deserialize/link. Used to compute the
 * curated dependency closure without paying the link cost.
 *
 * Serialized shape (packages/core/src/serializer/rune-serialize.ts via Langium JsonSerializer):
 *   { $type:'RosettaModel', name: string | { segments: string[] },
 *     imports?: Array<{ importedNamespace?: string }> }
 * `importedNamespace` is a QualifiedNameWithWildcard, e.g. `cdm.base.datetime`
 * or `cdm.base.*`.
 */
import { readLspModelMetadata } from '@rune-langium/core';
import { withInstrumentation } from '../../src/services/instrumentation/core.js';

export interface SerializedModelMeta {
  namespace: string;
  imports: string[];
}

export const readSerializedModelMeta = withInstrumentation(
  function readSerializedModelMeta(serializedModel: string): SerializedModelMeta | null {
    try {
      const { namespace, imports, qualifiedNamespaces = [] } = readLspModelMetadata(serializedModel);
      return namespace
        ? { namespace, imports: [...new Set([...imports.filter(Boolean), ...qualifiedNamespaces])] }
        : null;
    } catch {
      return null;
    }
  },
  { op: 'readSerializedModelMeta', capture: 0 }
);
