/**
 * Keeping a device's name out of the log (REQ-PRIV-161, REQ-PRIV-165,
 * ADR-0070).
 *
 * The name a browser gives an audio input or output is chosen by its maker or
 * its owner and often names the owner, as "Jane's AirPods" does, so it is
 * personal data, and it never enters a log or a diagnostic bundle by default. A
 * name has no shape a text pattern could find, so, as a machine's name is in a
 * bundle, it is found by the field that holds it and replaced whole. It is
 * replaced as the record is made, not when a bundle is assembled, so the log
 * kept on the machine holds none either, whichever thread logged it.
 *
 * This is a safety net under the rule the recording code keeps, which is to
 * put no device's name into a log at all: a name written into a message is
 * not found here.
 */

import type { LogFieldValue, LogFields } from './log-record.js';
import { fieldWords } from './text-runs.js';

/** What a device's name is replaced with, so a reader sees that one was there. */
const DEVICE_LABEL_PLACEHOLDER = '<device>';

/** A word before `label` or `name` that makes the field a device's name: `deviceLabel`, `inputName`. */
const DEVICE_WORDS: ReadonlySet<string> = new Set([
  'device',
  'input',
  'output',
  'microphone',
  'mic',
  'speaker',
  'speakers',
  'headphones',
  'headset',
  'interface',
]);

/** The last word of a field that holds a name. */
const NAME_WORDS: ReadonlySet<string> = new Set(['label', 'name']);

/** Whether a field's name says it holds a device's name. */
function namesADeviceLabel(name: string): boolean {
  const words = fieldWords(name);
  return NAME_WORDS.has(words.at(-1) ?? '') && DEVICE_WORDS.has(words.at(-2) ?? '');
}

/** `fields` with every device's name replaced, the same object where none is. */
export function withoutDeviceLabels(fields: LogFields): LogFields {
  if (!Object.keys(fields).some(namesADeviceLabel)) return fields;
  return Object.fromEntries(
    Object.entries(fields).map(([name, value]): [string, LogFieldValue] => [
      name,
      namesADeviceLabel(name) && value !== '' ? DEVICE_LABEL_PLACEHOLDER : value,
    ]),
  );
}
