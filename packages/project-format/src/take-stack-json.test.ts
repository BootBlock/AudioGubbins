import { describe, expect, it } from 'vitest';

import type { Asset } from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { SCHEMA_VERSIONS } from '@audiogubbins/version';
import { sampleProject } from '@audiogubbins/test-fixtures';

import { canonicalJson, isJsonArray, type JsonValue } from './canonical-json.js';
import { startReading, type Converter } from './document-reading.js';
import { readEditPlan } from './plan-reading.js';
import { writeEditPlan } from './plan-writing.js';
import { readProjectDocument, writeProjectDocument } from './project-json.js';
import { ProvenanceLevel, stripAssetProvenance } from './provenance-stripping.js';
import { endedUnexpectedly, RecordingEnding } from './recorded-provenance.js';
import {
  CHUNK_SAMPLE_FORMAT,
  readRecoveryManifest,
  writeRecoveryManifest,
  type RecoveryChunkManifest,
} from './recovery-manifest.js';
import { readTakeStack } from './take-stack-reading.js';
import { writeTakeStack } from './take-stack-writing.js';
import { valueAt, withValue } from './testing/json-editing.js';
import { randomTakeStacks } from './testing/random-recordings.js';
import { randomRecordingStart } from './testing/random-values.js';
import { randomState } from './testing/random-states.js';
import { seededRandom } from './testing/random-values.js';
import { pastedPunchState, punchedState } from './testing/recorded-states.js';

const FIXTURE = sampleProject();
const STATE = punchedState(FIXTURE);
const DOCUMENT = writeProjectDocument(STATE);

function readAlone<TValue>(read: Converter<TValue>, value: JsonValue) {
  const reading = startReading();
  return reading.outcome(read(reading, value, '', 'value'));
}

function codesOf(result: {
  readonly ok: boolean;
  readonly failures?: readonly { code: string }[];
}) {
  return result.ok ? [] : (result.failures ?? []).map((problem) => problem.code);
}

/** The document's index of the entity of `list` with identifier `id`. */
function indexOf(list: string, id: string): number {
  const entities = valueAt(DOCUMENT, ['project', list]);
  return isJsonArray(entities)
    ? entities.findIndex((entity) => valueAt(entity, ['id']) === id)
    : -1;
}

const STACK = [...STATE.project.takeStacks.values()][0];
if (STACK === undefined) throw new Error('The punched state has a stack.');
const FOOTSTEP = FIXTURE.assets.footstep.id;
const AMBIENCE = FIXTURE.assets.ambience.id;
const FOOTSTEP_AT = indexOf('assets', FOOTSTEP);
const PUNCH_AT = (STATE.project.assets.get(FOOTSTEP)?.edits.length ?? 0) - 1;

describe('a take stack written and read', () => {
  it('reads back as itself, alone and in its project', () => {
    expect(expectSuccess(readAlone(readTakeStack, writeTakeStack(STACK)))).toEqual(STACK);
    expect(expectSuccess(readProjectDocument(DOCUMENT))).toEqual(STATE);
    const pasted = pastedPunchState(sampleProject());
    expect(expectSuccess(readProjectDocument(writeProjectDocument(pasted)))).toEqual(pasted);
    const random = seededRandom(7);
    for (let seed = 1; seed <= 40; seed += 1) {
      const { project } = randomState(seed);
      for (const stack of randomTakeStacks(random, FIXTURE.ids, project.assets).values()) {
        const text = canonicalJson(writeTakeStack(stack));
        const back = expectSuccess(readAlone(readTakeStack, JSON.parse(text) as JsonValue));
        expect(back).toEqual(stack);
        expect(canonicalJson(writeTakeStack(back))).toBe(text);
      }
    }
  });

  it('refuses a member it does not define, a state it does not know and a blank name', () => {
    const written = writeTakeStack(STACK);
    expect(codesOf(readAlone(readTakeStack, { ...written, comped: true }))).toContain(
      'schema.unknown-member',
    );
    const unknownState = withValue(written, ['takes', 0, 'state'], 'comped');
    expect(codesOf(readAlone(readTakeStack, unknownState))).toContain('schema.unknown-value');
    expect(codesOf(readAlone(readTakeStack, withValue(written, ['name'], ' ')))).toContain(
      'take-stack.name-blank',
    );
    expect(
      codesOf(readAlone(readTakeStack, withValue(written, ['takes', 0, 'name'], ''))),
    ).toContain('take.name-blank');
    expect(
      codesOf(
        readAlone(readTakeStack, withValue(written, ['takes', 0, 'note'], 'x'.repeat(4_097))),
      ),
    ).toContain('schema.text-too-long');
  });
});

