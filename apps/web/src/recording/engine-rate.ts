/**
 * Restarting the audio engine at the open input's own rate (`ADR-0070`,
 * `REQ-REC-094`), which the recording diagnostics offer where the browser
 * resamples the input to the context's rate. The person decides; nothing here
 * runs unasked.
 *
 * Capture runs in the page's one context, so the context is made again: the
 * input open now closes and is told why, and the next arming opens it at the
 * rate chosen. Playback lets go of the context first, so it is refused while
 * something plays, and a recording is never cut off. A punch records at the
 * rate of the audio it replaces, so it keeps that rate. Playing an asset at
 * another rate makes the context again at the asset's own rate
 * (`context-host.ts`), and the diagnostics offer the input's rate again then.
 */

import {
  FailureKind,
  fail,
  failure,
  sampleRate,
  succeed,
  type DomainResult,
  type SampleRate,
} from '@audiogubbins/domain';

import type { AudioContextHost } from '../audio/context-host.js';
import type { PlaybackControl } from '../audio/playback-control.js';
import type { Observable } from '../state/observable.js';
import type { InputView } from './input-view.js';

/** What a restart reads and acts through. */
export interface EngineRateParts {
  readonly input: Observable<InputView>;
  readonly host: Pick<AudioContextHost, 'chooseRate'>;
  readonly playback: Pick<PlaybackControl, 'releaseContext'>;
}

function refused(summary: string): DomainResult<never> {
  return fail(failure('recording.engine-rate-refused', FailureKind.Rejected, summary));
}

/** The rate the engine would restart at, the open input's own, or why it cannot be now. */
function inputRateOf(view: InputView): DomainResult<SampleRate> {
  const { session, opened } = view;
  if (
    session.kind === 'recording' ||
    session.kind === 'counting-in' ||
    session.kind === 'stopping'
  ) {
    return refused('A recording is running. Stop it before restarting the audio engine.');
  }
  if (opened === undefined) {
    return refused('No input is open, so there is no rate of its own to restart at.');
  }
  if (session.kind === 'armed' && session.purpose.kind === 'punch') {
    return refused(
      'A punch records at the rate of the audio it replaces, so the audio engine keeps that rate.',
    );
  }
  const own = opened.granted.sampleRate;
  if (own === undefined) return refused("The browser does not say the input's own rate.");
  if (own === opened.rate) return refused("The audio engine runs at the input's rate already.");
  return sampleRate(own);
}

/** Restarts the audio engine at the input's own rate, when the person asks. */
export class EngineRate {
  readonly #parts: EngineRateParts;

  constructor(parts: EngineRateParts) {
    this.#parts = parts;
  }

  /** Why the engine cannot be restarted at the input's rate now, or nothing where it can. */
  refusal(): string | undefined {
    const rate = inputRateOf(this.#parts.input.get());
    return rate.ok ? undefined : rate.failures[0].summary;
  }

  /**
   * Makes the context again at the open input's own rate, which closes the
   * input, telling the person why, and answers the rate; or says why not.
   */
  restart(): DomainResult<SampleRate> {
    const rate = inputRateOf(this.#parts.input.get());
    if (!rate.ok) return rate;
    const released = this.#parts.playback.releaseContext();
    if (!released.ok) return released;
    this.#parts.host.chooseRate(rate.value);
    return succeed(rate.value);
  }
}
