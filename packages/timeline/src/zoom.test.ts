import { describe, expect, it } from 'vitest';

import {
  MAXIMUM_PIXELS_PER_SAMPLE,
  MAXIMUM_SAMPLES_PER_PIXEL,
  ONE_SAMPLE_PER_PIXEL,
  pixelsPerSample,
  samplesInPixel,
  samplesPerPixel,
  zoomFitting,
  zoomScaled,
  zoomShowing,
  zoomedIn,
  zoomedOut,
  zoomsEqual,
  type Zoom,
} from './zoom.js';

describe('a zoom', () => {
  it('is a whole number either way, so one pixel per sample has one form', () => {
    expect(pixelsPerSample(1)).toEqual(ONE_SAMPLE_PER_PIXEL);
    expect(samplesPerPixel(2.4)).toEqual({ kind: 'samples-per-pixel', samples: 2 });
    expect(pixelsPerSample(3.6)).toEqual({ kind: 'pixels-per-sample', pixels: 4 });
  });

  it('is clamped to the widest sample and the most samples a pixel may show', () => {
    expect(pixelsPerSample(10_000)).toEqual({
      kind: 'pixels-per-sample',
      pixels: MAXIMUM_PIXELS_PER_SAMPLE,
    });
    expect(samplesPerPixel(2 ** 60)).toEqual({
      kind: 'samples-per-pixel',
      samples: MAXIMUM_SAMPLES_PER_PIXEL,
    });
    expect(samplesPerPixel(Number.NaN)).toEqual(ONE_SAMPLE_PER_PIXEL);
  });

  it('shows the nearest whole zoom to a real number of samples a pixel', () => {
    expect(zoomShowing(100.4)).toEqual(samplesPerPixel(100));
    expect(zoomShowing(0.26)).toEqual(pixelsPerSample(4));
    expect(samplesInPixel(pixelsPerSample(8))).toBe(1 / 8);
  });
});

describe('stepping the zoom', () => {
  it('steps in and back out to the same rung, all the way from the finest to the coarsest', () => {
    let zoom: Zoom = pixelsPerSample(MAXIMUM_PIXELS_PER_SAMPLE);
    const rungs: Zoom[] = [zoom];
    for (;;) {
      const next = zoomedOut(zoom);
      if (zoomsEqual(next, zoom)) break;
      expect(samplesInPixel(next)).toBeGreaterThan(samplesInPixel(zoom));
      // No step more than doubles what a pixel shows.
      expect(samplesInPixel(next) / samplesInPixel(zoom)).toBeLessThanOrEqual(2);
      rungs.push(next);
      zoom = next;
    }
    expect(zoom).toEqual(samplesPerPixel(MAXIMUM_SAMPLES_PER_PIXEL));
    for (let index = rungs.length - 1; index > 0; index -= 1) {
      expect(zoomedIn(rungs[index]!)).toEqual(rungs[index - 1]);
    }
    expect(zoomedIn(rungs[0]!)).toEqual(rungs[0]);
  });

  it('steps from a zoom between rungs to the next rung in the direction asked', () => {
    expect(zoomedIn(samplesPerPixel(5))).toEqual(samplesPerPixel(4));
    expect(zoomedOut(samplesPerPixel(5))).toEqual(samplesPerPixel(6));
    expect(zoomedIn(ONE_SAMPLE_PER_PIXEL)).toEqual(pixelsPerSample(2));
  });

  it('moves a scaled zoom at least one whole step, so a slow pinch never stands still', () => {
    expect(zoomScaled(samplesPerPixel(10), 1.01)).toEqual(samplesPerPixel(11));
    expect(zoomScaled(samplesPerPixel(10), 0.99)).toEqual(samplesPerPixel(9));
    expect(zoomScaled(ONE_SAMPLE_PER_PIXEL, 0.99)).toEqual(pixelsPerSample(2));
    expect(zoomScaled(pixelsPerSample(4), 1.01)).toEqual(pixelsPerSample(3));
    expect(zoomScaled(samplesPerPixel(1000), 2)).toEqual(samplesPerPixel(2000));
    expect(zoomScaled(samplesPerPixel(10), 1)).toEqual(samplesPerPixel(10));
    expect(zoomScaled(samplesPerPixel(10), Number.NaN)).toEqual(samplesPerPixel(10));
  });
});

describe('fitting samples in a width', () => {
  it('takes the finest zoom that shows every sample', () => {
    expect(zoomFitting(48_000, 1000)).toEqual(samplesPerPixel(48));
    expect(zoomFitting(48_001, 1000)).toEqual(samplesPerPixel(49));
    expect(zoomFitting(100, 1000)).toEqual(pixelsPerSample(10));
    expect(zoomFitting(1, 1000)).toEqual(pixelsPerSample(MAXIMUM_PIXELS_PER_SAMPLE));
    expect(zoomFitting(0, 1000)).toEqual(ONE_SAMPLE_PER_PIXEL);
  });
});
