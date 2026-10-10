import { describe, expect, it } from 'vitest';

import type {
  PlannedSpectralEdit,
  SpectralEdit,
  SpectralOperationKind,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { sampleProject } from '@audiogubbins/test-fixtures';

import { canonicalJson, isJsonArray, type JsonValue } from './canonical-json.js';
import { startReading, type Converter } from './document-reading.js';
import { readEditOperation, readRegionOperation } from './edit-reading.js';
import { writeEditOperation, writeRegionOperation } from './edit-writing.js';
import { NESTED_ARGUMENT_LIMITS } from './invocation-provenance.js';
import { parseJson } from './json-parsing.js';
import { readRegion } from './placement-reading.js';
import { writeRegion } from './placement-writing.js';
import { readEditPlan } from './plan-reading.js';
import { writeEditPlan } from './plan-writing.js';
import { readProjectDocument, writeProjectDocument } from './project-json.js';
import { valueAt, withValue, type Step } from './testing/json-editing.js';
import { randomState } from './testing/random-states.js';
import { spectralState } from './testing/spectral-states.js';

/**
 * Spectral edits survive the project format bit for bit (ADR-0081): in an
 * asset's chain, in a region's processing and in the plan a paste carries,
 * each read alone as a command's argument is and in a whole document; and a
 * mask, a resolution, a reduction or a chain that is not one is refused on
 * reading with the reason.
 */

const SPECTRAL = spectralState(sampleProject());

/** The fixed state, which holds every case whatever the seeds give, and random ones. */
const STATES = [SPECTRAL, ...Array.from({ length: 200 }, (_, index) => randomState(index + 1))];

/** Where a spectral edit is kept. */
type Place = 'chain' | 'region' | 'plan';

const PLACES: readonly Place[] = ['chain', 'region', 'plan'];
const OPERATIONS: readonly SpectralOperationKind[] = ['attenuate', 'isolate', 'heal', 'process'];

/** A value read alone at the place `value`, as a command reads its argument. */
function readAlone<TValue>(read: Converter<TValue>, value: JsonValue) {
  const reading = startReading();
  return reading.outcome(read(reading, value, '', 'value'));
}

/**
 * Asserts a value survives being written, carried as compact canonical text
 * within an argument's bounds, and read back as the same value, which writes
 * the same text again: every number of it the same double.
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

/** What of each case a spectral edit at `place` holds. */
function casesOf(place: Place, edit: SpectralEdit | PlannedSpectralEdit): readonly string[] {
  const { mask } = edit;
  return [
    `${place} ${edit.operation.kind}`,
    `${place} ${mask.feather.time > 0 ? 'feathered' : 'hard'}`,
    ...mask.shapes.map((shape) => `${place} ${shape.kind} ${shape.effect}`),
  ];
}

describe('every spectral edit survives being written and read, bit for bit', () => {
  it('in an asset’s chain, a paste’s plan and a region’s processing, alone and in a document', () => {
    const seen = new Set<string>();
    for (const [index, state] of STATES.entries()) {
      const label = `state ${String(index)}`;
      let holds = false;
      for (const asset of state.project.assets.values()) {
        for (const operation of asset.edits) {
          if (operation.kind === 'process' && operation.edit.kind === 'spectral') {
            holds = true;
            for (const each of casesOf('chain', operation.edit)) seen.add(each);
            expectRoundTrip(readEditOperation, writeEditOperation, operation, label);
          }
          if (operation.kind !== 'insert') continue;
          const planned = operation.payload.streams.flatMap((stream) =>
            stream.processing?.kind === 'spectral' ? [stream.processing.edit] : [],
          );
          if (planned.length === 0) continue;
          holds = true;
          for (const edit of planned) for (const each of casesOf('plan', edit)) seen.add(each);
          expectRoundTrip(readEditPlan, writeEditPlan, operation.payload, label);
        }
      }
      for (const region of state.project.regions.values()) {
        let spectral = false;
        for (const operation of region.operations) {
          if (operation.edit.kind !== 'spectral') continue;
          spectral = true;
          for (const each of casesOf('region', operation.edit)) seen.add(each);
          expectRoundTrip(readRegionOperation, writeRegionOperation, operation, label);
        }
        if (!spectral) continue;
        holds = true;
        expectRoundTrip(readRegion, writeRegion, region, label);
      }
      if (!holds) continue;
      const document = writeProjectDocument(state);
      const back = expectSuccess(readProjectDocument(document));
      expect(back, label).toEqual(state);
      expect(canonicalJson(writeProjectDocument(back)), label).toBe(canonicalJson(document));
    }
    // So the property is not vacuous: every operation, every kind of shape
    // adding and taking away, hard and feathered, passed through each place.
    const expected = PLACES.flatMap((place) => [
      ...OPERATIONS.map((operation) => `${place} ${operation}`),
      `${place} feathered`,
      `${place} hard`,
      ...['rectangle', 'polygon', 'stroke'].flatMap((kind) => [
        `${place} ${kind} add`,
        `${place} ${kind} subtract`,
      ]),
    ]);
    expect([...seen].sort()).toEqual(expected.sort());
  });
});

const RANGE = { start: 0, end: 10 };
const RECTANGLE = {
  kind: 'rectangle',
  effect: 'add',
  range: RANGE,
  band: { low: 100, high: 1_000 },
};
const HARD = { time: 0, frequency: 0 };

/** A spectral edit over the first ten frames, with members replaced by `members`. */
function spectralEdit(members: Readonly<Record<string, JsonValue>> = {}): JsonValue {
  return {
    kind: 'spectral',
    mask: { shapes: [RECTANGLE], feather: HARD },
    resolution: 256,
    operation: { kind: 'heal' },
    ...members,
  };
}

/** An operation of a chain carrying `edit` over the first ten frames. */
function chainOperation(edit: JsonValue): JsonValue {
  return { id: '0000aaaa', kind: 'process', range: RANGE, edit };
}

/** A spectral edit over the first ten frames whose mask holds `shape`. */
function withShape(shape: JsonValue): JsonValue {
  return chainOperation(spectralEdit({ mask: { shapes: [shape], feather: HARD } }));
}

/** A one-segment mono plan of ten frames whose stream carries the spectral edit `edit`. */
function plannedSpectral(edit: JsonValue): JsonValue {
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
            stages: [],
          },
        ],
        processing: { kind: 'spectral', edit },
      },
    ],
  };
}

