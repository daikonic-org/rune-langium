// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { describe, expect, it } from 'vitest';
import {
  Annotation,
  Choice,
  Data,
  RosettaEnumeration,
  RosettaFunction,
  RosettaRecordType
} from '../../src/generated/domain.js';
import { RosettaAttributeReference, type Dehydrated } from '../../src/index.js';

it('retains the public receiver setter for data and recursive attribute receivers', () => {
  const data = { $type: 'RosettaDataReference' as const, data: { $refText: 'Person' } };
  const node: Dehydrated<RosettaAttributeReference> = {
    $type: 'RosettaAttributeReference',
    receiver: data,
    attribute: { $refText: 'name' }
  };
  const nested: Dehydrated<RosettaAttributeReference> = {
    $type: 'RosettaAttributeReference',
    receiver: data,
    attribute: { $refText: 'address' }
  };
  RosettaAttributeReference.setReceiver(node, nested);
  expect(node.receiver).toBe(nested);
  RosettaAttributeReference.setReceiver(node, data);
  expect(node.receiver).toBe(data);
});

// ---------------------------------------------------------------------------
// Minimal test-fixture factories (type-level only — no Langium runtime)
// ---------------------------------------------------------------------------

function makeAttr(name: string) {
  return { $type: 'Attribute' as const, name };
}

function makeChoiceOption(name: string) {
  return { $type: 'ChoiceOption' as const, name };
}

function makeEnumValue(name: string) {
  return { $type: 'RosettaEnumValue' as const, name };
}

function makeRecordFeature(name: string) {
  return { $type: 'RosettaRecordFeature' as const, name };
}

function makeData(attributes: ReturnType<typeof makeAttr>[] = []) {
  return { $type: 'Data' as const, name: 'TestData', attributes };
}

function makeAnnotation(attributes: ReturnType<typeof makeAttr>[] = []) {
  return { $type: 'Annotation' as const, name: 'TestAnnotation', attributes };
}

function makeChoice(attributes: ReturnType<typeof makeChoiceOption>[] = []) {
  return { $type: 'Choice' as const, name: 'TestChoice', attributes };
}

function makeEnum(enumValues: ReturnType<typeof makeEnumValue>[] = []) {
  return { $type: 'RosettaEnumeration' as const, name: 'TestEnum', enumValues };
}

function makeFunction(inputs: ReturnType<typeof makeAttr>[] = []) {
  return { $type: 'RosettaFunction' as const, name: 'testFunc', inputs };
}

function makeRecordType(features: ReturnType<typeof makeRecordFeature>[] = []) {
  return { $type: 'RosettaRecordType' as const, name: 'TestRecord', features };
}

// ---------------------------------------------------------------------------
// Data attributes
// ---------------------------------------------------------------------------

describe('Data.addAttribute / Data.removeAttributeAt', () => {
  it('addAttribute appends in-place', () => {
    const node = makeData();
    const a = makeAttr('a');
    Data.addAttribute(node as any, a as any);
    expect(node.attributes).toHaveLength(1);
    expect(node.attributes[0]).toBe(a);
  });

  it('removeAttributeAt splices the correct index', () => {
    const a = makeAttr('a');
    const b = makeAttr('b');
    const c = makeAttr('c');
    const node = makeData([a, b, c]);
    Data.removeAttributeAt(node as any, 1);
    expect(node.attributes).toEqual([a, c]);
  });

  it('removeAttributeAt index 0 leaves tail intact', () => {
    const a = makeAttr('a');
    const b = makeAttr('b');
    const node = makeData([a, b]);
    Data.removeAttributeAt(node as any, 0);
    expect(node.attributes).toEqual([b]);
  });
});

// ---------------------------------------------------------------------------
// Annotation attributes
// ---------------------------------------------------------------------------

describe('Annotation.addAttribute / Annotation.removeAttributeAt', () => {
  it('addAttribute appends in-place', () => {
    const node = makeAnnotation();
    const a = makeAttr('x');
    Annotation.addAttribute(node as any, a as any);
    expect(node.attributes).toHaveLength(1);
    expect(node.attributes[0]).toBe(a);
  });

  it('removeAttributeAt splices correctly', () => {
    const a = makeAttr('a');
    const b = makeAttr('b');
    const node = makeAnnotation([a, b]);
    Annotation.removeAttributeAt(node as any, 0);
    expect(node.attributes).toEqual([b]);
  });
});

// ---------------------------------------------------------------------------
// Choice attributes (ChoiceOption items)
// ---------------------------------------------------------------------------

describe('Choice.addAttribute / Choice.removeAttributeAt', () => {
  it('addAttribute appends', () => {
    const node = makeChoice();
    const opt = makeChoiceOption('o');
    Choice.addAttribute(node as any, opt as any);
    expect(node.attributes).toHaveLength(1);
    expect(node.attributes[0]).toBe(opt);
  });

  it('removeAttributeAt removes middle element', () => {
    const a = makeChoiceOption('a');
    const b = makeChoiceOption('b');
    const c = makeChoiceOption('c');
    const node = makeChoice([a, b, c]);
    Choice.removeAttributeAt(node as any, 1);
    expect(node.attributes).toEqual([a, c]);
  });
});

// ---------------------------------------------------------------------------
// RosettaEnumeration enumValues
// ---------------------------------------------------------------------------

describe('RosettaEnumeration.addEnumValue / RosettaEnumeration.removeEnumValueAt', () => {
  it('addEnumValue appends', () => {
    const node = makeEnum();
    const v = makeEnumValue('V');
    RosettaEnumeration.addEnumValue(node as any, v as any);
    expect(node.enumValues).toHaveLength(1);
    expect(node.enumValues[0]).toBe(v);
  });

  it('removeEnumValueAt removes last element', () => {
    const a = makeEnumValue('a');
    const b = makeEnumValue('b');
    const node = makeEnum([a, b]);
    RosettaEnumeration.removeEnumValueAt(node as any, 1);
    expect(node.enumValues).toEqual([a]);
  });
});

// ---------------------------------------------------------------------------
// RosettaFunction inputs
// ---------------------------------------------------------------------------

describe('RosettaFunction.addInput / RosettaFunction.removeInputAt', () => {
  it('addInput appends', () => {
    const node = makeFunction();
    const a = makeAttr('arg');
    RosettaFunction.addInput(node as any, a as any);
    expect(node.inputs).toHaveLength(1);
    expect(node.inputs[0]).toBe(a);
  });

  it('removeInputAt removes first element', () => {
    const a = makeAttr('a');
    const b = makeAttr('b');
    const node = makeFunction([a, b]);
    RosettaFunction.removeInputAt(node as any, 0);
    expect(node.inputs).toEqual([b]);
  });
});

// ---------------------------------------------------------------------------
// RosettaRecordType features
// ---------------------------------------------------------------------------

describe('RosettaRecordType.addFeature / RosettaRecordType.removeFeatureAt', () => {
  it('addFeature appends', () => {
    const node = makeRecordType();
    const f = makeRecordFeature('feat');
    RosettaRecordType.addFeature(node as any, f as any);
    expect(node.features).toHaveLength(1);
    expect(node.features[0]).toBe(f);
  });

  it('removeFeatureAt removes middle element', () => {
    const a = makeRecordFeature('a');
    const b = makeRecordFeature('b');
    const c = makeRecordFeature('c');
    const node = makeRecordType([a, b, c]);
    RosettaRecordType.removeFeatureAt(node as any, 1);
    expect(node.features).toEqual([a, c]);
  });
});
