/**
 * How many samples a CSS pixel shows, as a whole number one way or the other.
 *
 * A zoom is either whole samples per pixel, one or more, or whole pixels per
 * sample, two or more, so every conversion between a pixel and a sample
 * boundary is integer arithmetic and never a pixel float carried into a
 * position (ADR-0041). One pixel per sample is the samples-per-pixel form, so
 * each zoom has exactly one representation.
 */

/** Whole samples in each CSS pixel. */
export interface SamplesPerPixel {
  readonly kind: 'samples-per-pixel';
  readonly samples: number;
}

/** Whole CSS pixels for each sample, at least two. */
export interface PixelsPerSample {
  readonly kind: 'pixels-per-sample';
  readonly pixels: number;
}

/** How many samples a CSS pixel shows. */
export type Zoom = SamplesPerPixel | PixelsPerSample;

/**
 * The widest a sample is drawn: 256 CSS pixels, enough to place a pointer on
 * one sample of a transient with a finger.
 */
export const MAXIMUM_PIXELS_PER_SAMPLE = 256;

/**
 * The most samples a pixel shows: 2^36, over sixteen days at 48 kHz in one
 * pixel. Bounded so that any pixel of any screen times it stays below 2^51,
 * where a product of a pixel and a zoom is exact (ADR-0041).
 */
export const MAXIMUM_SAMPLES_PER_PIXEL = 2 ** 36;

/** One sample per pixel. */
export const ONE_SAMPLE_PER_PIXEL: Zoom = { kind: 'samples-per-pixel', samples: 1 };

/** A zoom of `samples` samples per pixel, clamped to the range and rounded to a whole number. */
export function samplesPerPixel(samples: number): Zoom {
  const whole = Math.round(samples);
  return {
    kind: 'samples-per-pixel',
    samples: Math.min(MAXIMUM_SAMPLES_PER_PIXEL, Math.max(1, Number.isFinite(whole) ? whole : 1)),
  };
}

/** A zoom of `pixels` pixels per sample, clamped to the range; one pixel is one sample per pixel. */
export function pixelsPerSample(pixels: number): Zoom {
  const whole = Math.round(pixels);
  if (!Number.isFinite(whole) || whole <= 1) return ONE_SAMPLE_PER_PIXEL;
  return { kind: 'pixels-per-sample', pixels: Math.min(MAXIMUM_PIXELS_PER_SAMPLE, whole) };
}

/** The samples one pixel shows, as a real number: below one when a sample is wider than a pixel. */
export function samplesInPixel(zoom: Zoom): number {
  return zoom.kind === 'samples-per-pixel' ? zoom.samples : 1 / zoom.pixels;
}

/** Whether two zooms are the same. */
export function zoomsEqual(left: Zoom, right: Zoom): boolean {
  return samplesInPixel(left) === samplesInPixel(right);
}

/**
 * The zoom that shows about `samples` samples in a pixel, whole either way: the
 * nearest whole number of samples from one up, and the nearest whole number of
 * pixels below that.
 */
export function zoomShowing(samples: number): Zoom {
  if (!(samples > 0)) return pixelsPerSample(MAXIMUM_PIXELS_PER_SAMPLE);
  return samples >= 1 ? samplesPerPixel(samples) : pixelsPerSample(1 / samples);
}

/**
 * The rungs Zoom In and Zoom Out step between, from the finest to the coarsest:
 * every power of two from 256 pixels a sample to one sample a pixel, then each
 * power of two and half as much again, so a step is never more than twice nor
 * less than a third larger than the last.
 */
const RUNGS: readonly number[] = (() => {
  const rungs: number[] = [];
  for (let pixels = MAXIMUM_PIXELS_PER_SAMPLE; pixels >= 2; pixels /= 2) rungs.push(1 / pixels);
  for (let power = 1; power <= MAXIMUM_SAMPLES_PER_PIXEL; power *= 2) {
    rungs.push(power);
    const between = power * 1.5;
    if (Number.isInteger(between) && between < MAXIMUM_SAMPLES_PER_PIXEL) rungs.push(between);
  }
  return rungs;
})();

function zoomOfRung(rung: number): Zoom {
  return rung >= 1 ? samplesPerPixel(rung) : pixelsPerSample(1 / rung);
}

/** The next rung finer than `zoom`, or `zoom` where it is the finest. */
export function zoomedIn(zoom: Zoom): Zoom {
  const current = samplesInPixel(zoom);
  let finer: number | undefined;
  for (const rung of RUNGS) {
    if (rung < current) finer = rung;
    else break;
  }
  return finer === undefined ? zoom : zoomOfRung(finer);
}

/** The next rung coarser than `zoom`, or `zoom` where it is the coarsest. */
export function zoomedOut(zoom: Zoom): Zoom {
  const current = samplesInPixel(zoom);
  const coarser = RUNGS.find((rung) => rung > current);
  return coarser === undefined ? zoom : zoomOfRung(coarser);
}

/**
 * `zoom` scaled by `factor`, a pinch's or a wheel's, where a factor above one
 * shows more samples. Always moves by at least one whole step in the direction
 * asked, so a slow pinch is never rounded to standing still.
 */
export function zoomScaled(zoom: Zoom, factor: number): Zoom {
  if (!Number.isFinite(factor) || factor <= 0 || factor === 1) return zoom;
  const scaled = zoomShowing(samplesInPixel(zoom) * factor);
  if (!zoomsEqual(scaled, zoom)) return scaled;
  return factor > 1 ? oneWholeStepOut(zoom) : oneWholeStepIn(zoom);
}

function oneWholeStepOut(zoom: Zoom): Zoom {
  return zoom.kind === 'samples-per-pixel'
    ? samplesPerPixel(zoom.samples + 1)
    : pixelsPerSample(zoom.pixels - 1);
}

function oneWholeStepIn(zoom: Zoom): Zoom {
  if (zoom.kind === 'pixels-per-sample') return pixelsPerSample(zoom.pixels + 1);
  return zoom.samples > 1 ? samplesPerPixel(zoom.samples - 1) : pixelsPerSample(2);
}

/** The zoom at which `samples` samples fill `width` pixels, or the nearest that shows them all. */
export function zoomFitting(samples: number, width: number): Zoom {
  if (!(samples > 0) || !(width > 0)) return ONE_SAMPLE_PER_PIXEL;
  const columns = Math.max(1, Math.floor(width));
  return samples >= columns
    ? samplesPerPixel(Math.ceil(samples / columns))
    : pixelsPerSample(Math.floor(columns / samples));
}
