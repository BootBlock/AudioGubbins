/**
 * Where what the spectrogram host reports goes: every event to the diagnostic
 * log, and the worker's DSP choice also to where the Capabilities panel shows
 * it, as the Transport panel shows each audio thread's (ADR-0080).
 */

import type { Logger } from '@audiogubbins/diagnostics';
import type { SpectrogramHostEvent } from '@audiogubbins/spectral-analysis';

import type { MutableObservable } from '../state/observable.js';

/** Which DSP the spectrogram worker runs, and why the reference path runs, where it does. */
export type SpectrogramDsp = Omit<Extract<SpectrogramHostEvent, { kind: 'dsp' }>, 'kind'>;

/** What a spectrogram event is recorded as, for the diagnostic log. */
const SPECTROGRAM_EVENT_MESSAGES: Readonly<Record<SpectrogramHostEvent['kind'], string>> = {
  'cache-refused': 'A kept spectrogram tile was refused and is being made again.',
  'cache-unreadable': 'The spectrogram cache could not be read, so tiles are being made again.',
  'cache-unwritten':
    'A spectrogram tile could not be kept for the next visit; it is kept until the page closes.',
  failed: 'A spectrogram could not be made.',
  dsp: 'The spectrogram worker runs its DSP.',
};

/**
 * The host's report: each event logged, and the DSP each worker says it runs
 * held in `dsp`, a worker made after one failed replacing the last's.
 */
export function spectrogramReports(
  logger: Logger,
  dsp: MutableObservable<SpectrogramDsp | undefined>,
): (event: SpectrogramHostEvent) => void {
  return (event) => {
    const message = SPECTROGRAM_EVENT_MESSAGES[event.kind];
    if (event.kind === 'dsp') {
      dsp.set({ implementation: event.implementation, fallbackReason: event.fallbackReason });
      logger.info(message, {
        kind: event.implementation,
        ...(event.fallbackReason === undefined ? {} : { reason: event.fallbackReason }),
      });
    } else if (event.kind === 'failed') {
      logger.error(message, { reason: event.reason });
    } else {
      logger.warning(message, { reason: event.reason });
    }
  };
}
