/**
 * An audio context that changes state on a test's word, for testing what
 * reacts to one without a browser or a device.
 *
 * It keeps the one ordering a real context guarantees that matters here: its
 * state has changed, and `statechange` been dispatched, by the time the
 * promise of `resume`, `suspend` or `close` settles.
 */

import {
  AudioContextState,
  type AudioContextPort,
  type WorkletNodePort,
} from '../context/audio-context-port.js';

/** How a fake context starts; each absent field takes a stereo 48 kHz device's value. */
export interface FakeAudioContextSettings {
  readonly state?: AudioContextState;
  readonly sampleRate?: number;
  readonly baseLatency?: number;
  readonly outputLatency?: number | undefined;
  readonly maxChannelCount?: number;
  readonly channelCount?: number;
}

/** An audio context driven by a test. */
export class FakeAudioContext implements AudioContextPort {
  state: AudioContextState;
  readonly sampleRate: number;
  currentTime = 0;
  baseLatency: number;
  outputLatency: number | undefined;
  readonly destination: { maxChannelCount: number; channelCount: number };
  readonly audioWorklet = { addModule: (): Promise<void> => Promise.resolve() };

  /** Set to make `resume` reject with it, as a browser refusing autoplay does. */
  refuseResume: Error | undefined;
  resumeCalls = 0;
  closeCalls = 0;

  readonly #stateListeners = new Set<() => void>();

  constructor(settings: FakeAudioContextSettings = {}) {
    this.state = settings.state ?? AudioContextState.Suspended;
    this.sampleRate = settings.sampleRate ?? 48_000;
    this.baseLatency = settings.baseLatency ?? 128 / 48_000;
    this.outputLatency = 'outputLatency' in settings ? settings.outputLatency : 480 / 48_000;
    this.destination = {
      maxChannelCount: settings.maxChannelCount ?? 2,
      channelCount: settings.channelCount ?? 2,
    };
  }

  /** How many `statechange` listeners are attached. */
  get stateListenerCount(): number {
    return this.#stateListeners.size;
  }

  /** Moves to `state` and says so, as the browser or the system does. */
  becomes(state: AudioContextState): void {
    if (this.state === state) return;
    this.state = state;
    for (const listener of [...this.#stateListeners]) listener();
  }

  resume(): Promise<void> {
    this.resumeCalls += 1;
    if (this.refuseResume !== undefined) return Promise.reject(this.refuseResume);
    this.becomes(AudioContextState.Running);
    return Promise.resolve();
  }

  suspend(): Promise<void> {
    this.becomes(AudioContextState.Suspended);
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.closeCalls += 1;
    this.becomes(AudioContextState.Closed);
    return Promise.resolve();
  }

  addEventListener(_type: 'statechange', listener: () => void): void {
    this.#stateListeners.add(listener);
  }

  removeEventListener(_type: 'statechange', listener: () => void): void {
    this.#stateListeners.delete(listener);
  }

  createWorkletNode(): WorkletNodePort {
    throw new Error('This fake context makes no worklet nodes.');
  }
}
