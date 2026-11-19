// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Daikonic contributors

import type { GeneratorOptions, GeneratorOutput } from '../types.js';
import { createDiagnostic } from '../diagnostics.js';
import { generatePythonModule } from '../projection/python-functions.js';
import type { WholeModelEmitter } from './namespace-emitter.js';
import type { NamespaceRegistry } from './namespace-registry.js';
import type { NamespaceWalkResult } from './namespace-walker.js';

export class PythonModelEmitter implements WholeModelEmitter {
  async emit(
    walks: ReadonlyMap<string, NamespaceWalkResult>,
    _registry: NamespaceRegistry,
    options: GeneratorOptions
  ): Promise<GeneratorOutput[]> {
    const namespaces = [...walks.keys()].sort();
    const documents = namespaces.flatMap((namespace) => walks.get(namespace)?.docs ?? []);
    const module = generatePythonModule(documents);
    const configuredBindings = new Set(
      Array.from(options.projectBindings?.values() ?? [], (symbol) => `${symbol.namespace}.${symbol.name}`)
    );
    const diagnostics = [...module.diagnostics];
    for (const name of configuredBindings) {
      if (module.bindings.has(name)) {
        diagnostics.push(
          createDiagnostic(
            'warning',
            'python-host-provider',
            `To use the configured host provider for ${name} in Python, supply a Python runtime binding.`
          )
        );
      }
    }
    const header = options.headerComment
      ?.split(/\r\n|\n|\r/)
      .map((line) => '# ' + line)
      .join('\n');
    return [
      {
        relativePath: 'model.py',
        content: header ? header + '\n' + module.code : module.code,
        namespaces,
        projections: module.projections,
        sourceMap: [],
        diagnostics,
        funcs: []
      }
    ];
  }
}
