/**
 * The media input adapter over hand-built browsers: every answer a browser can
 * give to the permission query, the device list and `getUserMedia`, and every
 * absence, stated here rather than probed from the machine running the tests.
 */

import {
  Cancelled,
  createCancellationSource,
  type DomainFailure,
  type DomainResult,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { describe, expect, it } from 'vitest';

import { readMediaInput, type MediaInputNavigator } from './media-input.js';

const unused = (): never => {
  throw new Error('Not used by these tests.');
};

/** A failed result's first failure, throwing where it succeeded. */
function failureOf<T>(result: DomainResult<T>): DomainFailure {
  if (result.ok) throw new Error('Expected the result to fail, but it succeeded.');
  return result.failures[0];
}

/** Lets every pending promise callback run. */
const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
};

/** A microphone permission status whose state a test changes. */
class FakePermissionStatus extends EventTarget implements PermissionStatus {
  readonly name = 'microphone';
  onchange = null;

  state: PermissionState;

  constructor(state: PermissionState) {
    super();
    this.state = state;
  }

  /** Changes the state as a person changing the site's setting does. */
  become(state: PermissionState): void {
    this.state = state;
    this.dispatchEvent(new Event('change'));
  }
}

/** A Permissions API whose query answers `answer`, recording what it was asked. */
function permissionsAnswering(answer: () => Promise<PermissionStatus>) {
  const asked: PermissionDescriptor[] = [];
  const permissions: Permissions = {
    query: (descriptor) => {
      asked.push(descriptor);
      return answer();
    },
  };
  return { permissions, asked };
}

/** An audio track whose state and events a test drives. */
class FakeTrack extends EventTarget implements MediaStreamTrack {
  contentHint = '';
  enabled = true;
  readonly id = 'track';
  muted = false;
  readyState: MediaStreamTrackState = 'live';
  onended = null;
  onmute = null;
  onunmute = null;
  stops = 0;
  applyConstraints = unused;
  clone = unused;
  getCapabilities = unused;
  getConstraints = unused;

  readonly label: string;
  readonly kind: string;
  private readonly settings: MediaTrackSettings;

  constructor(label: string, settings: MediaTrackSettings, kind = 'audio') {
    super();
    this.label = label;
    this.settings = settings;
    this.kind = kind;
  }

  getSettings(): MediaTrackSettings {
    return this.settings;
  }

  stop(): void {
    this.stops += 1;
    this.readyState = 'ended';
  }

  /** Raises an event the browser raises on the track. */
  raise(type: 'ended' | 'mute' | 'unmute'): void {
    if (type === 'ended') this.readyState = 'ended';
    if (type !== 'ended') this.muted = type === 'mute';
    this.dispatchEvent(new Event(type));
  }
}

/** A stream of the given tracks. */
class FakeStream extends EventTarget implements MediaStream {
  readonly active = true;
  readonly id = 'stream';
  onaddtrack = null;
  onremovetrack = null;
  addTrack = unused;
  removeTrack = unused;
  clone = unused;
  getTrackById = unused;

  private readonly tracks: readonly MediaStreamTrack[];

  constructor(tracks: readonly MediaStreamTrack[]) {
    super();
    this.tracks = tracks;
  }

  getAudioTracks(): MediaStreamTrack[] {
    return this.tracks.filter((track) => track.kind === 'audio');
  }

  getVideoTracks(): MediaStreamTrack[] {
    return this.tracks.filter((track) => track.kind === 'video');
  }

  getTracks(): MediaStreamTrack[] {
    return [...this.tracks];
  }
}

/** A listed device, with the capabilities Chromium's inputs report where given. */
function device(
  kind: MediaDeviceKind,
  fields: { deviceId?: string; groupId?: string; label?: string },
  capabilities?: () => unknown,
): MediaDeviceInfo {
  return {
    kind,
    deviceId: fields.deviceId ?? '',
    groupId: fields.groupId ?? '',
    label: fields.label ?? '',
    toJSON: unused,
    ...(capabilities === undefined ? {} : { getCapabilities: capabilities }),
  };
}

/** Media devices whose list, `getUserMedia` answer and supported constraints a test states. */
class FakeMediaDevices extends EventTarget implements MediaDevices {
  ondevicechange = null;
  getDisplayMedia = unused;
  readonly asked: MediaStreamConstraints[] = [];
  listings = 0;

