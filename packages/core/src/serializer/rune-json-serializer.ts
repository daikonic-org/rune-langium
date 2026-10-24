// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { hasProjectRedirects } from '../references/project-resolution.js';
import {
  DefaultJsonSerializer,
  type LangiumCoreServices,
  type AstNode,
  type GenericAstNode,
  type JsonDeserializeOptions
} from 'langium';

export class RuneJsonSerializer extends DefaultJsonSerializer {
  private readonly services: LangiumCoreServices;
  constructor(services: LangiumCoreServices) {
    super(services);
    this.services = services;
  }
  protected override reviveReference(
    container: AstNode,
    property: string,
    root: AstNode,
    reference: Parameters<DefaultJsonSerializer['reviveReference']>[3],
    options: JsonDeserializeOptions
  ) {
    const revived = super.reviveReference(container, property, root, reference, options);
    if (!hasProjectRedirects(this.services) || !revived) return revived;
    // Serialized pointers belong to the immutable generation. Relink their authored text
    // through the same scope/linker as parsed source, including member references.
    return reference.$refs
      ? this.services.references.Linker.buildMultiReference(container, property, undefined, revived.$refText)
      : this.services.references.Linker.buildReference(container, property, undefined, revived.$refText);
  }

  /** Register all roots before Langium resolves any cross-document references. */
  deserializeModels<T extends AstNode>(contents: readonly string[], register: (models: T[]) => void): T[] {
    const models = contents.map((content) => JSON.parse(content) as T & GenericAstNode);
    register(models);
    for (const model of models) this.linkNode(model, model, {});
    return models;
  }
}
