// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { describe, expect, it } from 'vitest';
import { generateNamespaceOps, type ZodTypeDescriptor } from 'langium-zod';

type ZodObjectTypeDescriptor = Extract<ZodTypeDescriptor, { kind: 'object' }>;

describe('contained receiver union generation', () => {
  const data: ZodObjectTypeDescriptor = { name: 'DataReference', kind: 'object', properties: [] };
  const owner: ZodObjectTypeDescriptor = {
    name: 'AttributeReference',
    kind: 'object',
    properties: [
      {
        name: 'receiver',
        optional: false,
        zodType: {
          kind: 'union',
          members: [
            { kind: 'reference', typeName: 'DataReference' },
            { kind: 'reference', typeName: 'AttributeReference' }
          ]
        }
      }
    ]
  };

  it('emits a recursive receiver setter using the canonical contained field type', () => {
    const output = generateNamespaceOps([data, owner]);
    expect(output).toContain('export namespace AttributeReference');
    expect(output).toContain(
      'setReceiver(node: Dehydrated<ast.AttributeReference>, receiver: Dehydrated<ast.AttributeReference>["receiver"]): void'
    );
    expect(output).toContain('node.receiver = receiver;');
  });

  it('retains clear operations for optional contained-node unions', () => {
    const optional: ZodObjectTypeDescriptor = {
      ...owner,
      properties: owner.properties.map((property) => ({ ...property, optional: true }))
    };
    const output = generateNamespaceOps([data, optional]);
    expect(output).toContain('setReceiver(');
    expect(output).toContain('clearReceiver(node: Dehydrated<ast.AttributeReference>): void');
    expect(output).toContain('node.receiver = undefined;');
  });

  it('continues to skip mixed primitive/object unions and unknown node types', () => {
    const mixed: ZodObjectTypeDescriptor = {
      ...owner,
      properties: [
        {
          ...owner.properties[0]!,
          zodType: {
            kind: 'union',
            members: [
              { kind: 'reference', typeName: 'DataReference' },
              { kind: 'primitive', primitive: 'string' }
            ]
          }
        }
      ]
    };
    expect(generateNamespaceOps([data, mixed])).not.toContain('setReceiver(');
    expect(generateNamespaceOps([owner])).not.toContain('setReceiver(');
  });
});
