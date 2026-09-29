import type { SampleCount } from '@audiogubbins/domain';
import { describe, expect, it } from 'vitest';

import {
  boundaryAt,
  centredOn,
  clampedView,
  framing,
  nearestBoundary,
  pixelOf,
  placedAt,
  resized,
  roundHalfAway,
  sampleAt,
  samplesWithin,
  scrolledBy,
  viewportAtStart,
  viewportFitting,
  visibleRange,
  zoomedAround,
  type ViewportState,
} from './viewport.js';
import { pixelsPerSample, samplesPerPixel, zoomedIn, zoomedOut, type Zoom } from './zoom.js';

const at = (value: number): SampleCount => value as SampleCount;

/** The largest position the domain holds, far beyond any file, where a float would drift. */
const FAR = at(2 ** 53 - 1);

/** A seeded sequence of numbers in [0, 1), so a long walk is the same walk every run. */
function sequence(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
}

function view(start: number, zoom: Zoom, width = 1000, offset = 0): ViewportState {
  return { start: at(start), offset, zoom, width };
}

describe('converting between pixels and boundaries', () => {
  it('finds the nearest boundary to a pixel at a zoom of samples per pixel', () => {
    const shown = view(1000, samplesPerPixel(100));
    expect(nearestBoundary(shown, 0)).toBe(1000);
    expect(nearestBoundary(shown, 1)).toBe(1100);
    expect(nearestBoundary(shown, 0.504)).toBe(1050);
    expect(nearestBoundary(shown, 0.506)).toBe(1051);
    expect(pixelOf(shown, 1100)).toBe(1);
  });

  it('finds the nearest boundary to a pixel where a sample is wider than a pixel', () => {
    const shown = view(1000, pixelsPerSample(10), 1000, 3);
    // The left edge is three pixels into sample 1000, so pixel 7 is where 1001 starts.
    expect(nearestBoundary(shown, 7)).toBe(1001);
    expect(nearestBoundary(shown, 11.9)).toBe(1001);
    expect(nearestBoundary(shown, 12.1)).toBe(1002);
    expect(pixelOf(shown, 1001)).toBe(7);
    expect(sampleAt(shown, 6.9, at(5000))).toBe(1000);
    expect(sampleAt(shown, 7, at(5000))).toBe(1001);
  });

  it('gives the same boundary back for the pixel of every boundary, at every zoom, near the end of the range', () => {
    for (const zoom of [
      pixelsPerSample(256),
      pixelsPerSample(3),
      samplesPerPixel(1),
      samplesPerPixel(7),
      samplesPerPixel(2 ** 36),
    ]) {
      const shown = view(FAR - 2 ** 40, zoom, 1000, zoom.kind === 'pixels-per-sample' ? 1 : 0);
      for (let x = 0; x < 1000; x += 37) {
        const position = nearestBoundary(shown, x);
        expect(nearestBoundary(shown, pixelOf(shown, position))).toBe(position);
      }
    }
  });

  it('clamps a boundary to the timeline, and finds no sample in an empty one', () => {
    const shown = view(0, samplesPerPixel(10));
    expect(boundaryAt(shown, -50, at(1000))).toBe(0);
    expect(boundaryAt(shown, 5000, at(1000))).toBe(1000);
    expect(sampleAt(shown, 5000, at(1000))).toBe(999);
    expect(sampleAt(shown, 0, at(0))).toBeUndefined();
  });

  it('keeps every boundary of a hundred-year timeline exact at a pixel', () => {
    // At 2^36 samples a pixel and a boundary past 2^52, a product computed as
    // one float would lose samples; the viewport's is exact.
    const shown = view(2 ** 52, samplesPerPixel(2 ** 36), 1000);
    expect(nearestBoundary(shown, 999)).toBe(2 ** 52 + 999 * 2 ** 36);
    expect(nearestBoundary(shown, 0.5)).toBe(2 ** 52 + 2 ** 35);
  });
});

describe('the visible range', () => {
  it('covers every boundary a pixel of the view shows any part of', () => {
    expect(visibleRange(view(100, samplesPerPixel(10), 50.5), at(10_000))).toEqual({
      start: 100,
      end: 610,
    });
    expect(visibleRange(view(100, pixelsPerSample(4), 10, 2), at(10_000))).toEqual({
      start: 100,
      end: 103,
    });
    expect(visibleRange(view(100, samplesPerPixel(10), 1000), at(500))).toEqual({
      start: 100,
      end: 500,
    });
  });
});

