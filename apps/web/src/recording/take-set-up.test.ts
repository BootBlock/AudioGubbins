import { describe, expect, it } from 'vitest';

import {
  StandardLayouts,
  derivedSampleCount,
  sampleRate,
  unsafeBrandId,
  type Asset,
  type TakeStack,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { CaptureProfileKind, type RecordingStart } from '@audiogubbins/project-format';

import { takeSetUp } from './take-set-up.js';
import type { PunchPlace, TakeTarget } from './take-target.js';

const RATE = expectSuccess(sampleRate(48_000));

const START: RecordingStart = {
  recordedAt: 1_790_000_000_000,
  device: { channelCount: 2 },
  profile: { kind: CaptureProfileKind.RawStudio, name: 'Raw/Studio' },
  requested: {},
  granted: {},
  sampleRate: RATE,
  layout: StandardLayouts.stereo,
};

/** The loop punched into: six seconds of stereo. */
const ASSET: Asset = {
  id: unsafeBrandId<'AssetId'>('a55e7000-0000-4000-8000-000000000001'),
  displayName: 'Vocal',
  origin: 'imported',
  sampleRate: RATE,
  channelLayout: StandardLayouts.stereo,
  length: derivedSampleCount(6 * 48_000),
  storageKey: 'vocal',
  edits: [],
};

/** A punch over the loop's third second, with two seconds of pre-roll and one after. */
const PLACE: PunchPlace = {
  asset: ASSET,
  start: derivedSampleCount(96_000),
  length: derivedSampleCount(48_000),
  preRoll: derivedSampleCount(96_000),
  postRoll: derivedSampleCount(48_000),
};

const PUNCH: TakeTarget = {
  kind: 'punch',
  takeName: 'Take 1',
  stackName: 'Punch over “Vocal”',
  place: PLACE,
  basis: 0,
};

describe('what a take begins with', () => {
  it('places a take by the latency alone where it holds the pre-roll exactly', () => {
    const { setUp, take } = takeSetUp(PUNCH, START, { transportFrame: 0, latency: 1_200 });
    expect(take).toEqual({ name: 'Take 1', stackName: 'Punch over “Vocal”', compensation: 1_200 });
    expect(setUp.transportFrame).toBe(0);
    expect(setUp.purpose).toMatchObject({
      kind: 'punch',
      range: { start: 96_000, end: 144_000 },
      punch: { length: 48_000, preRoll: 96_000, postRoll: 48_000 },
    });
  });

  it('places a take that begins with buffered frames later by those frames, at the transport they were captured at', () => {
    // The retrospective buffer gave 24 000 frames from before Record: the
    // take's first frame was captured 24 000 frames before the transport's
    // start, so the range begins that much further into it.
    const { setUp, take } = takeSetUp(PUNCH, START, { transportFrame: -24_000, latency: 1_200 });
    expect(take.compensation).toBe(25_200);
    expect(setUp.transportFrame).toBe(0);
  });

  it('places a take that began late by the pre-roll it lacks', () => {
    const { take } = takeSetUp(PUNCH, START, { transportFrame: 4_800, latency: 0 });
    expect(take.compensation).toBe(-4_800);
  });

  it('gives a take of a punch stack the stack, and no stack name, placed against its pre-roll', () => {
    const stack: TakeStack = {
      id: unsafeBrandId<'TakeStackId'>('57ac0000-0000-4000-8000-000000000001'),
      name: 'Punch over “Vocal”',
      takes: [],
    };
    const { setUp, take } = takeSetUp(
      { kind: 'take', stack, takeName: 'Take 2', punch: PLACE },
      START,
      { transportFrame: 1_000, latency: 500 },
    );
    expect(setUp.purpose).toEqual({ kind: 'take', stack: stack.id });
    expect(take).toEqual({ name: 'Take 2', compensation: -500 });
  });

  it('places a take of no punch by its latency, at the transport frame it began on', () => {
    const { setUp, take } = takeSetUp(
      { kind: 'new-stack', takeName: 'Take 1', stackName: 'Recording 1' },
      START,
      { transportFrame: 12_345, latency: 700 },
    );
    expect(setUp).toMatchObject({ transportFrame: 12_345, purpose: { kind: 'stack' } });
    expect(take.compensation).toBe(700);
  });
});
