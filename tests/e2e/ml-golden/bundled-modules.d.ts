/**
 * The modules the golden harness's server makes rather than any file holds,
 * typed as it makes them, each by its own name, as the application's are
 * (`apps/web/src/audio/bundled-modules.d.ts`).
 */

/** Where the server serves the inference worker. */
declare module '@audiogubbins/ml-runtime/threads/inference-worker.ts?worker&url' {
  const url: string;
  export default url;
}

/** Where the server serves the harness's thread, which runs a golden's pass. */
declare module '*/harness-worker.ts?worker&url' {
  const url: string;
  export default url;
}

/** The inference runtime's WebAssembly as the server serves it, by `apps/web/inference-runtime.ts`. */
declare module 'virtual:audiogubbins/inference-runtime' {
  export const INFERENCE_RUNTIME_PATH: string;
  export const INFERENCE_RUNTIME_VERSION: string;
  export const INFERENCE_RUNTIME_SHA256: string;
}

/** The model packs' catalogue as the server serves it, by `apps/web/model-pack-serving.ts`. */
declare module 'virtual:audiogubbins/model-packs' {
  export const PACK_CATALOGUE:
    | { readonly kind: 'own-origin'; readonly path: string }
    | { readonly kind: 'absolute'; readonly url: string };
}
