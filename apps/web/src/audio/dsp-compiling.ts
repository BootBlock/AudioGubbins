/**
 * The canonical DSP module compiled from the bytes the bundle carries
 * (ADR-0031), in a module of its own so the bundler puts the bytes in a chunk
 * the page fetches only when a thread first needs the DSP: `page-dsp.ts`
 * reaches it by `import()` alone.
 */

import type { AudioRuntimeCapabilities } from '@audiogubbins/capabilities';
import type { DspDelivery } from '@audiogubbins/audio-engine';
import { compileDspModule, type CompiledDspModule } from '@audiogubbins/audio-runtime';
import { DSP_MODULE_BYTES } from 'virtual:audiogubbins/dsp-module';

/** The module compiled, or why it cannot be, for every thread the page starts. */
export function compiledDsp(
  capabilities: AudioRuntimeCapabilities,
): Promise<DspDelivery<CompiledDspModule>> {
  return compileDspModule(DSP_MODULE_BYTES, capabilities);
}
