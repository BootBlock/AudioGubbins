/**
 * The sources of one playback request, made in the feeder worker.
 *
 * A source object cannot cross a thread, so the main thread describes each
 * graph input's audio, as a render does, and the feeder makes it here in the
 * layout of the input's port: recorded audio over the arrays it was
 * transferred, read in place, and a tone from the canonical oscillator of the
 * feeder's own DSP, the WebAssembly module where it runs and the reference
 * path, with the reason, where it does not (ADR-0031). The DSP is watched, so
 * the feeder says truthfully whether any source runs on it.
 */

import { flatMapResult, mapResult, type DomainResult } from '@audiogubbins/domain';
import type { NodeId } from '@audiogubbins/audio-graph';
import type { PcmSource } from '@audiogubbins/audio-engine';

import type { ScopeDsp } from '../dsp/dsp-instance.js';
import { watchDspUse } from '../dsp/dsp-use.js';
import type { ToFeeder, ToFeederKind } from '../protocol/feeder-messages.js';
import { renderEndpoints } from '../render/render-endpoints.js';
import { makeSources } from '../render/render-sources.js';

type SourcesMessage = Extract<ToFeeder, { readonly kind: typeof ToFeederKind.Sources }>;

/**
 * Chooses the feeder's DSP from the module the main thread sent, or the reason
 * it sent none: `scopeDsp` in the worker.
 */
export type DspChooser = (
  module: WebAssembly.Module | undefined,
  unavailable: string | undefined,
) => ScopeDsp;

/** One request's sources, and the DSP they were made on. */
export interface RequestSources {
  readonly sources: ReadonlyMap<NodeId, PcmSource>;
  readonly dsp: ScopeDsp;
  /** Whether a source called the DSP, as a tone does and recorded audio does not. */
  readonly dspInUse: boolean;
}

/** The sources a message describes, each in its graph input's layout, or every reason one cannot be. */
export function sourcesFor(
  message: SourcesMessage,
  chooseDsp: DspChooser,
): DomainResult<RequestSources> {
  const dsp = chooseDsp(message.dspModule, message.dspUnavailable);
  const watched = watchDspUse(dsp.dsp);
  return flatMapResult(renderEndpoints(message.graph), ({ inputs }) =>
    mapResult(makeSources(message.sources, inputs, watched.dsp), (sources) => ({
      sources,
      dsp,
      dspInUse: watched.used(),
    })),
  );
}
