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

/** Where the bundler put the feeder worker, built on its own. */
declare module '@audiogubbins/audio-runtime/threads/feeder-worker.ts?worker&url' {
  const url: string;
  export default url;
}

/** Where the bundler put the render worker, built on its own. */
declare module '@audiogubbins/audio-runtime/threads/render-worker.ts?worker&url' {
  const url: string;
  export default url;
}

/** Where the bundler put the preview worker, built on its own. */
declare module '@audiogubbins/audio-runtime/threads/preview-worker.ts?worker&url' {
  const url: string;
  export default url;
}

/** Where the bundler put the storage worker, built on its own. */
declare module '@audiogubbins/storage-runtime/threads/storage-worker.ts?worker&url' {
  const url: string;
  export default url;
}

/** Where the bundler put the peak worker, built on its own. */
declare module '@audiogubbins/waveform/threads/peak-worker.ts?worker&url' {
  const url: string;
  export default url;
}

/** Where the bundler put the detection worker, built on its own. */
declare module '@audiogubbins/detection-runtime/threads/detection-worker.ts?worker&url' {
  const url: string;
  export default url;
}

/** Where the bundler put the inference worker, built on its own (ADR-0062). */
declare module '@audiogubbins/ml-runtime/threads/inference-worker.ts?worker&url' {
  const url: string;
  export default url;
}

/**
 * Where the application serves the inference runtime's WebAssembly, under its
 * base, and each build's SHA-256 taken from the bytes it serves, by
 * `inference-runtime.ts`.
 */
declare module 'virtual:audiogubbins/inference-runtime' {
  export const INFERENCE_RUNTIME_PATH: string;
  export const INFERENCE_RUNTIME_VERSION: string;
  export const INFERENCE_RUNTIME_SHA256: Readonly<Record<'cpu' | 'webgpu', string>>;
}

/** The model packs' catalogue as the build configures it, by `model-pack-serving.ts`. */
declare module 'virtual:audiogubbins/model-packs' {
  export const PACK_CATALOGUE:
    | { readonly kind: 'own-origin'; readonly path: string }
    | { readonly kind: 'absolute'; readonly url: string };
}
