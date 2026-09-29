import { describe, expect, it } from 'vitest';

import { sampleRate } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { StandardFrameRates } from '@audiogubbins/timeline';

import {
  bindingAtStart,
  calibratedTo,
  frameBoundariesWithin,
  frameBoundary,
  nudgedByFrames,
  pictureFrameAt,
  pictureTimeAt,
  pictureTimecodeAt,
  seekTimeFor,
} from './clock-binding.js';
import { pictureCorrection, pictureDrift } from './picture-sync.js';

const RATE = expectSuccess(sampleRate(48_000));
const PAL = bindingAtStart(RATE, StandardFrameRates.pal);
const FILM = bindingAtStart(RATE, StandardFrameRates.filmPulledDown);

describe('binding picture to the media clock', () => {
  it('finds the frame at a position, and the position a frame starts at', () => {
    expect(pictureFrameAt(PAL, 1919)).toBe(0);
    expect(pictureFrameAt(PAL, 1920)).toBe(1);
    expect(frameBoundary(PAL, 25)).toBe(48_000);
    expect(pictureTimeAt(PAL, 24_000)).toBe(0.5);
  });

  it('keeps every frame on the same boundary four hours in at 23.976, where a float rate would drift', () => {
    const frame = 4 * 3600 * 24;
    for (let each = frame - 3; each <= frame + 3; each += 1) {
      const boundary = frameBoundary(FILM, each);
      expect(pictureFrameAt(FILM, boundary)).toBe(each);
      expect(pictureFrameAt(FILM, boundary - 1)).toBe(each - 1);
    }
  });

  it('moves the picture by its offset, before the timeline start too', () => {
    const late = { ...PAL, offset: 4800 };
    expect(pictureFrameAt(late, 4799)).toBe(-1);
    expect(pictureFrameAt(late, 4800)).toBe(0);
    const early = { ...PAL, offset: -3840 };
    expect(pictureFrameAt(early, 0)).toBe(2);
  });

  it('calibrates a frame to start at a position, and nudges the picture by whole frames', () => {
    const aligned = calibratedTo(PAL, 50, 100_000);
    expect(frameBoundary(aligned, 50)).toBe(100_000);
    const nudged = nudgedByFrames(aligned, 1);
    expect(frameBoundary(nudged, 50)).toBe(100_000 + 1920);
    expect(nudgedByFrames(nudged, -1)).toEqual(aligned);
  });

  it('labels the picture with its timecode, from the label its first frame carries', () => {
    const labelled = { ...PAL, firstFrameLabel: 25 * 3600 };
    expect(pictureTimecodeAt(labelled, 48_000 * 61)).toBe('01:01:01:00');
    const drop = bindingAtStart(RATE, StandardFrameRates.ntscDropFrame);
    expect(pictureTimecodeAt(drop, frameBoundary(drop, 1800))).toBe('00:01:00;02');
  });

  it('seeks to the middle of a frame, and lists a bounded run of frame starts', () => {
    expect(seekTimeFor(PAL, 10)).toBeCloseTo(0.42, 10);
    expect(frameBoundariesWithin(PAL, 1000, 6000, 10)).toEqual([1920, 3840, 5760]);
    expect(frameBoundariesWithin(PAL, 0, 48_000 * 3600, 5)).toHaveLength(5);
  });
});

describe('keeping the picture with the audio', () => {
  const shown = (mediaTime: number) => ({ mediaTime, duration: 60 });

  it('leaves playing picture alone within one frame of the audio, and seeks it beyond', () => {
    const position = 48_000 * 10;
    expect(pictureCorrection(PAL, position, shown(10.039), 'playing')).toEqual({ kind: 'in-sync' });
    expect(pictureCorrection(PAL, position, shown(9.961), 'playing')).toEqual({ kind: 'in-sync' });
    expect(pictureCorrection(PAL, position, shown(10.041), 'playing')).toEqual({
      kind: 'seek',
      to: 10,
    });
    expect(pictureDrift(PAL, position, shown(9.9))).toBeCloseTo(0.1, 10);
  });

  it('shows exactly the frame a parked position falls in', () => {
    const position = frameBoundary(PAL, 250) + 10;
    expect(pictureCorrection(PAL, position, shown(10.001), 'parked')).toEqual({ kind: 'in-sync' });
    expect(pictureCorrection(PAL, position, shown(10.041), 'parked')).toEqual({
      kind: 'seek',
      to: seekTimeFor(PAL, 250),
    });
  });

  it('shows no picture before its first frame or after its last', () => {
    const late = { ...PAL, offset: 48_000 };
    expect(pictureCorrection(late, 100, shown(0), 'parked')).toEqual({ kind: 'no-picture' });
    expect(pictureCorrection(PAL, 48_000 * 61, shown(0), 'playing')).toEqual({
      kind: 'no-picture',
    });
  });
});
