/**
 * An audio context that changes state on a test's word, for testing what
 * reacts to one without a browser or a device.
 *
 * It keeps the one ordering a real context guarantees that matters here: its
 * state has changed, and `statechange` been dispatched, by the time the
 * promise of `resume`, `suspend` or `close` settles.
 *
 * It answers `resume` as browsers do. A context not yet allowed to start, on a
 * page that has had no click or key press, and one the system holds, as Safari
 * holds an interrupted one, leave the promise pending: it resolves when the
 * context runs, after a `gesture` or the system's release, and is rejected with
 * an `InvalidStateError` if the context is suspended or closed first. A closed
 * context refuses at once with the same error. No browser rejects a resume for
 * want of a gesture, so this fake does not either.
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
  /** Whether the page has had the click or key press a context needs to start; it has, by default. */
  readonly allowedToStart?: boolean;
}

/** An audio context driven by a test. */
export class FakeAudioContext implements AudioContextPort {
  state: AudioContextState;
  readonly sampleRate: number;
  currentTime = 0;
  baseLatency: number;
  outputLatency: number | undefined;
  readonly destination: {
    maxChannelCount: number;
    channelCount: number;
    channelCountMode: 'max' | 'clamped-max' | 'explicit';
    channelInterpretation: 'speakers' | 'discrete';
  };
  readonly audioWorklet = { addModule: (): Promise<void> => Promise.resolve() };

  /** Whether the page has had the click or key press a context needs to start. */
  allowedToStart: boolean;
  resumeCalls = 0;
  closeCalls = 0;

  readonly #stateListeners = new Set<() => void>();
  /** The resumes waiting for the context to run, as a browser keeps them. */
  readonly #pendingResumes: {
    readonly resolve: () => void;
    readonly reject: (error: DOMException) => void;
  }[] = [];

  constructor(settings: FakeAudioContextSettings = {}) {
    this.state = settings.state ?? AudioContextState.Suspended;
    this.sampleRate = settings.sampleRate ?? 48_000;
    this.baseLatency = settings.baseLatency ?? 128 / 48_000;
    this.outputLatency = 'outputLatency' in settings ? settings.outputLatency : 480 / 48_000;
    this.destination = {
      maxChannelCount: settings.maxChannelCount ?? 2,
      channelCount: settings.channelCount ?? 2,
      // A context's destination as a browser makes it: stereo, mixed as speakers.
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    };
    this.allowedToStart = settings.allowedToStart ?? true;
  }

  /** How many `statechange` listeners are attached. */
  get stateListenerCount(): number {
    return this.#stateListeners.size;
  }

  /** How many resumes wait for the context to run. */
  get pendingResumeCount(): number {
    return this.#pendingResumes.length;
  }

  /**
   * Moves to `state` and says so, as the browser or the system does. A
   * context that runs resolves the resumes waiting on it; one that closes
   * rejects them.
   */
  becomes(state: AudioContextState): void {
    if (this.state === state) return;
    this.state = state;
    for (const listener of [...this.#stateListeners]) listener();
    if (state === AudioContextState.Running) {
      for (const pending of this.#pendingResumes.splice(0)) pending.resolve();
    } else if (state === AudioContextState.Closed) {
      this.#rejectPendingResumes('The AudioContext was closed.');
    }
  }

  /** The person clicks or presses a key, which lets a context start and resumes one waiting to. */
  gesture(): void {
    this.allowedToStart = true;
    if (this.#pendingResumes.length > 0 && this.state === AudioContextState.Suspended) {
      this.becomes(AudioContextState.Running);
    }
  }

  resume(): Promise<void> {
    this.resumeCalls += 1;
    if (this.state === AudioContextState.Closed) {
      return Promise.reject(
        new DOMException('Cannot resume a closed AudioContext.', 'InvalidStateError'),
      );
    }
    if (this.state === AudioContextState.Running) return Promise.resolve();
    const waiting = new Promise<void>((resolve, reject) => {
      this.#pendingResumes.push({ resolve, reject });
    });
    if (this.allowedToStart && this.state === AudioContextState.Suspended) {
      this.becomes(AudioContextState.Running);
    }
    return waiting;
  }

  suspend(): Promise<void> {
    this.#rejectPendingResumes('The AudioContext was suspended.');
    this.becomes(AudioContextState.Suspended);
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.closeCalls += 1;
    this.becomes(AudioContextState.Closed);
    return Promise.resolve();
  }

  #rejectPendingResumes(message: string): void {
    for (const pending of this.#pendingResumes.splice(0)) {
      pending.reject(new DOMException(message, 'InvalidStateError'));
    }
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
