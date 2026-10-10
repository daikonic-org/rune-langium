// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadRealWorker } from './helpers/real-codegen-worker.js';
import {
  parse,
  getExpressionRegions,
  getFunctionImplementationRegion,
  serializeRuneModel,
  createRuneDslServices
} from '@rune-langium/core';

const source = 'namespace test\nfunc Calculate:\n output: result int (1..1)\n set result: 1\n';
afterEach(() => vi.unstubAllGlobals());

async function requestFixture(language: 'typescript' | 'python' = 'typescript') {
  const parsed = await parse(source);
  const region = getFunctionImplementationRegion(parsed.value.elements[0], source);
  return {
    type: 'projection:generate',
    language,
    kind: 'function',
    source,
    subject: { uri: 'file:///test.rosetta', nodeId: 'test.Calculate#RosettaFunction', region },
    filesRevision: 1
  };
}

describe('linked expression projections', () => {
  it.each(
    ['date', 'time', 'dateTime', 'zonedDateTime', 'Kind', 'NumberAlias', 'DateAlias', 'EnumAlias'].flatMap((type) =>
      ['typescript', 'python'].map((language) => ({ type, language }))
    )
  )('uses declared $type values without normalizing a $language function body', async ({ type, language }) => {
    const fixture = `namespace test\nenum Kind:\n First\n Second\ntypeAlias NumberAlias: number\ntypeAlias DateAlias: date\ntypeAlias EnumAlias: Kind\nfunc Check:\n inputs: left ${type} (1..1)\n         right ${type} (1..1)\n output: result boolean (1..1)\n set result: left = right\n`;
    const parsed = await parse(fixture);
    const { scope, dispatch } = await loadRealWorker();
    const subject = {
      uri: 'file:///typed.rosetta',
      nodeId: 'test.Check#RosettaFunction',
      region: getFunctionImplementationRegion(
        parsed.value.elements.find((element) => element.name === 'Check')!,
        fixture
      )
    };
    dispatch({ type: 'preview:setFiles', filesRevision: 1, files: [{ uri: subject.uri, content: fixture }] });
    dispatch({
      type: 'projection:generate',
      requestId: type,
      language,
      kind: 'function',
      source: fixture,
      subject,
      filesRevision: 1
    });
    await vi.waitFor(() =>
      expect(scope.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'projection:result', requestId: type })
      )
    );
    const response = scope.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message.requestId === type);
    const calendar = ['date', 'time', 'dateTime', 'zonedDateTime', 'DateAlias'].includes(type);
    expect(response.projection.code).toContain(language === 'typescript' ? (calendar ? '.equals(' : '===') : '==');
    expect(response.projection.code).not.toMatch(/rune\.|\.from\(|export function|def Check\(/);
  });
  it.each([
    ['date', '2026-10-10', '2026-10-10'],
    ['time', '12:30:00.123456789', '12:30:00.123456789'],
    ['dateTime', '2026-10-10T12:30:00.123456789', '2026-10-10T12:30:00.123456789'],
    ['zonedDateTime', '2026-10-10T12:30:00.123456789+05:30', '2026-10-10T12:30:00.123456789+05:30[+05:30]']
  ])('converts nested %s form values once and returns cloneable JSON', async (type, value, expected) => {
    const fixture = `namespace test
annotation metadata:
 scheme string (0..1)
typeAlias Calendar: ${type}
type Entry:
 value Calendar (1..1)
  [metadata scheme]
 next Entry (0..1)
func Retain:
 inputs: entries Entry (0..*)
 output: result Entry (0..*)
 set result: entries
`;
    const { scope, dispatch } = await loadRealWorker();
    dispatch({
      type: 'preview:setFiles',
      filesRevision: 1,
      files: [{ uri: 'file:///calendar.rosetta', content: fixture }]
    });
    dispatch({
      type: 'preview:execute',
      funcName: 'test.Retain',
      requestId: 'calendar',
      inputs: { entries: [{ value, next: { value: { value, meta: { scheme: 'kept' } } } }] }
    });
    await vi.waitFor(() =>
      expect(scope.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'preview:execute-result', requestId: 'calendar' })
      )
    );
    const response = scope.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message.requestId === 'calendar');
    expect(response.output).toEqual([
      { value: { value: expected, meta: {} }, next: { value: { value: expected, meta: { scheme: 'kept' } } } }
    ]);
    expect(structuredClone(response)).toEqual(response);
    dispatch({
      type: 'preview:execute',
      funcName: 'test.Retain',
      requestId: 'invalid-calendar',
      inputs: { entries: [{ value: 'invalid' }] }
    });
    await vi.waitFor(() =>
      expect(scope.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'preview:execute-error', requestId: 'invalid-calendar' })
      )
    );
  });
  it.each([false, true])('renders native scalar operators for Abs, serialized=%s', async (serialized) => {
    const fixture =
      'namespace test\nfunc Abs:\n inputs: arg number (1..1)\n output: result number (1..1)\n set result: if arg < 0 then -1 * arg else arg\n';
    const parsed = await parse(fixture);
    expect(parsed.parserErrors).toEqual([]);
    const { RuneDsl } = createRuneDslServices();
    const { scope, dispatch } = await loadRealWorker();
    const subject = {
      uri: 'file:///abs.rosetta',
      nodeId: 'test.Abs#RosettaFunction',
      region: getFunctionImplementationRegion(parsed.value.elements[0]!, fixture)
    };
    dispatch({
      type: 'preview:setFiles',
      filesRevision: 1,
      files: [
        {
          uri: subject.uri,
          content: fixture,
          ...(serialized
            ? { serializedModelJson: serializeRuneModel(RuneDsl.serializer.JsonSerializer, parsed.value) }
            : {})
        }
      ]
    });
    dispatch({
      type: 'projection:generate',
      requestId: 'abs',
      language: 'typescript',
      kind: 'function',
      source: fixture,
      subject,
      filesRevision: 1
    });
    await vi.waitFor(() =>
      expect(scope.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'projection:result', requestId: 'abs' })
      )
    );
    const response = scope.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message.requestId === 'abs');
    expect(response.projection.code).toContain('input.arg < 0');
    expect(response.projection.code).toContain('-1 * input.arg');
    expect(response.projection.code).not.toMatch(/rune\.(?:compare|binary|normalize|get)\(/);
  });
  it.each([
    ['typescript', 'line', false],
    ['typescript', 'block', false],
    ['python', 'line', false],
    ['python', 'block', false],
    ['typescript', 'line', true],
    ['typescript', 'block', true],
    ['python', 'line', true],
    ['python', 'block', true]
  ] as const)('projects %s with a trailing %s body comment, serialized=%s', async (language, comment, serialized) => {
    const fixture =
      source +
      (comment === 'line' ? ' // trailing body comment' : ' /* trailing body comment */') +
      '\n// Neighbor documentation\nfunc Neighbor:\n output: result int (1..1)\n set result: 2\n';
    const parsed = await parse(fixture);
    expect(parsed.parserErrors).toEqual([]);
    const owner = parsed.value.elements[0]!;
    const region = getFunctionImplementationRegion(owner, fixture);
    expect(fixture.slice(region.from, region.to)).toContain('trailing body comment');
    expect(fixture.slice(region.from, region.to)).not.toContain('Neighbor documentation');
    const { RuneDsl } = createRuneDslServices();
    const { scope, dispatch } = await loadRealWorker();
    const subject = { uri: 'file:///comments.rosetta', nodeId: 'test.Calculate#RosettaFunction', region };
    dispatch({
      type: 'preview:setFiles',
      filesRevision: 1,
      files: [
        {
          uri: subject.uri,
          content: fixture,
          ...(serialized
            ? { serializedModelJson: serializeRuneModel(RuneDsl.serializer.JsonSerializer, parsed.value) }
            : {})
        }
      ]
    });
    dispatch({
      type: 'projection:generate',
      requestId: 'comments',
      language,
      kind: 'function',
      source: fixture,
      subject,
      filesRevision: 1
    });
    await vi.waitFor(() =>
      expect(scope.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'projection:result', requestId: 'comments' })
      )
    );
    const response = scope.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message.requestId === 'comments');
    expect(response.projection.code).toContain('return');
    expect(response.projection.code).not.toMatch(/export function|def Calculate/);
    expect(response.projection.code).not.toContain('Neighbor');
    expect(response.projection.subject).toEqual(subject);
    expect(response.projection.sourceMap[0]).toMatchObject({ sourceUri: subject.uri, sourceLine: 4 });
    dispatch({
      type: 'projection:generate',
      requestId: 'cross-owner',
      language,
      kind: 'function',
      source: fixture,
      subject: { ...subject, region: { ...region, to: fixture.length } },
      filesRevision: 1
    });
    await vi.waitFor(() =>
      expect(scope.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'projection:error', requestId: 'cross-owner' })
      )
    );
  });
  it.each(['typescript', 'python'] as const)('matches the edited Data condition expression in %s', async (language) => {
    const conditionSource =
      'namespace test\ntype Invoice:\n amount int (1..1)\n condition AmountPositive:\n  amount > 0\n';
    const parsed = await parse(conditionSource);
    const region = getExpressionRegions(parsed.value.elements[0])[0]!.region;
    const { scope, dispatch } = await loadRealWorker();
    const subject = { uri: 'file:///condition.rosetta', nodeId: 'test.Invoice#Data', region };
    dispatch({ type: 'preview:setFiles', filesRevision: 1, files: [{ uri: subject.uri, content: conditionSource }] });
    dispatch({
      type: 'projection:generate',
      requestId: 'condition',
      language,
      kind: 'condition',
      source: conditionSource,
      subject,
      filesRevision: 1
    });
    await vi.waitFor(() =>
      expect(scope.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'projection:result', requestId: 'condition' })
      )
    );
    const response = scope.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message.requestId === 'condition');
    expect(response.projection.code).toContain('amount');
  });
  it.each(['typescript', 'python'] as const)(
    'shows a %s function body and rejects outdated source/revisions',
    async (language) => {
      const { scope, dispatch } = await loadRealWorker();
      const request = await requestFixture(language);
      dispatch({ type: 'preview:setFiles', filesRevision: 1, files: [{ uri: request.subject.uri, content: source }] });
      dispatch({ ...request, requestId: 'first' });
      await vi.waitFor(() =>
        expect(scope.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'projection:result', requestId: 'first' })
        )
      );
      const response = scope.postMessage.mock.calls
        .map(([message]) => message)
        .find((message) => message.requestId === 'first');
      expect(response.projection.code).toContain('return');
      expect(response.projection.code).not.toMatch(/export function|def Calculate/);
      expect(response.projection.code).not.toContain('not renderable');
      dispatch({
        type: 'preview:setFiles',
        filesRevision: 2,
        files: [{ uri: request.subject.uri, content: source.replace('result: 1', 'result: 2') }]
      });
      dispatch({ ...request, requestId: 'stale' });
      await vi.waitFor(() =>
        expect(scope.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'projection:error',
            requestId: 'stale',
            error: expect.stringContaining('source changed')
          })
        )
      );
    }
  );
  it.each([
    ['typescript', 'file:///test.rosetta'],
    ['python', 'file:///test.rosetta'],
    ['typescript', 'file:///[cdm]/math functions.rosetta'],
    ['python', 'file:///[cdm]/math functions.rosetta']
  ] as const)(
    'projects serialized curated declarations as %s at %s with original source coordinates',
    async (language, uri) => {
      const { scope, dispatch } = await loadRealWorker();
      const request = await requestFixture(language);
      request.subject.uri = uri;
      const parsed = await parse(source);
      const { RuneDsl } = createRuneDslServices();
      const serializedModelJson = serializeRuneModel(RuneDsl.serializer.JsonSerializer, parsed.value);
      dispatch({
        type: 'preview:setFiles',
        filesRevision: 1,
        files: [{ uri: request.subject.uri, content: source, serializedModelJson }]
      });
      dispatch({ ...request, requestId: 'curated' });
      await vi.waitFor(() =>
        expect(scope.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'projection:result', requestId: 'curated' })
        )
      );
    }
  );
  it.each(['typescript', 'python'] as const)(
    'isolates the selected %s declaration while reporting failures in a selected broken declaration',
    async (language) => {
      const fixture = source + 'func Broken:\n output: result number (1..1)\n set result: Missing {}\n';
      const parsed = await parse(fixture);
      expect(parsed.parserErrors).toEqual([]);
      const { RuneDsl } = createRuneDslServices();
      const { scope, dispatch } = await loadRealWorker();
      const uri = 'file:///[cdm]/math functions.rosetta';
      dispatch({
        type: 'preview:setFiles',
        filesRevision: 1,
        files: [
          {
            uri,
            content: fixture,
            serializedModelJson: serializeRuneModel(RuneDsl.serializer.JsonSerializer, parsed.value)
          }
        ]
      });
      dispatch({
        type: 'projection:generate',
        requestId: 'valid-selected',
        language,
        kind: 'function',
        source: fixture,
        subject: {
          uri,
          nodeId: 'test.Calculate#RosettaFunction',
          region: getFunctionImplementationRegion(parsed.value.elements[0]!, fixture)
        },
        filesRevision: 1
      });
      await vi.waitFor(() =>
        expect(scope.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'projection:result', requestId: 'valid-selected' })
        )
      );
      if (language === 'python') {
        dispatch({
          type: 'projection:generate',
          requestId: 'broken-selected',
          language,
          kind: 'function',
          source: fixture,
          subject: {
            uri,
            nodeId: 'test.Broken#RosettaFunction',
            region: getFunctionImplementationRegion(parsed.value.elements[1]!, fixture)
          },
          filesRevision: 1
        });
        await vi.waitFor(() =>
          expect(scope.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
              type: 'projection:error',
              requestId: 'broken-selected',
              error: expect.stringContaining('linked type')
            })
          )
        );
      }
    }
  );
});
