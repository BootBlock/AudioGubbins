import { describe, expect, it } from 'vitest';

import {
  AssetOrigin,
  StandardLayouts,
  assetPlan,
  createDeterministicIdGenerator,
  derivedSampleCount,
  sampleRate,
  slicePlan,
  validateChain,
  type Asset,
  type EditOperation,
  type EditPlan,
} from '@audiogubbins/domain';
import {
  deepestChain,
  expectSuccess,
  TEST_CATALOGUE,
  TEST_ENGINE,
} from '@audiogubbins/domain/testing';
import { sampleProject } from '@audiogubbins/test-fixtures';

import { readAssetRecord, writeAssetRecord, type AssetRecord } from './asset-record-json.js';
import { canonicalJson, isJsonArray, type JsonValue } from './canonical-json.js';
import { startReading, type Converter } from './document-reading.js';
import { readEditOperation, readRegionOperation } from './edit-reading.js';
import { writeEditOperation, writeRegionOperation } from './edit-writing.js';
import { NESTED_ARGUMENT_LIMITS } from './invocation-provenance.js';
import { parseJson } from './json-parsing.js';
import { readEditPlan } from './plan-reading.js';
import { writeEditPlan } from './plan-writing.js';
import { readAnchoredLoop, readMarker, readRegion } from './placement-reading.js';
import { writeAnchoredLoop, writeMarker, writeRegion } from './placement-writing.js';
import { readProjectDocument, writeProjectDocument } from './project-json.js';
import { storageKeyOf } from './project-state.js';
import { valueAt, withValue, type Step } from './testing/json-editing.js';
import { contentIdOfDigit, editedReferenceState } from './testing/project-states.js';
import { randomState } from './testing/random-states.js';

/** A value read alone at the place `at`, as a command reads its argument. */
function readAlone<TValue>(read: Converter<TValue>, value: JsonValue, at = 'value') {
  const reading = startReading();
  return reading.outcome(read(reading, value, '', at));
}

/** Each failure's code and where it was found. */
function problemsOf<TValue>(read: Converter<TValue>, value: JsonValue) {
  const result = readAlone(read, value);
  return result.ok
    ? []
    : result.failures.map((problem) => [problem.code, problem.details?.['at']] as const);
}

/**
 * Asserts a value survives being written, carried as compact canonical text
 * within an argument's bounds, and read back, and writes the same text again.
 */
function expectRoundTrip<TValue>(
  read: Converter<TValue>,
  write: (value: TValue) => JsonValue,
  value: TValue,
  label: string,
): void {
  const text = canonicalJson(write(value));
  const back = expectSuccess(
    readAlone(read, expectSuccess(parseJson(text, NESTED_ARGUMENT_LIMITS))),
  );
  expect(back, label).toEqual(value);
  expect(canonicalJson(write(back)), label).toBe(text);
}

const STATES = Array.from({ length: 200 }, (_, index) => randomState(index + 1));

describe('every edit-model value survives being written and read alone', () => {
  it('an asset’s operations, the plans its pastes carry, and every value placed on it', () => {
    const seen = new Set<string>();
    for (const [index, { project }] of STATES.entries()) {
      const label = `seed ${String(index + 1)}`;
      for (const asset of project.assets.values()) {
        if (asset.rack !== undefined) seen.add('asset rack');
        for (const operation of asset.edits) {
          seen.add(operation.kind);
          if (operation.kind === 'process') seen.add(operation.edit.kind);
          expectRoundTrip(readEditOperation, writeEditOperation, operation, label);
          if (operation.kind === 'insert') {
            for (const stream of operation.payload.streams) {
              if (stream.processing !== undefined) seen.add(`processing ${stream.processing.kind}`);
              for (const segment of stream.segments) {
                seen.add(`source ${segment.source.kind}`);
                for (const stage of segment.stages) {
                  seen.add(stage.kind === 'gain' ? `curve ${stage.gain.kind}` : 'matrix');
                }
              }
            }
            expectRoundTrip(readEditPlan, writeEditPlan, operation.payload, label);
          }
        }
      }
      for (const region of project.regions.values()) {
        if (region.rack !== undefined) seen.add('region with a rack');
        expectRoundTrip(readRegion, writeRegion, region, label);
        if (region.loop !== undefined) {
          expectRoundTrip(readAnchoredLoop, writeAnchoredLoop, region.loop, label);
        }
        for (const operation of region.operations) {
          seen.add(`region ${operation.edit.kind}`);
          expectRoundTrip(readRegionOperation, writeRegionOperation, operation, label);
        }
      }
      for (const marker of project.markers.values()) {
        expectRoundTrip(readMarker, writeMarker, marker, label);
      }
    }
    // So the property is not vacuous: every kind of operation, range edit,
    // segment source and stage passed through it.
    expect([...seen].sort()).toEqual(
      [
        'asset rack',
        'channel-gains',
        'convert-layout',
        'convert-rate',
        'copy-channel',
        'curve constant',
        'curve fade',
        'delete',
        'fade',
        'gain',
        'insert',
        'invert',
        'matrix',
        'process',
        'processing chain',
        'processing stretch',
        'rack',
        'region channel-gains',
        'region copy-channel',
        'region fade',
        'region gain',
        'region invert',
        'region rack',
        'region silence',
        'region swap-channels',
        'region with a rack',
        'reverse',
        'silence',
        'source media',
        'source stream',
        'stretch',
        'swap-channels',
        'trim',
      ].sort(),
    );
  });
});

