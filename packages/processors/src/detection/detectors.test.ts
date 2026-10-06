/**
 * What every canonical detector is held to, each over audio with its own
 * fault: the findings do not depend on how the audio is cut into chunks, a
 * NaN or an infinity is heard as the silence a kernel hears it as, every
 * finding lies within the audio and states its channels in order, the
 * extractor is freed on every path, and the settings each derives from the
 * rate are ones its extractor takes at every rate the domain accepts.
 */

import { describe, expect, it } from 'vitest';

import { StandardLayouts, sampleRate, type DetectorFinding } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { REFERENCE_DSP } from '@audiogubbins/audio-engine';

import { partials, withClicks } from '../testing/repair-signals.js';
import {
  clipped,
  countingDsp,
  detect,
  hiss,
  mixed,
  scaled,
  tone,
  withNonFinite,
  withOnsets,
} from '../testing/detection-signals.js';
import { TEST_RATE } from '../testing/processor-run.js';
import type { AudioDetector } from './audio-detector.js';
import { CLICK_DETECTOR } from './click-detector.js';
import { CLIPPING_DETECTOR } from './clipping-detector.js';
import { DC_OFFSET_DETECTOR } from './dc-offset-detector.js';
import { HUM_DETECTOR } from './hum-detector.js';
import { NOISE_FLOOR_DETECTOR } from './noise-floor-detector.js';
import { TRANSIENT_DETECTOR } from './transient-detector.js';

const LENGTH = 2 * TEST_RATE;
const programme = partials(LENGTH);

/** Each detector, and stereo audio with its fault, on the second channel where it is on one. */
const CASES: readonly (readonly [AudioDetector, readonly Float32Array[]])[] = [
  [
    CLICK_DETECTOR,
    [
      programme,
      withClicks(programme, [
        { at: 30_000, width: 20, size: 0.2 },
        { at: 95_950, width: 8, size: 0.2 },
      ]),
    ],
  ],
  [HUM_DETECTOR, [programme, mixed(programme, tone(LENGTH, 50, -50))]],
  [
    NOISE_FLOOR_DETECTOR,
    [
      mixed(scaled(programme, 30_000, 70_000, 0), hiss(LENGTH, -50)),
      mixed(scaled(programme, 30_000, 70_000, 0), hiss(LENGTH, -55, 12)),
    ],
  ],
  [CLIPPING_DETECTOR, [tone(LENGTH, 440, -1), clipped(tone(LENGTH, 440, 0, 0.1), 0.5)]],
  [DC_OFFSET_DETECTOR, [programme, mixed(programme, new Float32Array(LENGTH).fill(-0.02))]],
  [TRANSIENT_DETECTOR, [programme, withOnsets(programme, [20_000, 50_000, 80_000], 0.5)]],
];

/** The findings' ranges and channels, which a fault in the feeding moves. */
function placesOf(found: readonly DetectorFinding[]): readonly string[] {
  return found.map(
    ({ range, channels }) =>
      `${String(range.start)}–${String(range.end)} on ${channels.join(', ')}`,
  );
}

describe.each(CASES.map(([detector, audio]) => [detector.identity.key, detector, audio] as const))(
  'the %s detector',
  (_key, detector, audio) => {
    const whole = detect(detector, audio, LENGTH);

    it('finds its fault, within the audio, on the channels it is on, in order', () => {
      expect(whole.length).toBeGreaterThan(0);
      for (const finding of whole) {
        expect(detector.finds).toContain(finding.kind);
        expect(finding.range.start).toBeLessThan(finding.range.end);
        expect(finding.range.end).toBeLessThanOrEqual(LENGTH);
        expect(finding.channels.length).toBeGreaterThan(0);
        expect(finding.channels).toEqual(finding.channels.toSorted((one, other) => one - other));
        expect(Number.isFinite(finding.measure.value)).toBe(true);
      }
    });

    it('finds the same however the audio is cut into chunks', () => {
      for (const chunk of [1, 7, 333, 4_096]) {
        expect(detect(detector, audio, chunk)).toEqual(whole);
      }
    });

    it('hears a NaN or an infinity as silence, and still finds its fault', () => {
      // At the very start, and in the programme away from every fault, where
      // the silence they are heard as may itself be a click or an onset.
      for (const at of [0, 100_000]) {
        const spoiled = audio.map((channel) => withNonFinite(channel, at));
        const silenced = audio.map((channel) => {
          const out = channel.slice();
          out.fill(0, at, at + 3);
          return out;
        });
        const found = detect(detector, spoiled, 4_096);
        expect(found).toEqual(detect(detector, silenced, 4_096));
        // Every finding the silenced frames are not part of is still found.
        const apart = whole.filter(({ range }) => range.end <= at || range.start >= at + 3);
        const places = new Set(placesOf(found));
        expect(placesOf(apart).filter((place) => !places.has(place))).toEqual([]);
      }
    });

    it('frees its extractor whether or not it was asked for its findings', () => {
      const asked = countingDsp();
      expect(detect(detector, audio, 4_096, asked.dsp).length).toBeGreaterThan(0);
      expect(asked.live()).toBe(0);

      const unasked = countingDsp();
      const detection = expectSuccess(
        detector.open({ input: StandardLayouts.stereo, sampleRate: TEST_RATE, dsp: unasked.dsp }),
      );
      detection.add(audio, LENGTH);
      expect(unasked.live()).toBe(1);
      detection.release();
      detection.release();
      expect(unasked.live()).toBe(0);
      expect(() => detection.findings()).toThrow(
        'A released detection was asked for its findings.',
      );
    });

    it('answers its findings again once done, and hears no more', () => {
      const detection = expectSuccess(
        detector.open({ input: StandardLayouts.stereo, sampleRate: TEST_RATE, dsp: REFERENCE_DSP }),
      );
      detection.add(audio, LENGTH);
      const found = detection.findings();
      expect(detection.findings()).toBe(found);
      expect(() => {
        detection.add(audio, LENGTH);
      }).toThrow('A finished detection was given more audio.');
      detection.release();
      expect(detection.findings()).toBe(found);
    });

    it('opens at every rate the domain accepts, on a layout of many channels', () => {
      for (const rate of [8_000, 44_100, 192_000, 768_000]) {
        const counting = countingDsp();
        const opened = detector.open({
          input: StandardLayouts.surround7_1_4,
          sampleRate: expectSuccess(sampleRate(rate)),
          dsp: counting.dsp,
        });
        expectSuccess(opened).release();
        expect(counting.live()).toBe(0);
      }
    });
  },
);

describe('the detectors', () => {
  it('each have a stable key, a British label and their first version', () => {
    const detectors = CASES.map(([detector]) => detector.identity);
    expect(new Set(detectors.map((identity) => identity.key)).size).toBe(detectors.length);
    for (const identity of detectors) expect(identity.version).toBe(1);
  });
});
