/**
 * What a capture asks of the browser's audio input, and what it was granted.
 *
 * A capture profile is the recording package's, which knows no browser
 * (ADR-0070), so it reaches here as a plain `CaptureRequest` and leaves as the
 * constraints `getUserMedia` takes. Each value but the device is asked for as
 * the browser's ideal rather than required: a browser that cannot turn its echo
 * cancellation off still opens the input, and the difference shows in the
 * settings granted, which are read from the track and never assumed
 * (REQ-REC-092). The device is required, since an input other than the one
 * chosen is no answer to the choice.
 *
 * `voiceIsolation` and the newer string forms of `echoCancellation` are absent
 * from the DOM type definitions, so the browser's answers are read through
 * `Reflect` and checked.
 */

import { method } from './browser-reads.js';

/** A constraint a capture profile sets, the only ones this adapter passes or reports. */
export type CaptureConstraintName =
  | 'deviceId'
  | 'echoCancellation'
  | 'noiseSuppression'
  | 'autoGainControl'
  | 'voiceIsolation'
  | 'channelCount'
  | 'sampleRate'
  | 'sampleSize'
  | 'latency';

/** Whether the browser recognises each constraint a capture profile sets. */
export type SupportedCaptureConstraints = Readonly<Record<CaptureConstraintName, boolean>>;

/** What a capture asks of the input; a value left out is left to the browser. */
export interface CaptureRequest {
  /** The device's identifier, which the input must be. */
  readonly deviceId?: string;
  readonly echoCancellation?: boolean;
  readonly noiseSuppression?: boolean;
  readonly autoGainControl?: boolean;
  readonly voiceIsolation?: boolean;
  readonly channelCount?: number;
  readonly sampleRate?: number;
  readonly sampleSize?: number;

  /** In seconds. */
  readonly latency?: number;
}

/** What the browser granted, as the track reports it; `undefined` where it reports nothing. */
export interface GrantedCaptureSettings {
  readonly deviceId: string | undefined;
  readonly groupId: string | undefined;
  readonly echoCancellation: boolean | undefined;
  readonly noiseSuppression: boolean | undefined;
  readonly autoGainControl: boolean | undefined;
  readonly voiceIsolation: boolean | undefined;
  readonly channelCount: number | undefined;
  readonly sampleRate: number | undefined;
  readonly sampleSize: number | undefined;

  /** In seconds. */
  readonly latency: number | undefined;
}

/** The constraints `getUserMedia` takes, with the one it does not yet type. */
type AudioConstraints = MediaTrackConstraints & { readonly voiceIsolation?: boolean };

/**
 * The audio constraints of a request: the device required, every other value
 * ideal, and nothing the request leaves out.
 */
export function audioConstraintsOf(request: CaptureRequest): AudioConstraints {
  return {
    ...(request.deviceId === undefined ? {} : { deviceId: { exact: request.deviceId } }),
    ...(request.echoCancellation === undefined
      ? {}
      : { echoCancellation: request.echoCancellation }),
    ...(request.noiseSuppression === undefined
      ? {}
      : { noiseSuppression: request.noiseSuppression }),
    ...(request.autoGainControl === undefined ? {} : { autoGainControl: request.autoGainControl }),
    ...(request.voiceIsolation === undefined ? {} : { voiceIsolation: request.voiceIsolation }),
    ...(request.channelCount === undefined ? {} : { channelCount: request.channelCount }),
    ...(request.sampleRate === undefined ? {} : { sampleRate: request.sampleRate }),
    ...(request.sampleSize === undefined ? {} : { sampleSize: request.sampleSize }),
    ...(request.latency === undefined ? {} : { latency: request.latency }),
  };
}

/**
 * Which capture constraints the browser recognises, or `undefined` where it
 * cannot say. Recognised is not granted: a browser may know a constraint and
 * still be unable to meet it on a given device.
 */
export function readSupportedConstraints(devices: object): SupportedCaptureConstraints | undefined {
  const ask = method(devices, 'getSupportedConstraints');
  if (ask === undefined) return undefined;
  const answer = ask();
  if (typeof answer !== 'object' || answer === null) return undefined;
  const supported = (name: CaptureConstraintName): boolean => Reflect.get(answer, name) === true;
  return {
    deviceId: supported('deviceId'),
    echoCancellation: supported('echoCancellation'),
    noiseSuppression: supported('noiseSuppression'),
    autoGainControl: supported('autoGainControl'),
    voiceIsolation: supported('voiceIsolation'),
    channelCount: supported('channelCount'),
    sampleRate: supported('sampleRate'),
    sampleSize: supported('sampleSize'),
    latency: supported('latency'),
  };
}

/** A setting's value where it is a non-empty string. */
function textSetting(settings: object, name: string): string | undefined {
  const value: unknown = Reflect.get(settings, name);
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * A processing setting where it is a boolean, or for echo cancellation one of
 * the strings that name which echo it cancels, every one of which cancels.
 */
function switchSetting(settings: object, name: string): boolean | undefined {
  const value: unknown = Reflect.get(settings, name);
  if (typeof value === 'boolean') return value;
  if (name === 'echoCancellation' && (value === 'all' || value === 'remote-only')) return true;
  return undefined;
}

/** A numeric setting where it is a finite number. */
function numberSetting(settings: object, name: string): number | undefined {
  const value: unknown = Reflect.get(settings, name);
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** The settings a track reports it was granted. */
export function grantedSettingsOf(track: MediaStreamTrack): GrantedCaptureSettings {
  const settings: object = track.getSettings();
  return {
    deviceId: textSetting(settings, 'deviceId'),
    groupId: textSetting(settings, 'groupId'),
    echoCancellation: switchSetting(settings, 'echoCancellation'),
    noiseSuppression: switchSetting(settings, 'noiseSuppression'),
    autoGainControl: switchSetting(settings, 'autoGainControl'),
    voiceIsolation: switchSetting(settings, 'voiceIsolation'),
    channelCount: numberSetting(settings, 'channelCount'),
    sampleRate: numberSetting(settings, 'sampleRate'),
    sampleSize: numberSetting(settings, 'sampleSize'),
    latency: numberSetting(settings, 'latency'),
  };
}
