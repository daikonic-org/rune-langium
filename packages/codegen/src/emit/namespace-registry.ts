// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import type { LangiumDocument } from 'langium';
import {
  isAnnotation,
  isData,
  isChoice,
  isRosettaEnumeration,
  isRosettaExternalFunction,
  isRosettaFunction,
  isRosettaModel,
  isRosettaReport,
  isRosettaRule,
  isRosettaTypeAlias
} from '@rune-langium/core';

export interface NamespaceManifest {
  namespace: string;
  /** Structured Data and Choice declarations, including their Shape and guard exports. */
  exportedDataNames: Set<string>;
  exportedEnumNames: Set<string>;
  exportedFuncNames: Set<string>;
  exportedRuleNames: Set<string>;
  exportedTypeAliasNames: Set<string>;
  exportedAnnotationNames: Set<string>;
  exportedLibraryFuncNames: Set<string>;
  relativePath: string;
}

export interface NamespaceRegistry {
  namespaces: Map<string, NamespaceManifest>;
}

export function buildNamespaceRegistry(groupedDocs: Map<string, LangiumDocument[]>): NamespaceRegistry {
  const namespaces = new Map<string, NamespaceManifest>();

  for (const [namespace, docs] of groupedDocs) {
    const manifest: NamespaceManifest = {
      namespace,
      exportedDataNames: new Set(),
      exportedEnumNames: new Set(),
      exportedFuncNames: new Set(),
      exportedRuleNames: new Set(),
      exportedTypeAliasNames: new Set(),
      exportedAnnotationNames: new Set(),
      exportedLibraryFuncNames: new Set(),
      relativePath: namespace.replace(/\./g, '/')
    };

    for (const doc of docs) {
      const model = doc.parseResult?.value;
      if (!model || !isRosettaModel(model)) continue;

      for (const element of model.elements) {
        if (isData(element) || isChoice(element)) {
          manifest.exportedDataNames.add(element.name);
        } else if (isRosettaEnumeration(element)) {
          manifest.exportedEnumNames.add(element.name);
        } else if (isRosettaFunction(element)) {
          manifest.exportedFuncNames.add(element.name);
        } else if (isRosettaRule(element)) {
          manifest.exportedRuleNames.add(element.name);
        } else if (isRosettaTypeAlias(element)) {
          manifest.exportedTypeAliasNames.add(element.name);
        } else if (isAnnotation(element)) {
          manifest.exportedAnnotationNames.add(element.name);
        } else if (isRosettaExternalFunction(element)) {
          manifest.exportedLibraryFuncNames.add(element.name);
        } else if (isRosettaReport(element)) {
          // Reports don't export named symbols — they reference other types
        }
      }
    }

    namespaces.set(namespace, manifest);
  }

  return { namespaces };
}

/**
 * Compute the relative import path from one namespace's emitted FILE to
 * another's, matching `getTargetRelativePath`'s layout: a namespace
 * `a.b.c` is emitted as the FILE `a/b/c.<ext>` (the last segment is the
 * file name, the earlier segments are directories).
 *
 * The relative walk therefore starts from the from-file's DIRECTORY
 * (`fromParts` minus the final segment), and the final `toParts` segment
 * is always the target file name — the common-prefix consumption is
 * capped so that the file segment is never swallowed as a shared
 * directory (`a.b` → `a` must yield `../a`, not `./`).
 *
 * Previously this walked from the namespace path itself (as if `a.b`
 * were the DIRECTORY `a/b/`), producing one extra `../` on every
 * cross-namespace import — e.g. sibling namespaces `test.x.product` →
 * `test.x.base` emitted `'../base.js'` from the file `test/x/product.ts`,
 * which resolves to `test/base.js` instead of the real `test/x/base.ts`.
 * Every emitted cross-namespace import was unresolvable on disk; latent
 * because no test performed real module resolution over multi-file
 * output until the Data-extends-Choice cross-namespace compile check
 * (test/emit/data-extends-choice-crossns.test.ts).
 */
export function resolveImportPath(fromNamespace: string, toNamespace: string, _registry: NamespaceRegistry): string {
  const fromDirParts = fromNamespace.split('.').slice(0, -1);
  const toParts = toNamespace.split('.');

  let commonLen = 0;
  const maxCommon = Math.min(fromDirParts.length, toParts.length - 1);
  while (commonLen < maxCommon && fromDirParts[commonLen] === toParts[commonLen]) {
    commonLen++;
  }

  const ups = fromDirParts.length - commonLen;
  const downParts = toParts.slice(commonLen);
  if (ups > 0) {
    return '../'.repeat(ups) + downParts.join('/');
  }
  return './' + downParts.join('/');
}