const IDS = createDeterministicIdGenerator(51);
const RATE = expectSuccess(sampleRate(48_000));

function assetOf(edits: readonly EditOperation[]): Asset {
  return {
    id: IDS.next<'AssetId'>(),
    displayName: 'Take',
    origin: AssetOrigin.Imported,
    sampleRate: RATE,
    channelLayout: StandardLayouts.mono,
    length: derivedSampleCount(48_000),
    storageKey: '',
    edits,
  };
}

/**
 * An asset whose chain holds the deepest value an argument carries: a paste of
 * audio racked by the deepest chain the domain accepts, so the paste's plan
 * holds that chain, and already converted to stereo, so each of its segments
 * has a matrix stage too.
 */
function deepestAsset(): Asset {
  const conversion: EditOperation = {
    id: IDS.next<'EditOperationId'>(),
    kind: 'convert-layout',
    layout: StandardLayouts.stereo,
    matrix: [[1], [1]],
  };
  const base = assetOf([conversion]);
  const rack = deepestChain(IDS);
  const context = {
    chains: new Map([[rack.id, rack]]),
    catalogue: TEST_CATALOGUE,
    engine: TEST_ENGINE,
  };
  const payload: EditPlan = expectSuccess(
    slicePlan(expectSuccess(assetPlan({ ...base, rack: rack.id }, context)), 0, 1_000),
  );
  expect(payload.streams.some((stream) => stream.processing?.kind === 'chain')).toBe(true);
  const paste: EditOperation = {
    id: IDS.next<'EditOperationId'>(),
    kind: 'insert',
    at: derivedSampleCount(0),
    payload,
  };
  const asset = { ...base, edits: [conversion, paste] };
  expectSuccess(validateChain(asset, new Map([[asset.id, asset]]), context.chains));
  return asset;
}

describe('an edit-model value carried as a command’s argument', () => {
  const asset = deepestAsset();
  const media = {
    kind: 'managed',
    contentId: contentIdOfDigit('d'),
    byteLength: 96_044,
    mediaType: 'audio/wav',
  } as const;
  const record: AssetRecord = {
    asset: { ...asset, storageKey: storageKeyOf(asset.id, media) },
    source: { media },
  };
  const paste = asset.edits[1];
  if (paste === undefined) throw new Error('The deepest asset has no paste.');

  it('parses within the nested-argument bounds at its deepest, and reads back', () => {
    expectRoundTrip(readAssetRecord, writeAssetRecord, record, 'asset record');
    expectRoundTrip(readEditOperation, writeEditOperation, paste, 'paste');
  });

  it('needs every level the bound allows, so the bound is the smallest that fits', () => {
    const text = canonicalJson(writeAssetRecord(record));
    const shallower = {
      ...NESTED_ARGUMENT_LIMITS,
      maximumDepth: NESTED_ARGUMENT_LIMITS.maximumDepth - 1,
    };
    const refused = parseJson(text, shallower);
    expect(refused.ok ? undefined : refused.failures[0].code).toBe('json.too-deep');
  });

  it('holds the deepest region, with a loop and processing, well within the bound', () => {
    const fixture = editedReferenceState(sampleProject());
    const [region] = [...fixture.project.regions.values()].filter(
      (held) => held.operations.length > 0,
    );
    if (region === undefined) throw new Error('The edited reference state has no processing.');
    expectRoundTrip(readRegion, writeRegion, region, 'region');
  });
});