describe('a project document with take stacks and punches', () => {
  it('refuses a take of an asset that was not recorded, or one the project lacks', () => {
    const stackAt = indexOf('takeStacks', STACK.id);
    for (const asset of [AMBIENCE, 'ffffffff-ffff']) {
      const edited = withValue(
        DOCUMENT,
        ['project', 'takeStacks', stackAt, 'takes', 1, 'asset'],
        asset,
      );
      expect(codesOf(readProjectDocument(edited))).toContain('project.take-stack-invalid');
    }
  });

  it('refuses a punch naming a stack the project lacks, or a take too short for it', () => {
    const punchAt = ['project', 'assets', FOOTSTEP_AT, 'edits', PUNCH_AT] as const;
    const unknown = withValue(DOCUMENT, [...punchAt, 'edit', 'stack'], 'ffffffff-ffff');
    expect(codesOf(readProjectDocument(unknown))).toContain('project.asset-edits-invalid');
    const stackAt = indexOf('takeStacks', STACK.id);
    const late = withValue(
      DOCUMENT,
      ['project', 'takeStacks', stackAt, 'takes', 1, 'compensation'],
      1,
    );
    expect(codesOf(readProjectDocument(late))).toContain('project.asset-edits-invalid');
    // The rejected first take runs on past the range, so it may be chosen once kept.
    const kept = withValue(late, ['project', 'takeStacks', stackAt, 'takes', 0, 'state'], 'kept');
    const firstId = STACK.takes[0]?.id ?? '';
    expectSuccess(
      readProjectDocument(withValue(kept, ['project', 'takeStacks', stackAt, 'chosen'], firstId)),
    );
  });

  it('refuses a punch in a region’s processing', () => {
    const regions = valueAt(DOCUMENT, ['project', 'regions']);
    const regionAt = isJsonArray(regions)
      ? regions.findIndex((region) => valueAt(region, ['assetId']) === FOOTSTEP)
      : -1;
    const edit = valueAt(DOCUMENT, ['project', 'assets', FOOTSTEP_AT, 'edits', PUNCH_AT, 'edit']);
    const operation = {
      id: 'eeeeeeee-0001',
      basis: 0,
      range: { start: 12_000, end: 24_000 },
      edit,
    };
    const processed = withValue(
      DOCUMENT,
      ['project', 'regions', regionAt, 'operations'],
      [operation],
    );
    expect(regionAt).toBeGreaterThanOrEqual(0);
    expect(codesOf(readProjectDocument(processed))).toContain('project.region-off-asset');
  });
});

describe('how a recorded asset was recorded', () => {
  const recordedId = STACK.takes[0]?.asset ?? '';
  const sources = valueAt(DOCUMENT, ['sources']);
  const sourceAt = isJsonArray(sources)
    ? sources.findIndex((source) => valueAt(source, ['assetId']) === recordedId)
    : -1;
  const recordingAt = ['sources', sourceAt, 'provenance', 'recording'] as const;

  it('must agree with its asset, which must be a recorded one', () => {
    const longer = withValue(DOCUMENT, [...recordingAt, 'length'], 1);
    expect(codesOf(readProjectDocument(longer))).toContain('source.recording-length-mismatch');
    const faster = withValue(DOCUMENT, [...recordingAt, 'sampleRate'], 96_000);
    expect(codesOf(readProjectDocument(faster))).toContain('source.recording-rate-mismatch');
    const assetAt = indexOf('assets', recordedId);
    const imported = withValue(DOCUMENT, ['project', 'assets', assetAt, 'origin'], 'imported');
    expect(codesOf(readProjectDocument(imported))).toContain('source.recording-not-recorded');
  });

  it('loses the device’s label and group below full provenance, and nothing else of it', () => {
    const recording = (state: typeof STATE, level: ProvenanceLevel) =>
      stripAssetProvenance(state, level).sources.get(recordedId as Asset['id'])?.provenance
        ?.recording;
    const full = recording(STATE, ProvenanceLevel.Full);
    expect(full?.device.label).toBe('USB Audio Interface (2-ch)');
    const minimal = recording(STATE, ProvenanceLevel.Minimal);
    expect(minimal?.device).toEqual({ channelCount: 2 });
    expect({ ...minimal, device: full?.device }).toEqual(full);
    expect(recording(STATE, ProvenanceLevel.None)).toBeUndefined();
    const stripped = stripAssetProvenance(STATE, ProvenanceLevel.Minimal);
    expect(stripAssetProvenance(stripped, ProvenanceLevel.Minimal)).toBe(stripped);
    expectSuccess(readProjectDocument(writeProjectDocument(stripped)));
  });

  it('says it ended unexpectedly for every ending but a stop the person made or set', () => {
    const expected = new Set<string>([RecordingEnding.Stopped, RecordingEnding.Timed]);
    for (const ending of Object.values(RecordingEnding)) {
      expect(endedUnexpectedly(ending)).toBe(!expected.has(ending));
    }
  });
});