const STROKE_POINT = {
  position: 5,
  frequency: 400,
  strength: 1,
  radius: { time: 2, frequency: 50 },
};

describe('a spectral edit read alone refuses', () => {
  const cases: readonly (readonly [string, Converter<unknown>, JsonValue, string, string])[] = [
    [
      'a mask of no shapes',
      readEditOperation,
      chainOperation(spectralEdit({ mask: { shapes: [], feather: HARD } })),
      'schema.too-few-items',
      'value.edit.mask',
    ],
    [
      'a mask of more shapes than one may hold',
      readEditOperation,
      chainOperation(
        spectralEdit({
          mask: { shapes: Array.from({ length: 1_025 }, () => RECTANGLE), feather: HARD },
        }),
      ),
      'schema.too-many-items',
      'value.edit.mask.shapes',
    ],
    [
      'a mask with no feather',
      readEditOperation,
      chainOperation(spectralEdit({ mask: { shapes: [RECTANGLE] } })),
      'schema.missing-member',
      'value.edit.mask.feather',
    ],
    [
      'a feather softening only time',
      readEditOperation,
      chainOperation(spectralEdit({ mask: { shapes: [RECTANGLE], feather: { time: 4 } } })),
      'schema.missing-member',
      'value.edit.mask.feather.frequency',
    ],
    [
      'a shape of a kind no mask has',
      readEditOperation,
      withShape({ ...RECTANGLE, kind: 'ellipse' }),
      'schema.unknown-value',
      'value.edit.mask.shapes[0].kind',
    ],
    [
      'a shape that neither adds nor takes away',
      readEditOperation,
      withShape({ ...RECTANGLE, effect: 'intersect' }),
      'schema.unknown-value',
      'value.edit.mask.shapes[0].effect',
    ],
    [
      'a rectangle with a member only a stroke has',
      readEditOperation,
      withShape({ ...RECTANGLE, hardness: 0.5 }),
      'schema.unknown-member',
      'value.edit.mask.shapes[0]',
    ],
    [
      'a rectangle whose band reaches past the highest frequency',
      readEditOperation,
      withShape({ ...RECTANGLE, band: { low: 0, high: 1e9 } }),
      'schema.number-out-of-range',
      'value.edit.mask.shapes[0].band.high',
    ],
    [
      'a polygon of two points',
      readEditOperation,
      withShape({
        kind: 'polygon',
        effect: 'add',
        points: [
          { position: 0, frequency: 0 },
          { position: 10, frequency: 100 },
        ],
      }),
      'schema.too-few-items',
      'value.edit.mask.shapes[0]',
    ],
    [
      'a polygon point before the start',
      readEditOperation,
      withShape({
        kind: 'polygon',
        effect: 'add',
        points: [
          { position: -1, frequency: 0 },
          { position: 10, frequency: 100 },
          { position: 5, frequency: 900 },
        ],
      }),
      'time.sample-count-negative',
      'value.edit.mask.shapes[0].points[0].position',
    ],
    [
      'a stroke of no points',
      readEditOperation,
      withShape({ kind: 'stroke', effect: 'add', hardness: 0.5, points: [] }),
      'schema.too-few-items',
      'value.edit.mask.shapes[0]',
    ],
    [
      'a stroke with no hardness',
      readEditOperation,
      withShape({ kind: 'stroke', effect: 'add', points: [STROKE_POINT] }),
      'schema.missing-member',
      'value.edit.mask.shapes[0].hardness',
    ],
    [
      'a brush stronger than full',
      readEditOperation,
      withShape({
        kind: 'stroke',
        effect: 'add',
        hardness: 0.5,
        points: [{ ...STROKE_POINT, strength: 1.5 }],
      }),
      'schema.number-out-of-range',
      'value.edit.mask.shapes[0].points[0].strength',
    ],
    [
      'a brush of a negative size',
      readEditOperation,
      withShape({
        kind: 'stroke',
        effect: 'add',
        hardness: 0.5,
        points: [{ ...STROKE_POINT, radius: { time: -2, frequency: 50 } }],
      }),
      'schema.number-out-of-range',
      'value.edit.mask.shapes[0].points[0].radius.time',
    ],
    [
      'a resolution below the smallest frame',
      readEditOperation,
      chainOperation(spectralEdit({ resolution: 128 })),
      'schema.number-out-of-range',
      'value.edit.resolution',
    ],
    [
      'a resolution past the longest frame',
      readEditOperation,
      chainOperation(spectralEdit({ resolution: 32_768 })),
      'schema.number-out-of-range',
      'value.edit.resolution',
    ],
    [
      'a resolution of part of a frame',
      readEditOperation,
      chainOperation(spectralEdit({ resolution: 256.5 })),
      'schema.not-an-integer',
      'value.edit.resolution',
    ],
    [
      'an edit with no resolution',
      readRegionOperation,
      {
        id: '0000aaaa',
        basis: 0,
        range: RANGE,
        edit: { kind: 'spectral', mask: { shapes: [RECTANGLE], feather: HARD }, operation: {} },
      },
      'schema.missing-member',
      'value.edit.resolution',
    ],
    [
      'an operation of a kind no spectral edit has',
      readEditOperation,
      chainOperation(spectralEdit({ operation: { kind: 'sharpen' } })),
      'schema.unknown-value',
      'value.edit.operation.kind',
    ],
    [
      'a reduction past full',
      readEditOperation,
      chainOperation(spectralEdit({ operation: { kind: 'attenuate', gain: 1.5 } })),
      'schema.number-out-of-range',
      'value.edit.operation.gain',
    ],
    [
      'a negative reduction',
      readRegionOperation,
      {
        id: '0000aaaa',
        basis: 0,
        range: RANGE,
        edit: spectralEdit({ operation: { kind: 'isolate', gain: -0.5 } }),
      },
      'schema.number-out-of-range',
      'value.edit.operation.gain',
    ],
    [
      'an attenuation with no reduction',
      readEditOperation,
      chainOperation(spectralEdit({ operation: { kind: 'attenuate' } })),
      'schema.missing-member',
      'value.edit.operation.gain',
    ],
    [
      'a heal with a reduction',
      readEditOperation,
      chainOperation(spectralEdit({ operation: { kind: 'heal', gain: 0.5 } })),
      'schema.unknown-member',
      'value.edit.operation',
    ],
    [
      'a process that names no chain',
      readEditOperation,
      chainOperation(spectralEdit({ operation: { kind: 'process' } })),
      'schema.missing-member',
      'value.edit.operation.chain',
    ],
    [
      'region processing whose process names no chain',
      readRegionOperation,
      {
        id: '0000aaaa',
        basis: 0,
        range: RANGE,
        edit: spectralEdit({ operation: { kind: 'process' } }),
      },
      'schema.missing-member',
      'value.edit.operation.chain',
    ],
    [
      'a planned process that carries no chain',
      readEditPlan,
      plannedSpectral({
        mask: { shapes: [RECTANGLE], feather: HARD },
        resolution: 256,
        operation: { kind: 'process', input: { roles: ['mono'] } },
      }),
      'schema.missing-member',
      'value.streams[0].processing.edit.operation.chain',
    ],
    [
      'a planned process that names its chain rather than carrying it',
      readEditPlan,
      plannedSpectral({
        mask: { shapes: [RECTANGLE], feather: HARD },
        resolution: 256,
        operation: { kind: 'process', chain: '0000cccc', input: { roles: ['mono'] } },
      }),
      'schema.not-an-object',
      'value.streams[0].processing.edit.operation.chain',
    ],
    [
      'a planned process that does not say what its chain reads',
      readEditPlan,
      plannedSpectral({
        mask: { shapes: [RECTANGLE], feather: HARD },
        resolution: 256,
        operation: { kind: 'process', chain: { id: '0000cccc', slots: [] } },
      }),
      'schema.missing-member',
      'value.streams[0].processing.edit.operation.input',
    ],
    [
      'a planned edit at a resolution past the longest frame',
      readEditPlan,
      plannedSpectral({
        mask: { shapes: [RECTANGLE], feather: HARD },
        resolution: 32_768,
        operation: { kind: 'heal' },
      }),
      'schema.number-out-of-range',
      'value.streams[0].processing.edit.resolution',
    ],
  ];

  it.each(cases)('%s', (_case, read, value, code, at) => {
    const result = readAlone(read, value);
    expect(
      result.ok ? [] : result.failures.map((problem) => [problem.code, problem.details?.['at']]),
    ).toContainEqual([code, at]);
  });

  it('nothing it should accept: the edit each case breaks, in each place', () => {
    const planned = { mask: { shapes: [RECTANGLE], feather: HARD }, resolution: 256 };
    expect(readAlone(readEditOperation, chainOperation(spectralEdit())).ok).toBe(true);
    expect(
      readAlone(readRegionOperation, {
        id: '0000aaaa',
        basis: 0,
        range: RANGE,
        edit: spectralEdit(),
      }).ok,
    ).toBe(true);
    expect(
      readAlone(
        readEditPlan,
        plannedSpectral({
          ...planned,
          operation: {
            kind: 'process',
            chain: { id: '0000cccc', slots: [] },
            input: { roles: ['mono'] },
          },
        }),
      ).ok,
    ).toBe(true);
  });
});

