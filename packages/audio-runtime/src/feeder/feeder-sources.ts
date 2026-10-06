/**
 * The sources of one playback request, made in the feeder worker.
 *
 * A source object cannot cross a thread, so the main thread describes each
 * graph input's audio, as a render does, and the feeder makes it here in the
 * layout of the input's port: recorded audio over the arrays it was
 * transferred, read in place, and a tone from the canonical oscillator of the
 * feeder's own DSP, the WebAssembly module where it runs and the reference
 * path, with the reason, where it does not (ADR-0031). The DSP is watched, so
 * the feeder says truthfully whether any source runs on it. An edited sound
 * runs its chains at the preview quality the message states, and a chain
 * starts part way after a seek, as a preview may (ADR-0061); a chain it
 * cannot run as it plays is read from its render, where the feeder has the
 * preview worker's renders to read, and a parameter changed while it plays
 * reaches its chains through the request's running parameters.
 */

import { flatMapResult, mapResult, type DomainResult } from '@audiogubbins/domain';
import type { NodeId } from '@audiogubbins/audio-graph';
import {
  ProcessedStart,
  RunningParameters,
  type CachedStreams,
  type ChainProcessing,
  type PcmSource,
} from '@audiogubbins/audio-engine';

import type { DspChooser, ScopeDsp } from '../dsp/dsp-instance.js';
import { watchDspUse } from '../dsp/dsp-use.js';
import type { ToFeeder, ToFeederKind } from '../protocol/feeder-messages.js';
import { renderEndpoints } from '../render/render-endpoints.js';
import { makeSources } from '../render/render-sources.js';

type SourcesMessage = Extract<ToFeeder, { readonly kind: typeof ToFeederKind.Sources }>;

/** One request's sources, and the DSP they were made on. */
export interface RequestSources {
  readonly sources: ReadonlyMap<NodeId, PcmSource>;
  readonly dsp: ScopeDsp;
  /** Whether a source called the DSP, as a tone does and recorded audio does not. */
  readonly dspInUse: boolean;
  /** The chains its edited sounds run as they play, which a running change reaches. */
  readonly parameters: RunningParameters;
}

/** The sources a message describes, each in its graph input's layout, or every reason one cannot be. */
export function sourcesFor(
  message: SourcesMessage,
  chooseDsp: DspChooser,
  processing: ChainProcessing,
  cached: CachedStreams | undefined,
): DomainResult<RequestSources> {
  const dsp = chooseDsp(message.dsp);
  const watched = watchDspUse(dsp.dsp);
  const parameters = new RunningParameters();
  return flatMapResult(renderEndpoints(message.graph), ({ inputs }) =>
    mapResult(
      makeSources(message.sources, inputs, watched.dsp, {
        processing,
        quality: message.quality.settings,
        start: ProcessedStart.Preview,
        parameters,
        ...(cached === undefined ? {} : { cached }),
      }),
      (sources) => ({
        sources,
        dsp,
        dspInUse: watched.used(),
        parameters,
      }),
    ),
  );
}
