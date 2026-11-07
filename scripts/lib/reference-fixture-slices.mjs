// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/** Preserve the original header and CST bytes of selected dependency-closure declarations. */
export function referenceFixtureSlices(documents, selected) {
  const originals = new Map(documents.map((document) => [document.uri.toString(), document]));
  return selected.map((document) => {
    const model = document.parseResult.value;
    const original = originals.get(document.uri.toString())?.parseResult.value;
    if (!original?.$cstNode || !original.elements?.[0]?.$cstNode || !model.elements?.length)
      throw new Error('Reference fixture requires its original parsed document.');
    const source = original.$cstNode.root.fullText;
    const content =
      source.slice(0, original.elements[0].$cstNode.offset) +
      model.elements
        .map((element) => {
          if (!element.$cstNode) throw new Error('Reference fixture declaration has no source range.');
          return source.slice(element.$cstNode.offset, element.$cstNode.end);
        })
        .join('\n\n') +
      '\n';
    const name = `${model.name.replace(/^"|"$/g, '')}--${document.uri.path.split('/').at(-1)}`;
    return { name, uri: document.uri.toString(), content };
  });
}
