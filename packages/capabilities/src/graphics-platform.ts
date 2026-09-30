/**
 * What the editor's renderer is handed from the browser: the WebGPU entry
 * point, and the pixel ratio the canvases are sized by, as it changes.
 *
 * The renderer reads no global (ADR-0044): it is given `navigator.gpu` as an
 * unknown value, which it checks the shape of before use, so a browser without
 * WebGPU, or with a partial one, is a reason in its report rather than a fault.
 * The pixel ratio moves when a window goes to another screen or the page is
 * zoomed, and no event says so directly; a media query on the ratio in force
 * stops matching when it changes, which is the one signal a browser gives.
 */

import { watchMediaQuery } from './browser-environment.js';

/** The browser's graphics, as the editor's renderer takes them. */
export interface GraphicsPlatform {
  /** The browser's WebGPU entry point, or `undefined` where it offers none. */
  readonly gpu: unknown;
  /** Device pixels to a CSS pixel now: 1 where the browser does not say. */
  readonly pixelRatio: () => number;
  /**
   * Tells `changed` each time the pixel ratio changes, and gives back the
   * function that stops.
   */
  readonly watchPixelRatio: (changed: (ratio: number) => void) => () => void;
}

/** The ratio the browser reports, where it is a usable one. */
function currentRatio(): number {
  try {
    const ratio = window.devicePixelRatio;
    return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  } catch {
    // A hardened browser can refuse the read; drawn at one device pixel to a
    // CSS pixel, the waveform is softer on a dense screen and still right.
    return 1;
  }
}

/** The browser's WebGPU entry point, read without trusting its shape. */
function gpuEntry(): unknown {
  try {
    return Reflect.get(navigator, 'gpu');
  } catch {
    return undefined;
  }
}

/** Reads the browser's graphics platform. */
export function readGraphicsPlatform(): GraphicsPlatform {
  return {
    gpu: gpuEntry(),
    pixelRatio: currentRatio,
    watchPixelRatio: (changed) => {
      let stop: () => void = () => undefined;
      // The query names the ratio in force; once it stops matching, the ratio
      // has moved, and the watch is made again on the new one.
      const watch = (): void => {
        const ratio = currentRatio();
        stop = watchMediaQuery(`(resolution: ${String(ratio)}dppx)`, (matches) => {
          if (matches) return;
          stop();
          watch();
          changed(currentRatio());
        });
      };
      watch();
      return () => {
        stop();
      };
    },
  };
}
