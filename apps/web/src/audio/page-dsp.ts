/**
 * The page's one compiled DSP module, made on first use and shared by every
 * thread that runs the DSP: the feeder and render workers through the
 * engine, and the spectrogram worker (ADR-0080), which takes the delivery a
 * render worker takes. Compiling is the expensive half of WebAssembly, so it
 * is done once; the bytes are fetched only then, so a page that runs no DSP
 * loads none of them.
 */

import type { AudioRuntimeCapabilities } from '@audiogubbins/capabilities';
import type { DspDelivery } from '@audiogubbins/audio-engine';
import type { CompiledDspModule } from '@audiogubbins/audio-runtime';

/** The compiled module, or why there is none, asked for by each thread that runs the DSP. */
export type PageDsp = () => Promise<DspDelivery<CompiledDspModule>>;

/** The page's DSP, compiled when first asked for under `capabilities`. */
export function pageDsp(capabilities: AudioRuntimeCapabilities): PageDsp {
  let compiling: Promise<DspDelivery<CompiledDspModule>> | undefined;
  return () => {
    if (compiling !== undefined) return compiling;
    const attempt = import('./dsp-compiling.js').then(({ compiledDsp }) =>
      compiledDsp(capabilities),
    );
    compiling = attempt;
    // Whoever awaits the attempt hears its failure; this only lets the next
    // thread try again, since a chunk that could not be fetched once may be.
    void attempt.catch(() => {
      if (compiling === attempt) compiling = undefined;
    });
    return attempt;
  };
}