  private readonly list: () => Promise<MediaDeviceInfo[]>;
  private readonly answer: () => Promise<MediaStream>;
  private readonly supported: MediaTrackSupportedConstraints;

  constructor(
    list: () => Promise<MediaDeviceInfo[]>,
    answer: () => Promise<MediaStream> = unused,
    supported: MediaTrackSupportedConstraints = {},
  ) {
    super();
    this.list = list;
    this.answer = answer;
    this.supported = supported;
  }

  enumerateDevices(): Promise<MediaDeviceInfo[]> {
    this.listings += 1;
    return this.list();
  }

  getUserMedia(constraints?: MediaStreamConstraints): Promise<MediaStream> {
    this.asked.push(constraints ?? {});
    return this.answer();
  }

  getSupportedConstraints(): MediaTrackSupportedConstraints {
    return this.supported;
  }

  /** Says the devices changed, as plugging one in does. */
  change(): void {
    this.dispatchEvent(new Event('devicechange'));
  }
}

const SECURE = { isSecureContext: true };

/** A secure page whose navigator offers these devices and permissions. */
function inputOf(navigatorLike: MediaInputNavigator, globalLike = SECURE) {
  return readMediaInput(navigatorLike, globalLike);
}

describe('the microphone permission', () => {
  for (const state of ['granted', 'denied', 'prompt'] as const) {
    it(`reads ${state} from the Permissions API, asking for the microphone`, async () => {
      const { permissions, asked } = permissionsAnswering(() =>
        Promise.resolve(new FakePermissionStatus(state)),
      );
      expect(await inputOf({ permissions }).permission()).toBe(state);
      expect(asked).toEqual([{ name: 'microphone' }]);
    });
  }

  it('is unknown where the browser has no Permissions API', async () => {
    expect(await inputOf({}).permission()).toBe('unknown');
  });

  it('is unknown where the browser does not know the microphone permission', async () => {
    const { permissions } = permissionsAnswering(() =>
      Promise.reject(new TypeError("'microphone' is not a valid permission name.")),
    );
    expect(await inputOf({ permissions }).permission()).toBe('unknown');
  });

  it('is unknown where the browser refuses the query', async () => {
    const { permissions } = permissionsAnswering(() =>
      Promise.reject(new DOMException('Refused.', 'InvalidStateError')),
    );
    expect(await inputOf({ permissions }).permission()).toBe('unknown');
  });

  it('lets a fault in the query through rather than calling it unknown', async () => {
    const { permissions } = permissionsAnswering(() => Promise.reject(new RangeError('A fault.')));
    await expect(inputOf({ permissions }).permission()).rejects.toThrow(RangeError);
  });

  it('is unknown where a browser reports a state it did not have', async () => {
    const status = new FakePermissionStatus('granted');
    Reflect.set(status, 'state', 'limited');
    const { permissions } = permissionsAnswering(() => Promise.resolve(status));
    expect(await inputOf({ permissions }).permission()).toBe('unknown');
  });

  it('is watched from its first state through a revocation, until the watch stops', async () => {
    const status = new FakePermissionStatus('granted');
    const { permissions } = permissionsAnswering(() => Promise.resolve(status));
    const heard: string[] = [];
    const stop = inputOf({ permissions }).watchPermission((state) => heard.push(state));
    await settle();
    status.become('denied');
    stop();
    status.become('granted');
    expect(heard).toEqual(['granted', 'denied']);
  });

  it('hears nothing where the watch stops before the browser answers', async () => {
    const status = new FakePermissionStatus('granted');
    const { permissions } = permissionsAnswering(() => Promise.resolve(status));
    const heard: string[] = [];
    inputOf({ permissions }).watchPermission((state) => heard.push(state))();
    await settle();
    status.become('denied');
    expect(heard).toEqual([]);
  });

  it('is watched as unknown, once, where the browser gives no status', async () => {
    const heard: string[] = [];
    inputOf({}).watchPermission((state) => heard.push(state));
    await settle();
    expect(heard).toEqual(['unknown']);
  });
});

/** The capabilities Chromium reports for an input once the microphone is allowed. */
const STUDIO_CAPABILITIES = () => ({
  channelCount: { min: 1, max: 8 },
  sampleRate: { min: 44_100, max: 192_000 },
});

