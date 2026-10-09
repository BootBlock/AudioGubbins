/**
 * The recording part over fakes: a media input whose permission, devices,
 * output and refusals a test states, an opened input whose track a test ends or
 * mutes, a capture session that records what it was asked and says what a test
 * tells it to, and the page's context over a fake context port. jsdom has no
 * media devices, audio context, worklet or worker, and a real one would answer
 * to the machine's microphone rather than to the test.
 */

import { expect, vi } from 'vitest';

import {
  FailureKind,
  createDeterministicIdGenerator,
  failure,
  fail,
  succeed,
  type DomainFailure,
  type DomainResult,
  type EffectChain,
} from '@audiogubbins/domain';
import type { Logger } from '@audiogubbins/diagnostics';
import {
  AudioContextState,
  ContextLifecycle,
  FromCaptureKind,
  type AudioContextPort,
  type CaptureSessionEvent,
  type CaptureSource,
  type InputMeterReport,
  type MonitoringLatency,
} from '@audiogubbins/audio-runtime';
import type {
  CaptureRequest,
  GrantedCaptureSettings,
  InputDeviceDescriptor,
  MediaInput,
  MicrophonePermission,
  OpenedInput,
  OutputDeviceDescriptor,
  PageVisibility,
  SupportedCaptureConstraints,
} from '@audiogubbins/capabilities';
import type { LoopbackMeasurement } from '@audiogubbins/recording';

import type { CapturePort } from '../audio/capture-parts.js';
import { AudioContextHost } from '../audio/context-host.js';
import type { PlaybackControl } from '../audio/playback-control.js';
import type { PageWatch } from '../recording/open-input-watch.js';
import type { MeasureRoundTrip } from '../recording/loopback-measure.js';
import { startRecording, type RecordingParts } from '../recording/recording-part.js';
import type { AudioSettingsStore } from '../state/audio-settings-store.js';
import type { AudioView } from '../state/audio-view-store.js';
import type { Observable } from '../state/observable.js';
import type { WorkspaceStore } from '../state/workspace-store.js';
import { PROMPTLY } from './waiting.js';

/** The rate the fake context runs at. */
const FAKE_CAPTURE_RATE = 48_000;

function unused(): never {
  throw new Error('The recording fakes do not offer this.');
}

/** A context as the capture reads it: its rate, clock and latencies. */
export class FakeContextPort implements AudioContextPort {
  state: AudioContextState = AudioContextState.Running;
  readonly sampleRate: number;
  /** Seconds the context has played: none, so a capture and a play start at frame zero. */
  currentTime = 0;
  baseLatency = 0.005;
  outputLatency: number | undefined = 0.02;
  readonly destination = {
    maxChannelCount: 2,
    channelCount: 2,
    channelCountMode: 'explicit' as const,
    channelInterpretation: 'discrete' as const,
  };
  readonly audioWorklet = { addModule: (): Promise<void> => Promise.resolve() };
  closes = 0;

  constructor(sampleRate = FAKE_CAPTURE_RATE) {
    this.sampleRate = sampleRate;
  }

  resume(): Promise<void> {
    this.state = AudioContextState.Running;
    return Promise.resolve();
  }

  suspend(): Promise<void> {
    this.state = AudioContextState.Suspended;
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.closes += 1;
    this.state = AudioContextState.Closed;
    return Promise.resolve();
  }

  addEventListener(): void {
    return undefined;
  }

  removeEventListener(): void {
    return undefined;
  }

  createWorkletNode(): never {
    return unused();
  }

  createMediaStreamSource(): never {
    return unused();
  }
}

/** The page's context over fake ports, one made for each lifecycle the host asks for. */
export function fakeContextHost(logger: Logger): {
  readonly host: AudioContextHost;
  readonly contexts: FakeContextPort[];
} {
  const contexts: FakeContextPort[] = [];
  const host = new AudioContextHost(
    (latencyHint, rate) =>
      new ContextLifecycle({
        createContext: () => {
          const context = new FakeContextPort(rate);
          contexts.push(context);
          return context;
        },
        watchDevices: () => () => undefined,
        latencyHint,
        ...(rate === undefined ? {} : { sampleRate: rate }),
        schedule: () => () => undefined,
        logger,
      }),
    logger,
  );
  return { host, contexts };
}

/** A stream with no tracks: the fakes read nothing from it. */
class FakeStream extends EventTarget implements MediaStream {
  readonly active = true;
  readonly id = 'fake-input';
  onaddtrack = null;
  onremovetrack = null;
  addTrack = unused;
  removeTrack = unused;
  clone = unused;
  getTrackById = unused;

  getAudioTracks(): MediaStreamTrack[] {
    return [];
  }

