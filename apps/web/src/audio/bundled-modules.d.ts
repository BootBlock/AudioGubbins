/**
 * The modules the build makes rather than any file holds, typed as the build
 * makes them, and nothing wider: each is declared by its own name, so an
 * import of any other generated name is still an error.
 */

/** The canonical DSP module's bytes, built from the crates by `vite.config.ts` (ADR-0031). */
declare module 'virtual:audiogubbins/dsp-module' {
  export const DSP_MODULE_BYTES: Uint8Array<ArrayBuffer>;
}

/** Where the bundler put the worklet processor, built on its own. */
declare module '@audiogubbins/audio-runtime/threads/engine-processor.ts?worker&url' {
  const url: string;
  export default url;
}

/** Where the bundler put the render worker, built on its own. */
declare module '@audiogubbins/audio-runtime/threads/render-worker.ts?worker&url' {
  const url: string;
  export default url;
}