describe('the input devices', () => {
  it('lists the audio inputs alone, with their identifiers, labels and reported ranges', async () => {
    const devices = new FakeMediaDevices(() =>
      Promise.resolve([
        device(
          'audioinput',
          { deviceId: 'mic-1', groupId: 'interface', label: 'Studio interface' },
          STUDIO_CAPABILITIES,
        ),
        device('audiooutput', { deviceId: 'out-1', groupId: 'interface', label: 'Speakers' }),
        device('videoinput', { deviceId: 'cam-1', groupId: 'camera', label: 'Camera' }),
        device('audioinput', { deviceId: 'mic-2', groupId: 'headset', label: 'Headset' }),
      ]),
    );
    const listed = expectSuccess(await inputOf({ mediaDevices: devices }).listDevices());
    expect(listed).toEqual([
      {
        deviceId: 'mic-1',
        groupId: 'interface',
        label: 'Studio interface',
        channelCounts: { min: 1, max: 8 },
        sampleRates: { min: 44_100, max: 192_000 },
      },
      {
        deviceId: 'mic-2',
        groupId: 'headset',
        label: 'Headset',
        channelCounts: undefined,
        sampleRates: undefined,
      },
    ]);
  });

  it('lists an input whose label and identifiers are withheld as having none', async () => {
    // As a browser lists inputs before the microphone is allowed: empty strings and no capabilities.
    const devices = new FakeMediaDevices(() =>
      Promise.resolve([device('audioinput', {}, () => ({}))]),
    );
    const listed = expectSuccess(await inputOf({ mediaDevices: devices }).listDevices());
    expect(listed).toEqual([
      {
        deviceId: undefined,
        groupId: undefined,
        label: undefined,
        channelCounts: undefined,
        sampleRates: undefined,
      },
    ]);
  });

  it('takes no range a browser reports out of order or not as numbers', async () => {
    const devices = new FakeMediaDevices(() =>
      Promise.resolve([
        device('audioinput', { deviceId: 'mic' }, () => ({
          channelCount: { min: 8, max: 1 },
          sampleRate: { min: '44100', max: 48_000 },
        })),
      ]),
    );
    const [listed] = expectSuccess(await inputOf({ mediaDevices: devices }).listDevices());
    expect(listed?.channelCounts).toBeUndefined();
    expect(listed?.sampleRates).toBeUndefined();
  });

  it('lists the inputs again whenever the devices change, until the watch stops', async () => {
    let connected = [device('audioinput', { deviceId: 'mic-1' })];
    const devices = new FakeMediaDevices(() => Promise.resolve(connected));
    const heard: (string | undefined)[][] = [];
    const stop = inputOf({ mediaDevices: devices }).watchDevices((inputs) =>
      heard.push(inputs.map((input) => input.deviceId)),
    );
    connected = [...connected, device('audioinput', { deviceId: 'mic-2' })];
    devices.change();
    await settle();
    stop();
    connected = [];
    devices.change();
    await settle();
    expect(heard).toEqual([['mic-1', 'mic-2']]);
    expect(devices.listings).toBe(1);
  });

  it('delivers only the latest list where two answer out of order', async () => {
    const pending: ((devices: MediaDeviceInfo[]) => void)[] = [];
    const devices = new FakeMediaDevices(() => new Promise((resolve) => pending.push(resolve)));
    const heard: (string | undefined)[][] = [];
    inputOf({ mediaDevices: devices }).watchDevices((inputs) =>
      heard.push(inputs.map((input) => input.deviceId)),
    );
    devices.change();
    devices.change();
    const [older, newer] = pending;
    newer?.([device('audioinput', { deviceId: 'newer' })]);
    await settle();
    older?.([device('audioinput', { deviceId: 'older' })]);
    await settle();
    expect(heard).toEqual([['newer']]);
  });

  it('says the browser offers no list where it has no media devices', async () => {
    const input = inputOf({});
    const failure = failureOf(await input.listDevices());
    expect(failure.code).toBe('media-input.unsupported');
    expect(failure.summary).toBe('This browser does not offer a list of its audio inputs.');
    expect(input.watchDevices(unused)).toBeTypeOf('function');
  });

  it('says an insecure page is the reason, though the devices are there', async () => {
    const devices = new FakeMediaDevices(unused);
    const input = inputOf({ mediaDevices: devices }, { isSecureContext: false });
    const failure = failureOf(await input.listDevices());
    expect(failure.code).toBe('media-input.insecure-context');
    expect(devices.listings).toBe(0);
  });
});

