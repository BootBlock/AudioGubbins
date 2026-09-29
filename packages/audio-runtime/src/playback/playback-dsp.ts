/**
 * The canonical DSP playback runs on, as each of its threads is given it.
 *
 * The page compiles the module once. The feeder worker is posted the compiled
 * module, which a dedicated worker accepts, as a render worker is. The
 * AudioWorklet is sent the module's bytes instead, which it compiles itself:
 * Chromium silently drops a message to an AudioWorklet that carries a compiled
 * module, and delivers one that carries bytes. Where the page could not compile
 * it, both threads are told why and run the reference path, which ADR-0031
 * makes the documented fallback and ADR-0032 makes give the same bits.
 */

/** Whether the page has the DSP module to give playback's threads. */
export const PlaybackDspKind = {
  Compiled: 'compiled',
  Unavailable: 'unavailable',
} as const;

/** The DSP module, as bytes for the worklet and compiled for the feeder, or why there is none. */
export type PlaybackDsp =
  | {
      readonly kind: typeof PlaybackDspKind.Compiled;
      /** Kept by the caller and copied into each load, never transferred. */
      readonly bytes: Uint8Array<ArrayBuffer>;
      readonly module: WebAssembly.Module;
    }
  | { readonly kind: typeof PlaybackDspKind.Unavailable; readonly reason: string };