  getVideoTracks(): MediaStreamTrack[] {
    return [];
  }

  getTracks(): MediaStreamTrack[] {
    return [];
  }
}

/** The settings a fake input grants where a test says nothing else. */
export function grantedSettings(
  changes: Partial<GrantedCaptureSettings> = {},
): GrantedCaptureSettings {
  return {
    deviceId: 'interface',
    groupId: 'interface-group',
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    voiceIsolation: undefined,
    channelCount: 2,
    sampleRate: FAKE_CAPTURE_RATE,
    sampleSize: undefined,
    latency: 0.004,
    ...changes,
  };
}

/** An open input whose track a test ends or mutes. */
export class FakeOpenedInput implements OpenedInput {
  readonly stream: MediaStream = new FakeStream();
  readonly label: string | undefined;
  readonly settings: GrantedCaptureSettings;
  stopped = false;
  #muted = false;
  readonly #ended = new Set<() => void>();
  readonly #mutes = new Set<(muted: boolean) => void>();

  constructor(settings: GrantedCaptureSettings, label: string | undefined) {
    this.settings = settings;
    this.label = label;
  }

  readonly isMuted = (): boolean => this.#muted;

  readonly watchEnded = (ended: () => void): (() => void) => {
    this.#ended.add(ended);
    return () => {
      this.#ended.delete(ended);
    };
  };

  readonly watchMuted = (changed: (muted: boolean) => void): (() => void) => {
    this.#mutes.add(changed);
    return () => {
      this.#mutes.delete(changed);
    };
  };

  readonly stop = (): void => {
    this.stopped = true;
  };

