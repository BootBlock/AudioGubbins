/**
 * The test signal's tone as playback reads it, made on the main thread.
 *
 * Made with the reference DSP: ADR-0032 makes it bit-identical to the
 * WebAssembly module, and the feed reads only a few hundred milliseconds
 * ahead, which is not worth a module instance on the main thread of its own.
 * A module of its own, reached by `import()` from the first Play, because the
 * oscillator and the rest of the reference DSP are code the first paint of
 * someone who never presses Play has no use for.
 */

import {
  flatMapResult,
  mapResult,
  sampleCount,
  sampleRate,
  type DomainResult,
} from '@audiogubbins/domain';
import { REFERENCE_DSP, toneSource, type PcmSource } from '@audiogubbins/audio-engine';
import type { PlaybackRequest } from '@audiogubbins/audio-runtime';

import { STEREO, TEST_SIGNAL, TEST_SIGNAL_GRAPH } from './test-signal.js';

/** The test signal's playback, and its source, which the caller releases. */
export interface TestSignalPlayback {
  readonly request: PlaybackRequest;
  readonly source: PcmSource;
}

/** The test signal to play at `contextRate`, the context's own (REQ-ARCH-085). */
export function testSignalPlayback(contextRate: number): DomainResult<TestSignalPlayback> {
  return flatMapResult(TEST_SIGNAL_GRAPH, ({ graph, input }) =>
    flatMapResult(sampleRate(contextRate), (rate) =>
      flatMapResult(sampleCount(TEST_SIGNAL.seconds * contextRate), (length) =>
        mapResult(
          toneSource(REFERENCE_DSP, {
            layout: STEREO,
            sampleRate: rate,
            frequency: TEST_SIGNAL.frequency,
            amplitude: TEST_SIGNAL.amplitude,
            length,
          }),
          (source) => ({ source, request: { graph, sources: new Map([[input, source]]) } }),
        ),
      ),
    ),
  );
}