describe('scrolling', () => {
  it('returns to exactly the same edge after a long walk of scrolls and their reverses', () => {
    const random = sequence(20_260_929);
    for (const zoom of [samplesPerPixel(1), samplesPerPixel(733), pixelsPerSample(7)]) {
      const length = at(2 ** 50);
      const origin = view(2 ** 49, zoom, 1280.5, zoom.kind === 'pixels-per-sample' ? 5 : 0);
      let shown = origin;
      const steps: number[] = [];
      for (let step = 0; step < 100_000; step += 1) {
        const dx = (random() - 0.5) * 400;
        steps.push(dx);
        shown = scrolledBy(shown, dx, length);
      }
      for (const dx of steps.reverse()) shown = scrolledBy(shown, -dx, length);
      expect(shown).toEqual(origin);
    }
  });

  it('carries whole pixels into the next sample where a sample is wider than a pixel', () => {
    const shown = scrolledBy(view(10, pixelsPerSample(4), 100, 3), 6, at(1000));
    expect(shown).toMatchObject({ start: 12, offset: 1 });
    expect(scrolledBy(shown, -6, at(1000))).toMatchObject({ start: 10, offset: 3 });
  });

  it('stops at the start and where the end reaches the right edge', () => {
    const length = at(100_000);
    expect(scrolledBy(view(50, samplesPerPixel(10)), -1000, length)).toMatchObject({ start: 0 });
    expect(scrolledBy(view(50, samplesPerPixel(10)), 1e9, length)).toMatchObject({ start: 90_000 });
    const wide = scrolledBy(view(0, pixelsPerSample(4), 1000), 1e9, at(1000));
    expect(pixelOf(wide, 1000)).toBe(1000);
    // A timeline shorter than the view stays at its start.
    expect(clampedView(view(10, samplesPerPixel(10)), at(50))).toMatchObject({
      start: 0,
      offset: 0,
    });
  });

  it('rounds half away from zero, so a distance and its reverse round alike', () => {
    expect(roundHalfAway(2.5)).toBe(3);
    expect(roundHalfAway(-2.5)).toBe(-3);
    expect(roundHalfAway(-0.2)).toBe(-0);
  });
});

describe('zooming', () => {
  it('keeps the boundary under the anchor through a long walk of zooms in and out', () => {
    const random = sequence(7);
    const length = at(2 ** 44);
    let shown = view(2 ** 43, samplesPerPixel(48));
    for (let step = 0; step < 2000; step += 1) {
      const anchorX = random() * shown.width;
      const before = nearestBoundary(shown, anchorX);
      const zoom = random() < 0.5 ? zoomedIn(shown.zoom) : zoomedOut(shown.zoom);
      shown = zoomedAround(shown, zoom, anchorX, length);
      expect(nearestBoundary(shown, anchorX)).toBe(before);
    }
  });

  it('returns to the same left edge after zooming in and back out at a zoom of samples per pixel', () => {
    const length = at(2 ** 40);
    const origin = view(123_456_789, samplesPerPixel(96), 1000);
    const there = zoomedAround(origin, samplesPerPixel(3), 417.3, length);
    expect(zoomedAround(there, samplesPerPixel(96), 417.3, length)).toEqual(origin);
  });

  it('zooms to single samples and places one exactly under the pointer', () => {
    const length = at(1_000_000);
    const shown = zoomedAround(view(0, samplesPerPixel(1000)), pixelsPerSample(256), 500, length);
    expect(nearestBoundary(shown, 500)).toBe(500_000);
    expect(sampleAt(shown, 500, length)).toBe(500_000);
    expect(sampleAt(shown, 500 + 255.9, length)).toBe(500_000);
    expect(sampleAt(shown, 500 + 256, length)).toBe(500_001);
  });
});

describe('placing and framing', () => {
  it('places a boundary at a pixel, and centres on one', () => {
    const length = at(1_000_000);
    const placed = placedAt(view(0, pixelsPerSample(8)), at(5000), 100, length);
    expect(pixelOf(placed, 5000)).toBe(100);
    expect(nearestBoundary(centredOn(view(0, samplesPerPixel(10)), at(500_000), length), 500)).toBe(
      500_000,
    );
  });

  it('frames a range with its margins at the finest zoom that fits it', () => {
    const length = at(1_000_000);
    const framed = framing(
      view(0, samplesPerPixel(1000), 1000),
      { start: at(10_000), end: at(19_600) },
      10,
      length,
    );
    expect(framed.zoom).toEqual(samplesPerPixel(10));
    expect(pixelOf(framed, 10_000)).toBeGreaterThanOrEqual(10);
    expect(pixelOf(framed, 19_600)).toBeLessThanOrEqual(990);
  });

  it('fits a whole timeline, keeps its left edge through a resize, and counts samples in a distance', () => {
    const fitted = viewportFitting(at(96_000), 1000);
    expect(fitted).toEqual(viewportAtStart(samplesPerPixel(96), 1000));
    expect(resized(view(500, samplesPerPixel(10)), 800, at(1_000_000))).toMatchObject({
      start: 500,
      width: 800,
    });
    expect(samplesWithin(view(0, samplesPerPixel(10)), 8)).toBe(80);
    expect(samplesWithin(view(0, pixelsPerSample(16)), 8)).toBe(1);
  });
});