describe('an edit-model value read alone refuses', () => {
  const range = { start: 0, end: 10 };
  const cases: readonly (readonly [string, Converter<unknown>, JsonValue, string, string])[] = [
    [
      'a member its kind does not define',
      readEditOperation,
      { id: '0000aaaa', kind: 'delete', range, at: 4 },
      'schema.unknown-member',
      'value',
    ],
    [
      'a stretch that names no version of the stretch it was made by',
      readEditOperation,
      { id: '0000aaaa', kind: 'stretch', range, length: 20 },
      'schema.missing-member',
      'value.version',
    ],
    [
      'a conversion of rate made by version 0 of the resampler, which no build has',
      readEditOperation,
      { id: '0000aaaa', kind: 'convert-rate', sampleRate: 44_100, version: 0 },
      'schema.number-out-of-range',
      'value.version',
    ],
    [
      'a paste converted by version 0 of the resampler, which no build has',
      readEditOperation,
      {
        id: '0000aaaa',
        kind: 'insert',
        at: 0,
        payload: planWithStage({ kind: 'matrix', matrix: [[1]] }),
        resampler: 0,
      },
      'schema.number-out-of-range',
      'value.resampler',
    ],
    [
      'a paste that says it converts without naming the resampler that does',
      readEditOperation,
      {
        id: '0000aaaa',
        kind: 'insert',
        at: 0,
        payload: planWithStage({ kind: 'matrix', matrix: [[1]] }),
        convertRate: true,
      },
      'schema.unknown-member',
      'value',
    ],
    [
      'a kind the domain does not name',
      readEditOperation,
      { id: '0000aaaa', kind: 'time-warp', range },
      'schema.unknown-value',
      'value.kind',
    ],
    [
      'a channel past the most a layout has',
      readEditOperation,
      { id: '0000aaaa', kind: 'process', range, channels: [256], edit: { kind: 'silence' } },
      'schema.number-out-of-range',
      'value.channels[0]',
    ],
    [
      'a negative level gain',
      readEditOperation,
      { id: '0000aaaa', kind: 'process', range, edit: { kind: 'gain', gain: -1 } },
      'schema.number-out-of-range',
      'value.edit.gain',
    ],
    [
      'a gain past sixty decibels',
      readRegionOperation,
      { id: '0000aaaa', basis: 0, range, edit: { kind: 'channel-gains', gains: [1, 1_001] } },
      'schema.number-out-of-range',
      'value.edit.gains[1]',
    ],
    [
      'a matrix with more rows than a layout has channels',
      readEditOperation,
      {
        id: '0000aaaa',
        kind: 'convert-layout',
        layout: { roles: ['mono'] },
        matrix: Array.from({ length: 257 }, () => [1]),
      },
      'schema.too-many-items',
      'value.matrix',
    ],
    [
      'a fade whose frames step by nothing',
      readEditPlan,
      planWithStage({
        kind: 'gain',
        from: 0,
        to: 10,
        gain: { kind: 'fade', origin: -4, step: 0, length: 10, shape: 'linear', rising: true },
      }),
      'schema.unknown-value',
      'value.streams[0].segments[0].stages[0].gain.step',
    ],
    [
      'a stage member its kind does not define',
      readEditPlan,
      planWithStage({ kind: 'matrix', matrix: [[1]], gain: { kind: 'constant', gain: 1 } }),
      'schema.unknown-member',
      'value.streams[0].segments[0].stages[0]',
    ],
    [
      'a plan of no streams',
      readEditPlan,
      { streams: [] },
      'edit.plan-without-stream',
      'value.streams',
    ],
    [
      'a region whose tags are out of order',
      readRegion,
      {
        id: '0000aaaa',
        assetId: '0000bbbb',
        displayName: 'Step',
        basis: 0,
        start: 0,
        end: 10,
        tags: ['b', 'a'],
        operations: [],
      },
      'project.region-tags-not-canonical',
      'value.tags',
    ],
    [
      'a loop with no crossfade length',
      readAnchoredLoop,
      { basis: 0, start: 0, end: 10 },
      'schema.missing-member',
      'value.crossfadeLength',
    ],
  ];

  it.each(cases)('%s', (_case, read, value, code, at) => {
    expect(problemsOf(read, value)).toContainEqual([code, at]);
  });

  it('nothing it should accept: negative stage gains and fade origins, either step', () => {
    const plan = planWithStage({
      kind: 'gain',
      from: 0,
      to: 10,
      channels: [0],
      gain: { kind: 'fade', origin: -4, step: -1, length: 10, shape: 's-curve', rising: false },
    });
    expect(problemsOf(readEditPlan, plan)).toEqual([]);
    expect(
      problemsOf(
        readEditPlan,
        planWithStage({ kind: 'matrix', range: { from: 0, to: 4 }, matrix: [[-1_000]] }),
      ),
    ).toEqual([]);
  });
});

