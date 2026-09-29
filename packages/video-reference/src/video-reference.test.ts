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
  const THIRTY = bindingAtStart(RATE, StandardFrameRates.thirty);
  const NTSC = bindingAtStart(RATE, StandardFrameRates.ntscNonDrop);
  /** A frame the element presents, stamped with its timestamp as the frame callback gives it. */
  const stamped = (mediaTime: number) => ({ mediaTime, stamped: true, duration: 60 });
  /** The element's current time, where the browser has no frame callback. */
  const current = (mediaTime: number) => ({ mediaTime, stamped: false, duration: 60 });
  /** Frame `frame`'s timestamp as a container keeps it, in whole milliseconds. */
  const stampOf = (frame: number, fps: number, keep: (ms: number) => number) =>
    keep((frame / fps) * 1000) / 1000;

  it('knows each frame by its millisecond timestamp, rounded either way, at 30 and 29.97', () => {
    for (const [binding, fps] of [
      [THIRTY, 30],
      [NTSC, 30_000 / 1001],
    ] as const) {
      for (const keep of [Math.floor, Math.round]) {
        for (let frame = 1; frame < 120; frame += 1) {
          const shown = stamped(stampOf(frame, fps, keep));
          const inside = frameBoundary(binding, frame) + 1;
          expect(pictureCorrection(binding, inside, shown, 'parked')).toEqual({ kind: 'in-sync' });
          expect(pictureCorrection(binding, inside - 2, shown, 'parked')).toEqual({
            kind: 'seek',
            to: seekTimeFor(binding, frame - 1),
          });
        }
      }
    }
  });

  it('moves a parked picture back a frame, from a frame stamped before its start', () => {
    // Frame 4 at 30 fps starts at 0.1333 s, and WebM keeps it as 0.133; 5,280
    // is 0.11 s, in frame 3.
    expect(pictureCorrection(THIRTY, 5280, stamped(0.133), 'parked')).toEqual({
      kind: 'seek',
      to: seekTimeFor(THIRTY, 3),
    });
    expect(pictureCorrection(THIRTY, frameBoundary(THIRTY, 4), stamped(0.133), 'parked')).toEqual({
      kind: 'in-sync',
    });
  });

  it('leaves playing picture alone within one frame of the frame that should show', () => {
    // 7,997 is 0.1666 s, late in frame 4, which shows, stamped 0.133.
    expect(pictureCorrection(THIRTY, 7997, stamped(0.133), 'playing')).toEqual({
      kind: 'in-sync',
    });
    const position = frameBoundary(PAL, 250) + 1900;
    expect(pictureCorrection(PAL, position, stamped(9.96), 'playing')).toEqual({ kind: 'in-sync' });
    expect(pictureCorrection(PAL, position, stamped(10.04), 'playing')).toEqual({
      kind: 'in-sync',
    });
    expect(pictureDrift(PAL, position, stamped(9.92))).toBe(2);
    expect(pictureCorrection(PAL, position, stamped(9.92), 'playing')).toEqual({
      kind: 'seek',
      to: position / 48_000,
    });
    expect(pictureCorrection(PAL, position, stamped(10.08), 'playing')).toMatchObject({
      kind: 'seek',
    });
  });

  it('shows exactly the frame a parked position falls in, by the element time without a frame callback', () => {
    const position = frameBoundary(PAL, 250) + 10;
    expect(pictureCorrection(PAL, position, current(seekTimeFor(PAL, 250)), 'parked')).toEqual({
      kind: 'in-sync',
    });
    expect(pictureCorrection(PAL, position, current(10.041), 'parked')).toEqual({
      kind: 'seek',
      to: seekTimeFor(PAL, 250),
    });
    expect(pictureCorrection(PAL, position, current(10.039), 'playing')).toEqual({
      kind: 'in-sync',
    });
  });

  it('shows no picture before its first frame or after its last', () => {
    const late = { ...PAL, offset: 48_000 };
    expect(pictureCorrection(late, 100, stamped(0), 'parked')).toEqual({ kind: 'no-picture' });
    expect(pictureCorrection(PAL, 48_000 * 61, stamped(0), 'playing')).toEqual({
      kind: 'no-picture',
    });
  });
});
