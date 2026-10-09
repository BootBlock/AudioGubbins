/**
 * The output the page plays through, as an `OutputDeviceDescriptor`, and its
 * changes (ADR-0070).
 *
 * Recording needs the output to judge whether monitoring may feed the
 * microphone and to keep a latency calibration per output. Choosing an output
 * is Phase 14's, so the audio context plays to the system's default output,
 * and the browser describes that one in the entry it lists under the
 * identifier `default`. Chromium lists one; Firefox lists outputs only behind
 * a preference or after the person picks one, and Safari lists none, so where
 * no such entry is listed, or it names no device, the output is `undefined`:
 * the browser cannot say which device plays, and none is guessed.
 *
 * A label is personal data: it is handed to the person's own views and never
 * written to a log (REQ-PRIV-165).
 */

import { given } from './browser-reads.js';
import { watchDeviceList } from './device-list-watch.js';

/** The identifier browsers list the system's default output under. */
const SYSTEM_DEFAULT = 'default';

/**
 * The identifiers Chromium lists a role under rather than a device: the
 * default output, and on Windows the default for calls.
 */
const ROLES: ReadonlySet<string> = new Set([SYSTEM_DEFAULT, 'communications']);

/** The output the page plays through, as the browser describes it. */
export interface OutputDeviceDescriptor {
  /**
   * The device's own identifier, where the browser lists it apart from the
   * default's entry and its group tells which it is; `undefined` otherwise,
   * since `default` names whichever device the system plays to.
   */
  readonly deviceId: string | undefined;

  /** The physical device the output belongs to, shared with its inputs; `undefined` where withheld. */
  readonly groupId: string | undefined;

  /** What the device calls itself; `undefined` until the microphone is allowed. */
  readonly label: string | undefined;
}

/**
 * The output the page plays through, or `undefined` where the browser cannot
 * say which it is. The default's entry gives the group and the label; the one
 * other output listed in that group is the device itself, and gives its own
 * identifier and name. A group of several outputs, such as an interface's
 * pairs, does not say which of them is the default, so none is taken.
 */
export async function readPlayingOutput(
  devices: MediaDevices,
): Promise<OutputDeviceDescriptor | undefined> {
  const outputs = (await devices.enumerateDevices()).filter(
    (device) => device.kind === 'audiooutput',
  );
  const entry = outputs.find((device) => device.deviceId === SYSTEM_DEFAULT);
  if (entry === undefined) return undefined;
  const groupId = given(entry.groupId);
  const label = given(entry.label);
  // An entry whose group and label are withheld names no device.
  if (groupId === undefined && label === undefined) return undefined;
  const grouped =
    groupId === undefined
      ? []
      : outputs.filter((device) => device.groupId === groupId && !ROLES.has(device.deviceId));
  const [device] = grouped;
  return grouped.length === 1 && device !== undefined && given(device.deviceId) !== undefined
    ? { deviceId: device.deviceId, groupId, label: given(device.label) ?? label }
    : { deviceId: undefined, groupId, label };
}

/**
 * Calls `changed` with the output the page plays through whenever the browser
 * says its devices changed, and answers how to stop.
 */
export function watchPlayingOutput(
  devices: MediaDevices,
  changed: (output: OutputDeviceDescriptor | undefined) => void,
): () => void {
  return watchDeviceList(devices, readPlayingOutput, changed);
}