describe('the supported constraints', () => {
  it('are the capture constraints the browser recognises, and no others', () => {
    const supported: MediaTrackSupportedConstraints = {
      deviceId: true,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: false,
      channelCount: true,
      sampleRate: true,
      width: true,
      frameRate: true,
    };
    Reflect.set(supported, 'voiceIsolation', true);
    const devices = new FakeMediaDevices(unused, unused, supported);
    expect(inputOf({ mediaDevices: devices }).supportedConstraints).toEqual({
      deviceId: true,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: false,
      voiceIsolation: true,
      channelCount: true,
      sampleRate: true,
      sampleSize: false,
      latency: false,
    });
  });

  it('are not known where the browser has no media devices', () => {
    expect(inputOf({}).supportedConstraints).toBeUndefined();
  });
});

/** Media devices that open a stream of one audio track reporting `settings`. */
function opening(settings: MediaTrackSettings = {}, label = 'Studio interface') {
  const track = new FakeTrack(label, settings);
  const devices = new FakeMediaDevices(unused, () => Promise.resolve(new FakeStream([track])));
  return { track, devices, input: inputOf({ mediaDevices: devices }) };
}

describe('opening an input', () => {
  it('asks for audio alone, requiring the device and asking every other value as ideal', async () => {
    const { devices, input } = opening();
    expectSuccess(
      await input.open({
        deviceId: 'mic-1',
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        voiceIsolation: false,
        channelCount: 2,
        sampleRate: 48_000,
        sampleSize: 24,
        latency: 0.01,
      }),
    );
    expect(devices.asked).toEqual([
      {
        audio: {
          deviceId: { exact: 'mic-1' },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          voiceIsolation: false,
          channelCount: 2,
          sampleRate: 48_000,
          sampleSize: 24,
          latency: 0.01,
        },
        video: false,
      },
    ]);
  });

  it('passes nothing a request leaves to the browser', async () => {
    const { devices, input } = opening();
    expectSuccess(await input.open({ echoCancellation: true }));
    expect(devices.asked).toEqual([{ audio: { echoCancellation: true }, video: false }]);
  });

  it('reads what was granted from the track, not from what was asked', async () => {
    const settings: MediaTrackSettings = {
      deviceId: 'mic-1',
      groupId: 'interface',
      noiseSuppression: false,
      autoGainControl: true,
      channelCount: 1,
      sampleRate: 44_100,
      sampleSize: 16,
    };
    // What a newer browser reports, which the type definitions do not yet know.
    Reflect.set(settings, 'echoCancellation', 'remote-only');
    Reflect.set(settings, 'voiceIsolation', false);
    Reflect.set(settings, 'latency', Number.NaN);
    const { input } = opening(settings);
    const opened = expectSuccess(await input.open({ channelCount: 2, sampleRate: 48_000 }));
    expect(opened.settings).toEqual({
      deviceId: 'mic-1',
      groupId: 'interface',
      echoCancellation: true,
      noiseSuppression: false,
      autoGainControl: true,
      voiceIsolation: false,
      channelCount: 1,
      sampleRate: 44_100,
      sampleSize: 16,
      latency: undefined,
    });
  });

  it("gives the track's label, and none where the browser gives an empty one", async () => {
    expect(expectSuccess(await opening({}, 'Headset').input.open({})).label).toBe('Headset');
    expect(expectSuccess(await opening({}, '').input.open({})).label).toBeUndefined();
  });

  const refusals: readonly { name: string; code: string }[] = [
    { name: 'NotAllowedError', code: 'media-input.not-allowed' },
    { name: 'SecurityError', code: 'media-input.not-allowed' },
    { name: 'NotFoundError', code: 'media-input.not-found' },
    { name: 'OverconstrainedError', code: 'media-input.overconstrained' },
    { name: 'NotReadableError', code: 'media-input.not-readable' },
    { name: 'AbortError', code: 'media-input.not-readable' },
  ];

  for (const { name, code } of refusals) {
    it(`fails with ${code} where the browser refuses with ${name}`, async () => {
      const devices = new FakeMediaDevices(unused, () =>
        Promise.reject(new DOMException('Refused.', name)),
      );
      const failure = failureOf(await inputOf({ mediaDevices: devices }).open({}));
      expect(failure.code).toBe(code);
      expect(failure.summary).toMatch(/^[A-Z].*\.$/u);
    });
  }

  it('names the constraint an older browser could not meet, refused as an object of its own', async () => {
    const legacy = Object.assign(new Error('Overconstrained.'), {
      name: 'OverconstrainedError',
      constraint: 'deviceId',
    });
    const devices = new FakeMediaDevices(unused, () => Promise.reject(legacy));
    const failure = failureOf(await inputOf({ mediaDevices: devices }).open({}));
    expect(failure).toMatchObject({
      code: 'media-input.overconstrained',
      details: { constraint: 'deviceId' },
    });
  });

  it('lets a fault through rather than calling it a refusal', async () => {
    const devices = new FakeMediaDevices(unused, () => Promise.reject(new TypeError('A fault.')));
    await expect(inputOf({ mediaDevices: devices }).open({})).rejects.toThrow(TypeError);
  });

  it('fails without asking on an insecure page, and where the browser cannot open inputs', async () => {
    const devices = new FakeMediaDevices(unused);
    const insecure = inputOf({ mediaDevices: devices }, { isSecureContext: false });
    expect(failureOf(await insecure.open({})).code).toBe('media-input.insecure-context');
    expect(devices.asked).toEqual([]);
    expect(failureOf(await inputOf({}).open({})).code).toBe('media-input.unsupported');
  });

  it('fails, and releases the stream, where the browser gives no audio track', async () => {
    const video = new FakeTrack('Camera', {}, 'video');
    const devices = new FakeMediaDevices(unused, () => Promise.resolve(new FakeStream([video])));
    expect(failureOf(await inputOf({ mediaDevices: devices }).open({})).code).toBe(
      'media-input.no-audio-track',
    );
    expect(video.stops).toBe(1);
  });

  it('releases an input given after the opening was cancelled', async () => {
    const { track, input } = opening();
    const source = createCancellationSource();
    const opened = input.open({}, source.signal);
    source.cancel();
    await expect(opened).rejects.toBeInstanceOf(Cancelled);
    expect(track.stops).toBe(1);
  });
});