  /** The device was unplugged, or the permission taken back. */
  end(): void {
    for (const ended of [...this.#ended]) ended();
  }

  /** The browser silenced the input, or gave it back. */
  mute(muted: boolean): void {
    this.#muted = muted;
    for (const changed of [...this.#mutes]) changed(muted);
  }
}

/** A listed input. */
export function listedInput(
  deviceId: string,
  label: string,
  changes: Partial<InputDeviceDescriptor> = {},
): InputDeviceDescriptor {
  return {
    deviceId,
    groupId: `${deviceId}-group`,
    label,
    channelCounts: { min: 1, max: 2 },
    sampleRates: { min: 44_100, max: 96_000 },
    ...changes,
  };
}

const EVERY_CONSTRAINT: SupportedCaptureConstraints = {
  deviceId: true,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  voiceIsolation: false,
  channelCount: true,
  sampleRate: true,
  sampleSize: false,
  latency: true,
};

/** The browser's input as a test states it. */
export class FakeMediaInput implements MediaInput {
  permissionState: MicrophonePermission = 'prompt';
  devices: readonly InputDeviceDescriptor[] = [listedInput('interface', 'Studio interface')];
  supportedConstraints: SupportedCaptureConstraints | undefined = EVERY_CONSTRAINT;
  /** Why the next opening is refused, where a test wants it refused. */
  refusal: DomainFailure | undefined;
  /** What the next opening grants. */
  granted: GrantedCaptureSettings = grantedSettings();
  label: string | undefined = 'Studio interface';
  /** Whether listing refuses, and why. */
  listingRefusal: DomainFailure | undefined;
  /** Every request an opening was asked with, in order. */
  readonly requests: CaptureRequest[] = [];
  readonly opened: FakeOpenedInput[] = [];
  listings = 0;
  /** Openings not yet answered, which a test settles with `answer`. */
  readonly #waiting: (() => void)[] = [];
  /** Whether an opening waits for `answer`, as a browser waits for the person. */
  holdOpenings = false;
  readonly #permissionListeners = new Set<(state: MicrophonePermission) => void>();
  readonly #deviceListeners = new Set<(inputs: readonly InputDeviceDescriptor[]) => void>();
  /** The output the page plays through; none, as a browser that cannot say which, unless a test names one. */
  outputDevice: OutputDeviceDescriptor | undefined;
  readonly #outputListeners = new Set<(output: OutputDeviceDescriptor | undefined) => void>();

  readonly permission = (): Promise<MicrophonePermission> => Promise.resolve(this.permissionState);

  readonly watchPermission = (changed: (state: MicrophonePermission) => void): (() => void) => {
    this.#permissionListeners.add(changed);
    changed(this.permissionState);
    return () => {
      this.#permissionListeners.delete(changed);
    };
  };

  readonly listDevices = (): Promise<DomainResult<readonly InputDeviceDescriptor[]>> => {
    this.listings += 1;
    return Promise.resolve(
      this.listingRefusal === undefined ? succeed(this.devices) : fail(this.listingRefusal),
    );
  };

  readonly watchDevices = (
    changed: (inputs: readonly InputDeviceDescriptor[]) => void,
  ): (() => void) => {
    this.#deviceListeners.add(changed);
    return () => {
      this.#deviceListeners.delete(changed);
    };
  };

  readonly output = (): Promise<OutputDeviceDescriptor | undefined> =>
    Promise.resolve(this.outputDevice);

  readonly watchOutput = (
    changed: (output: OutputDeviceDescriptor | undefined) => void,
  ): (() => void) => {
    this.#outputListeners.add(changed);
    return () => {
      this.#outputListeners.delete(changed);
    };
  };

  readonly open = async (request: CaptureRequest): Promise<DomainResult<OpenedInput>> => {
    this.requests.push(request);
    if (this.holdOpenings) {
      await new Promise<void>((resolve) => {
        this.#waiting.push(resolve);
      });
    }
    if (this.refusal !== undefined) return fail(this.refusal);
    const input = new FakeOpenedInput(this.granted, this.label);
    this.opened.push(input);
    this.permissionState = 'granted';
    return succeed(input);
  };

  /** Lets the openings waiting go on, as the person answering the browser's prompt does. */
  answer(): void {
    for (const resolve of this.#waiting.splice(0)) resolve();
  }

  /** Whether anything watches the permission, the inputs or the output now. */
  watched(): boolean {
    return (
      this.#permissionListeners.size > 0 ||
      this.#deviceListeners.size > 0 ||
      this.#outputListeners.size > 0
    );
  }

  /** The permission changed, as a person changing the site's settings changes it. */
  setPermission(state: MicrophonePermission): void {
    this.permissionState = state;
    for (const listener of [...this.#permissionListeners]) listener(state);
  }

  /** The devices changed, as plugging one in or out changes them. */
  setDevices(devices: readonly InputDeviceDescriptor[]): void {
    this.devices = devices;
    for (const listener of [...this.#deviceListeners]) listener(devices);
  }

  /** The output changed, as the system moving its default output to another device changes it. */
  setOutput(output: OutputDeviceDescriptor | undefined): void {
    this.outputDevice = output;
    for (const listener of [...this.#outputListeners]) listener(output);
  }
}

/** The person refused the microphone, as the adapter says it. */
export const NOT_ALLOWED: DomainFailure = failure(
  'media-input.not-allowed',
  FailureKind.Rejected,
  'Permission to use the microphone was refused.',
);

/** A capture session that records what it was asked and says what a test tells it to. */
export class FakeCapture implements CapturePort {
  readonly sources: CaptureSource[] = [];
  readonly arms: number[] = [];
  readonly monitors: boolean[] = [];
  readonly chains: (EffectChain | undefined)[] = [];
  readonly records: number[] = [];
  readonly stops: number[] = [];
  disarms = 0;
  disposed = false;
  /** Why monitoring cannot be routed on this device, where a test says so. */
  monitorRefusal: string | undefined;
  meter: InputMeterReport | undefined;
  latency: MonitoringLatency | undefined = {
    chainFrames: 0,
    outputSeconds: 0.025,
    inputSeconds: 0.004,
    totalSeconds: 0.029,
  };
  /** The far end of the channel each take was recorded onto, for a test to write to. */
  readonly channels: MessagePort[] = [];
  readonly #listeners = new Set<(event: CaptureSessionEvent) => void>();

  subscribe(listener: (event: CaptureSessionEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  open(source: CaptureSource): Promise<DomainResult<void>> {
    this.sources.push(source);
    return Promise.resolve(succeed(undefined));
  }

  arm(retrospectiveSeconds: number): DomainResult<void> {
    this.arms.push(retrospectiveSeconds);
    return succeed(undefined);
  }

  disarm(): DomainResult<void> {
    this.disarms += 1;
    return succeed(undefined);
  }

  record(at: number): DomainResult<MessagePort> {
    this.records.push(at);
    const channel = new MessageChannel();
    this.channels.push(channel.port1);
    return succeed(channel.port2);
  }

  stop(at: number): DomainResult<void> {
    this.stops.push(at);
    return succeed(undefined);
  }

  monitor(on: boolean): DomainResult<void> {
    if (on && this.monitorRefusal !== undefined) {
      return fail(
        failure('capture.monitoring-unroutable', FailureKind.Rejected, this.monitorRefusal),
      );
    }
    this.monitors.push(on);
    // The processor answers from the audio thread, after the call returns.
    queueMicrotask(() => {
      this.say({ kind: FromCaptureKind.Monitoring, on, chained: false, chainLatencyFrames: 0 });
    });
    return succeed(undefined);
  }

  monitorThrough(chain: EffectChain | undefined): DomainResult<void> {
    this.chains.push(chain);
    return succeed(undefined);
  }

  meters(): InputMeterReport | undefined {
    return this.meter;
  }

  monitoringLatency(): MonitoringLatency | undefined {
    return this.latency;
  }

  close(): void {
    return undefined;
  }

  dispose(): void {
    this.disposed = true;
  }

  /** Says `event` to the listeners, as the processor's reply or the context's loss does. */
  say(event: CaptureSessionEvent): void {
    for (const listener of [...this.#listeners]) listener(event);
  }
}

/** The page's visibility, as a test changes it. */
export class FakePage implements PageWatch {
  #visibility: PageVisibility = 'visible';
  readonly #listeners = new Set<(visibility: PageVisibility) => void>();

  readonly visibility = (): PageVisibility => this.#visibility;

  readonly watch = (changed: (visibility: PageVisibility) => void): (() => void) => {
    this.#listeners.add(changed);
    return () => {
      this.#listeners.delete(changed);
    };
  };

  /** The page went into the background or came back. */
  set(visibility: PageVisibility): void {
    this.#visibility = visibility;
    for (const listener of [...this.#listeners]) listener(visibility);
  }
}

/** A measurement that answers what a test says, and keeps what it was given. */
export class FakeMeasure {
  answer: DomainResult<LoopbackMeasurement> | undefined;
  readonly given: Float32Array[] = [];

  readonly measure: MeasureRoundTrip = (captured) => {
    this.given.push(captured);
    return Promise.resolve(
      this.answer ??
        fail(
          failure('recording.loopback-unclear', FailureKind.Rejected, 'Not heard back clearly.'),
        ),
    );
  };
}

/** The fakes behind a recording part, for a test to drive and inspect. */
export interface RecordingFakes {
  readonly media: FakeMediaInput;
  readonly captures: FakeCapture[];
  readonly contexts: FakeContextPort[];
  readonly page: FakePage;
  readonly measure: FakeMeasure;
  readonly host: AudioContextHost;
  /** What the machine has left, as a test sets it: by default the browser says nothing. */
  readonly resources: { availableMemoryBytes: number | undefined };
}

/** What a fake recording part is made over: the shell's own stores. */
export interface FakeRecordingOptions {
  readonly settings: AudioSettingsStore;
  readonly playback: PlaybackControl;
  readonly audio: Observable<AudioView>;
  readonly workspace: WorkspaceStore;
  readonly announce: (text: string) => void;
  readonly logger: Logger;
  /** Whether the platform may suspend capture in the background. */
  readonly suspensionRisk?: boolean;
}

/** The recording part over fakes, and the fakes. */
export function fakeRecording(options: FakeRecordingOptions): {
  readonly parts: RecordingParts;
  readonly fakes: RecordingFakes;
  readonly dispose: () => void;
} {
  const { host, contexts } = fakeContextHost(options.logger);
  const fakes: RecordingFakes = {
    media: new FakeMediaInput(),
    captures: [],
    contexts,
    page: new FakePage(),
    measure: new FakeMeasure(),
    host,
    resources: { availableMemoryBytes: undefined },
  };
  const { parts, dispose } = startRecording({
    media: fakes.media,
    host,
    openCapture: () => {
      const capture = new FakeCapture();
      fakes.captures.push(capture);
      return Promise.resolve(capture);
    },
    settings: options.settings,
    playback: options.playback,
    audio: options.audio,
    workspace: options.workspace,
    measure: fakes.measure.measure,
    page: fakes.page,
    estimate: () => Promise.resolve({ quota: 10_000_000_000, usage: 1_000_000 }),
    suspensionRisk: options.suspensionRisk ?? false,
    resources: () => ({ ...fakes.resources }),
    schedule: (callback, milliseconds) => {
      const timer = setTimeout(callback, milliseconds);
      return () => {
        clearTimeout(timer);
      };
    },
    now: () => 1_700_000_000_000,
    ids: createDeterministicIdGenerator(11),
    announce: options.announce,
    logger: options.logger,
  });
  return { parts, fakes, dispose };
}

/**
 * Waits until an arming has opened its input and answers its capture, the
 * `count`th made: an arming reads the time the storage worker leaves before it
 * asks the browser for the input, which takes more than a turn of the task
 * queue.
 */
export async function inputOpened(fakes: RecordingFakes, count = 1): Promise<FakeCapture> {
  await vi.waitFor(() => {
    expect(fakes.captures.length).toBeGreaterThanOrEqual(count);
  }, PROMPTLY);
  const capture = fakes.captures[count - 1];
  if (capture === undefined) throw new Error('No input opened.');
  return capture;
}