const DOCUMENT = writeProjectDocument(SPECTRAL);

/** The place in a written list of the first item whose list at `path` holds something. */
function firstHolding(list: readonly Step[], path: readonly Step[]): number {
  const items = valueAt(DOCUMENT, list);
  const index = isJsonArray(items)
    ? items.findIndex((item) => {
        const held = valueAt(item, path);
        return isJsonArray(held) && held.length > 0;
      })
    : -1;
  if (index < 0) throw new Error(`Nothing in ${list.join('.')} holds ${path.join('.')}.`);
  return index;
}

const EDITED_ASSET = firstHolding(['project', 'assets'], ['edits']);
const PROCESSED_REGION = firstHolding(['project', 'regions'], ['operations']);
const EDITS: readonly Step[] = ['project', 'assets', EDITED_ASSET, 'edits'];
const REGION_AT = `project.regions[${String(PROCESSED_REGION)}]`;
const PROCESSING: readonly Step[] = ['project', 'regions', PROCESSED_REGION, 'operations'];

/** The place of the first stream of the paste's plan that carries a spectral edit. */
const PLANNED_STREAM = (() => {
  const paste = [...SPECTRAL.project.assets.values()].flatMap((asset) => asset.edits)[4];
  const index =
    paste?.kind === 'insert'
      ? paste.payload.streams.findIndex((stream) => stream.processing?.kind === 'spectral')
      : -1;
  if (index < 0) throw new Error('The paste carries no spectral edit.');
  return index;
})();
const PLANNED: readonly Step[] = [
  ...EDITS,
  4,
  'payload',
  'streams',
  PLANNED_STREAM,
  'processing',
  'edit',
];

