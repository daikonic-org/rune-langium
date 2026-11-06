// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { expect, it } from 'vitest';
import { assertValidDocuments, BASICTYPES_ROSETTA, createRuneDslServices } from '@rune-langium/core';
import { URI } from 'langium';
import { generate } from '../../src/export.js';
import { compileGeneratedTypeScript } from '../helpers/compiled-typescript.js';

type Options = { format: 'RUNE_JSON' };
type View = { unwrap(): unknown; toJSON(options: Options): unknown };
type Model = {
  new (value: unknown): { toJSON(options: Options): unknown };
  fromJSON(value: unknown, options: Options): View;
};
type Api = Record<'Animal' | 'Dog' | 'Poodle' | 'Shelter' | 'ExactShelter', Model>;

it.each(['per-namespace', 'barrel', 'single-file', 'inline'] as const)(
  'preserves assignable concrete types across namespace modules (%s)',
  async (layout) => {
    const { RuneDsl } = createRuneDslServices();
    const sources = [
      BASICTYPES_ROSETTA,
      'namespace animals\ntype Animal:\n name string (1..1)\nchoice Pet:\n Animal\nchoice Nested:\n Pet\nchoice Ambiguous:\n Animal\n Pet\ntype Shelter:\n pet Animal (1..1)\n pets Animal (0..*)\n chosen Pet (0..1)\nnested Nested (0..1)\nambiguous Ambiguous (0..1)',
      'namespace dogs\nimport animals.*\ntype Dog extends Animal:\n breed string (1..1)\ntype Poodle extends Dog:\n clipped boolean (1..1)\ntype Other:\n value string (1..1)\nchoice OtherChoice:\n Other\nchoice ExactWithUnrelated:\n Animal\n Dog\n OtherChoice\ntype ExactShelter:\n selected ExactWithUnrelated (1..1)'
    ];
    const docs = sources.map((text, index) =>
      RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
        text,
        URI.parse(`inmemory:///polymorphic-${index}.rosetta`)
      )
    );
    await RuneDsl.shared.workspace.DocumentBuilder.build(docs);
    assertValidDocuments(docs);
    const outputs = await generate(docs, {
      target: 'typescript',
      typescript: layout === 'inline' ? { inlineHelpers: true } : { layout }
    });
    let entry: string;
    if (layout === 'single-file') entry = 'model.ts';
    else {
      entry = 'test-entry.ts';
      outputs.push({
        ...outputs[0]!,
        relativePath: entry,
        content:
          "export { Animal, Shelter } from './animals.js';\nexport { Dog, Poodle, ExactShelter } from './dogs.js';\n"
      });
    }
    const api = compileGeneratedTypeScript<Api>(outputs, { entry });
    const options: Options = { format: 'RUNE_JSON' };
    const dog = new api.Dog({ name: 'Fido', breed: 'Poodle' });
    const dogWire = dog.toJSON(options);
    const exactWire = { '@type': 'dogs.ExactShelter', selected: dogWire };
    expect(api.ExactShelter.fromJSON(exactWire, options).toJSON(options)).toEqual(exactWire);
    const restored = api.Animal.fromJSON(dogWire, options);
    expect(restored).toBeInstanceOf(api.Dog);
    expect(restored).toMatchObject({ name: 'Fido', breed: 'Poodle' });
    expect(restored.toJSON(options)).toEqual(dogWire);
    const constructedShelter = new api.Shelter({ pet: dog, pets: [dog] });
    const constructedWire = constructedShelter.toJSON(options);
    expect(constructedWire).toEqual({ '@type': 'animals.Shelter', pet: dogWire, pets: [dogWire] });
    expect(api.Shelter.fromJSON(constructedWire, options)).toMatchObject({ pet: expect.any(api.Dog) });
    const poodleWire = new api.Poodle({ name: 'Pip', breed: 'Poodle', clipped: true }).toJSON(options);
    expect(api.Animal.fromJSON(poodleWire, options)).toBeInstanceOf(api.Poodle);
    expect(api.Dog.fromJSON(poodleWire, options).toJSON(options)).toEqual(poodleWire);
    const shelterWire = {
      '@type': 'animals.Shelter',
      pet: dogWire,
      pets: [dogWire, poodleWire],
      chosen: dogWire,
      nested: dogWire
    };
    const shelter = api.Shelter.fromJSON(shelterWire, options);
    expect(shelter.toJSON(options)).toEqual(shelterWire);
    const value = shelter;
    expect(value).toMatchObject({
      pet: expect.any(api.Dog),
      pets: [expect.any(api.Dog), expect.any(api.Poodle)],
      nested: { pet: { animal: expect.any(api.Dog) } }
    });
    const wrappedWire = { ...shelterWire, nested: { '@type': 'animals.Nested', '@model': 'outer', '@data': dogWire } };
    expect(api.Shelter.fromJSON(wrappedWire, options).toJSON(options)).toEqual(wrappedWire);
    expect(() =>
      api.Shelter.fromJSON({ ...shelterWire, ambiguous: { '@type': 'animals.Animal', name: 'Fido' } }, options)
    ).toThrow(/exactly one Choice option/);
    expect(() => api.Animal.fromJSON({ '@type': 'animals.Shelter', pet: dogWire }, options)).toThrow(/not assignable/);
    expect(() => api.Animal.fromJSON({ '@type': 'unknown.Dog', name: 'Fido' }, options)).toThrow(/not assignable/);
    expect(() => api.Animal.fromJSON({ '@type': 'dogs.Dog', name: 'Fido' }, options)).toThrow();
    expect(() => api.Animal.fromJSON({ '@type': 'dogs.Dog', name: 'Fido', breed: 1 }, options)).toThrow();
    expect(() => api.Dog.fromJSON({ '@type': 'animals.Animal', name: 'Fido' }, options)).toThrow(/not assignable/);
  }
);