describe('a recording session’s manifest', () => {
  const random = seededRandom(11);
  const footstep = STATE.project.assets.get(FOOTSTEP);
  if (footstep === undefined) throw new Error('The state has its footstep.');
  const manifest = (purpose: RecoveryChunkManifest['purpose']): RecoveryChunkManifest => ({
    session: FIXTURE.ids.next<'RecordingSessionId'>(),
    project: STATE.project.id,
    sampleFormat: CHUNK_SAMPLE_FORMAT,
    start: randomRecordingStart(random, footstep),
    transportFrame: footstep.length,
    purpose,
  });
  const punch = STACK.punch;
  if (punch === undefined) throw new Error('The stack is a punch’s.');
  const purposes: readonly RecoveryChunkManifest['purpose'][] = [
    { kind: 'take', stack: STACK.id },
    { kind: 'stack' },
    {
      kind: 'punch',
      asset: FOOTSTEP,
      basis: 0,
      range: { start: footstep.length, end: footstep.length },
      punch,
    },
  ];

  it('reads back as itself, for every purpose a recording has', () => {
    for (const purpose of purposes) {
      const written = manifest(purpose);
      const text = canonicalJson(writeRecoveryManifest(written));
      expect(expectSuccess(readRecoveryManifest(JSON.parse(text) as JsonValue))).toEqual(written);
    }
  });

  it('refuses another schema version before reading on, and another sample format', () => {
    const written = writeRecoveryManifest(manifest({ kind: 'stack' }));
    const older = { ...written, schemaVersion: SCHEMA_VERSIONS.projectStorage - 1 };
    expect(expectFailureCode(readRecoveryManifest(older))).toBe('format.schema-incompatible');
    expect(codesOf(readRecoveryManifest({ ...written, sampleFormat: 's16le' }))).toContain(
      'schema.unknown-value',
    );
    expect(codesOf(readRecoveryManifest({ ...written, purpose: { kind: 'take' } }))).toContain(
      'schema.missing-member',
    );
  });
});

describe('a plan that mixes streams', () => {
  it('is written and read as itself, and a mix of no whole streams is refused', () => {
    const plan = {
      streams: [
        {
          sampleRate: footstepRate(),
          layout: { roles: ['mono'] },
          segments: [
            {
              source: { kind: 'mix', streams: [1, 2] },
              start: 0,
              length: 10,
              reversed: false,
              stages: [],
            },
          ],
        },
        silenceStream(),
        silenceStream(),
      ],
    } as const;
    const read = expectSuccess(readAlone(readEditPlan, plan));
    expect(read.streams[0].segments[0]?.source).toEqual({ kind: 'mix', streams: [1, 2] });
    expect(writeEditPlan(read)).toEqual(plan);
    const fractional = withValue(plan, ['streams', 0, 'segments', 0, 'source', 'streams', 0], 1.5);
    expect(codesOf(readAlone(readEditPlan, fractional))).toContain('schema.not-an-integer');
  });
});

function footstepRate(): number {
  return FIXTURE.assets.footstep.sampleRate;
}

function silenceStream() {
  return {
    sampleRate: footstepRate(),
    layout: { roles: ['mono'] },
    segments: [
      {
        source: { kind: 'silence', channels: 1 },
        start: 0,
        length: 10,
        reversed: false,
        stages: [],
      },
    ],
  };
}