/** Each failure's code, where it was found, the domain's code it gives as its cause, and why. */
function documentProblems(value: JsonValue) {
  const result = readProjectDocument(value);
  return result.ok
    ? []
    : result.failures.map(
        (problem) =>
          [
            problem.code,
            problem.details?.['at'],
            problem.details?.['cause'],
            problem.summary,
          ] as const,
      );
}

const CHAIN_INVALID = [
  'project.asset-edits-invalid',
  'project.assets',
  'editing.operation-invalid',
];
const REGION_INVALID = ['project.region-off-asset', REGION_AT, 'editing.region-operation-invalid'];

describe('a project document holding spectral edits', () => {
  it('reads back as the state it was written from', () => {
    expect(expectSuccess(readProjectDocument(DOCUMENT))).toEqual(SPECTRAL);
  });

  it.each<readonly [string, readonly Step[], JsonValue, readonly string[], string]>([
    [
      'a resolution that is not a power of two',
      [...EDITS, 0, 'edit', 'resolution'],
      300,
      CHAIN_INVALID,
      'A spectral edit’s resolution must be a power of two from 256 to 16,384 samples.',
    ],
    [
      'a mask reaching past its range',
      [...EDITS, 0, 'edit', 'mask', 'shapes', 0, 'range', 'end'],
      8_001,
      CHAIN_INVALID,
      'A rectangle of the selection covers no audio.',
    ],
    [
      'a feather softening time and not frequency',
      [...EDITS, 0, 'edit', 'mask', 'feather', 'frequency'],
      0,
      CHAIN_INVALID,
      'A selection’s softness is either none or some in both time and frequency.',
    ],
    [
      'a mask whose every shape takes away',
      [...EDITS, 0, 'edit', 'mask', 'shapes', 0, 'effect'],
      'subtract',
      CHAIN_INVALID,
      'A selection needs a shape that adds to it.',
    ],
    [
      'a stroke at full hardness',
      [...EDITS, 1, 'edit', 'mask', 'shapes', 0, 'hardness'],
      1,
      CHAIN_INVALID,
      'A brush’s hardness must be from nothing to just below full.',
    ],
    [
      'a brush of no strength',
      [...EDITS, 1, 'edit', 'mask', 'shapes', 0, 'points', 0, 'strength'],
      0,
      CHAIN_INVALID,
      'A brush’s strength must be above nothing and at most full.',
    ],
    [
      'a reduction of none',
      [...EDITS, 1, 'edit', 'operation', 'gain'],
      1,
      CHAIN_INVALID,
      'A spectral reduction must be a factor from nothing to just below one.',
    ],
    [
      'a process naming a chain the project does not have',
      [...EDITS, 3, 'edit', 'operation', 'chain'],
      'ffffffff-ffffffff',
      CHAIN_INVALID,
      'The spectral edit names a chain the project does not have.',
    ],
    [
      'a paste whose planned edit has a resolution that is not a power of two',
      [...PLANNED, 'resolution'],
      300,
      ['project.asset-edits-invalid', 'project.assets', 'editing.plan-malformed'],
      'A spectral edit’s resolution is unknown.',
    ],
    [
      'region processing whose mask reaches past its range',
      [...PROCESSING, 0, 'edit', 'mask', 'shapes', 0, 'points', 1, 'position'],
      4_801,
      REGION_INVALID,
      'A point of the selection lies outside the audio.',
    ],
    [
      'region processing naming a chain the project does not have',
      [...PROCESSING, 3, 'edit', 'operation', 'chain'],
      'ffffffff-ffffffff',
      REGION_INVALID,
      'The spectral edit names a chain the project does not have.',
    ],
  ])('refuses %s, with the reason', (_case, path, value, [code, at, cause], reason) => {
    expect(documentProblems(withValue(DOCUMENT, path, value))).toContainEqual([
      code,
      at,
      cause,
      reason,
    ]);
  });
});
