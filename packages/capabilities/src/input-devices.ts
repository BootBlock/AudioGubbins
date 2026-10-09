/**
 * The audio inputs the browser lists, as `InputDeviceDescriptor` values, and
 * their changes (ADR-0070).
 *
 * Before the microphone is allowed, a browser lists inputs with no label and
 * may withhold their identifiers too, so each is `undefined` where it is
 * withheld rather than an empty string a caller might take for a name. A
 * device identifier is not taken to last: the recording package finds a
 * remembered device again by its identifier, then by its group and label.
 * `getCapabilities` is Chromium's, and is read only where an input offers it.
 *
 * A label is personal data: it is handed to the person's own views and kept in
 * a take's provenance, and never written to a log (REQ-PRIV-165).
 */

import { given, method } from './browser-reads.js';
import { watchDeviceList } from './device-list-watch.js';

/** The least and the most of a value an input reports it can give. */
export interface ValueRange {
  readonly min: number;
  readonly max: number;
}

/** An audio input as the browser lists it. */
export interface InputDeviceDescriptor {
  /** `undefined` where the browser withholds it until the microphone is allowed. */
  readonly deviceId: string | undefined;

  /** The physical device this input belongs to, shared with its outputs; `undefined` where withheld. */
  readonly groupId: string | undefined;

  /** What the device calls itself; `undefined` until the microphone is allowed. */
  readonly label: string | undefined;

  /** The channel counts the input reports it can give, where it reports them. */
  readonly channelCounts: ValueRange | undefined;

  /** The sample rates the input reports it can give, where it reports them. */
  readonly sampleRates: ValueRange | undefined;
}

/** A range in a capabilities answer, where it is two finite numbers in order. */
function rangeIn(capabilities: unknown, name: string): ValueRange | undefined {
  if (typeof capabilities !== 'object' || capabilities === null) return undefined;
  const range: unknown = Reflect.get(capabilities, name);
  if (typeof range !== 'object' || range === null) return undefined;
  const min: unknown = Reflect.get(range, 'min');
  const max: unknown = Reflect.get(range, 'max');
  if (typeof min !== 'number' || typeof max !== 'number') return undefined;
  return Number.isFinite(min) && Number.isFinite(max) && min <= max ? { min, max } : undefined;
}

/** The descriptor of one listed device. */
function descriptorOf(device: MediaDeviceInfo): InputDeviceDescriptor {
  const capabilities = method(device, 'getCapabilities')?.();
  return {
    deviceId: given(device.deviceId),
    groupId: given(device.groupId),
    label: given(device.label),
    channelCounts: rangeIn(capabilities, 'channelCount'),
    sampleRates: rangeIn(capabilities, 'sampleRate'),
  };
}

/** The audio inputs `devices` lists now, in the browser's order. */
export async function listInputDevices(
  devices: MediaDevices,
): Promise<readonly InputDeviceDescriptor[]> {
  const listed = await devices.enumerateDevices();
  return listed.filter((device) => device.kind === 'audioinput').map(descriptorOf);
}

/**
 * Calls `changed` with the audio inputs whenever the browser says its devices
 * changed, and answers how to stop.
 */
export function watchInputDevices(
  devices: MediaDevices,
  changed: (inputs: readonly InputDeviceDescriptor[]) => void,
): () => void {
  return watchDeviceList(devices, listInputDevices, changed);
}