/** A one-segment plan whose segment passes through `stage`. */
function planWithStage(stage: JsonValue): JsonValue {
  return {
    streams: [
      {
        sampleRate: 48_000,
        layout: { roles: ['mono'] },
        segments: [
          {
            source: { kind: 'media', asset: '0000bbbb' },
            start: 0,
            length: 10,
            reversed: false,
            stages: [stage],
          },
        ],
      },
    ],
  };
}

const EDITED = editedReferenceState(sampleProject());
const DOCUMENT = writeProjectDocument(EDITED);

/** How many items the list at `path` in `value` holds. */
function countAt(value: JsonValue, path: readonly Step[]): number {
  const list = valueAt(value, path);
  return isJsonArray(list) ? list.length : 0;
}

/** The place in a written list of the first item whose list at `path` holds something. */
function firstHolding(list: readonly Step[], path: readonly Step[]): number {
  const items = valueAt(DOCUMENT, list);
  const index = isJsonArray(items) ? items.findIndex((item) => countAt(item, path) > 0) : -1;
  if (index < 0) throw new Error(`Nothing in ${list.join('.')} holds ${path.join('.')}.`);
  return index;
}

const EDITED_ASSET = firstHolding(['project', 'assets'], ['edits']);
const PROCESSED_REGION = firstHolding(['project', 'regions'], ['operations']);
const EDITS: readonly Step[] = ['project', 'assets', EDITED_ASSET, 'edits'];

/** Each failure's code, where it was found and the domain's code it gives as its cause. */
function documentProblems(value: JsonValue) {
  const result = readProjectDocument(value);
  return result.ok
    ? []
    : result.failures.map(
        (problem) => [problem.code, problem.details?.['at'], problem.details?.['cause']] as const,
      );
}

describe('a project document holding the edit model', () => {
  it('reads back as the state it was written from', () => {
    expect(expectSuccess(readProjectDocument(DOCUMENT))).toEqual(EDITED);
    expect(canonicalJson(writeProjectDocument(expectSuccess(readProjectDocument(DOCUMENT))))).toBe(
      canonicalJson(DOCUMENT),
    );
  });

  it.each<readonly [string, (document: JsonValue) => JsonValue, string, string, string]>([
    [
      'an edit naming a channel its asset does not have there',
      (document) => withValue(document, [...EDITS, 0, 'channels'], [1]),
      'project.asset-edits-invalid',
      'project.assets',
      'editing.operation-invalid',
    ],
    [
      'a paste reading an asset the project does not have',
      (document) =>
        withValue(
          document,
          [...EDITS, 1, 'payload', 'streams', 0, 'segments', 0, 'source', 'asset'],
          'ffffffff-ffffffff',
        ),
      'project.asset-edits-invalid',
      'project.assets',
      'editing.plan-malformed',
    ],
    [
      'two edits of one identifier',
      (document) =>
        withValue(document, [...EDITS, 1, 'id'], valueAt(document, [...EDITS, 0, 'id']) ?? null),
      'project.asset-edits-invalid',
      'project.assets',
      'editing.duplicate-operation',
    ],
    [
      'an edit reaching past the audio the edits before it left',
      (document) => withValue(document, [...EDITS, 5, 'range', 'end'], 1_000_000),
      'project.asset-edits-invalid',
      'project.assets',
      'editing.operation-invalid',
    ],
    [
      'region processing naming channels from before a conversion',
      (document) =>
        withValue(document, ['project', 'regions', PROCESSED_REGION, 'operations', 1, 'basis'], 2),
      'project.region-off-asset',
      `project.regions[${String(PROCESSED_REGION)}]`,
      'editing.region-operation-invalid',
    ],
  ])('%s', (_case, edit, code, at, cause) => {
    expect(documentProblems(edit(DOCUMENT))).toContainEqual([code, at, cause]);
  });

  it('refuses nothing on an asset whose chain it refused, beyond the chain', () => {
    const broken = withValue(DOCUMENT, [...EDITS, 0, 'channels'], [1]);
    expect(documentProblems(broken).map(([code]) => code)).toEqual(['project.asset-edits-invalid']);
  });
});