describe('an open input', () => {
  it('reports its ending, as an unplugged device ends it, until the watch stops', async () => {
    const { track, input } = opening();
    const opened = expectSuccess(await input.open({}));
    let endings = 0;
    const stop = opened.watchEnded(() => {
      endings += 1;
    });
    track.raise('ended');
    stop();
    track.raise('ended');
    expect(endings).toBe(1);
  });

  it('reports an ending that came before the watch began', async () => {
    const { track, input } = opening();
    const opened = expectSuccess(await input.open({}));
    track.raise('ended');
    let endings = 0;
    opened.watchEnded(() => {
      endings += 1;
    });
    expect(endings).toBe(1);
  });

  it('reports the browser muting and unmuting it, until the watch stops', async () => {
    const { track, input } = opening();
    const opened = expectSuccess(await input.open({}));
    const heard: boolean[] = [];
    const stop = opened.watchMuted((muted) => heard.push(muted));
    track.raise('mute');
    expect(opened.isMuted()).toBe(true);
    track.raise('unmute');
    stop();
    track.raise('mute');
    expect(heard).toEqual([true, false]);
  });

  it('releases every track when stopped', async () => {
    const audio = new FakeTrack('Interface', {});
    const second = new FakeTrack('Interface', {});
    const devices = new FakeMediaDevices(unused, () =>
      Promise.resolve(new FakeStream([audio, second])),
    );
    const opened = expectSuccess(await inputOf({ mediaDevices: devices }).open({}));
    opened.stop();
    expect([audio.stops, second.stops]).toEqual([1, 1]);
  });

  it('hands the browser stream over unchanged, for the audio runtime', async () => {
    const stream = new FakeStream([new FakeTrack('Interface', {})]);
    const devices = new FakeMediaDevices(unused, () => Promise.resolve(stream));
    expect(expectSuccess(await inputOf({ mediaDevices: devices }).open({})).stream).toBe(stream);
  });
});
