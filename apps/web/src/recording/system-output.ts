/**
 * The output the page plays through, as the recording package knows it
 * (`ADR-0070`).
 *
 * Choosing an output is Phase 14's, so the context plays to the system's
 * default output, which the capabilities' media input adapter describes where
 * the browser lists it. Where it does not, the output is the recording
 * package's unknown output, never a device stood in for it: a calibration is
 * kept for the unknown output, and the feedback risk of monitoring is stated
 * as unknown rather than judged.
 */

import type { OutputDeviceDescriptor } from '@audiogubbins/capabilities';
import { UNKNOWN_OUTPUT, type OutputIdentity } from '@audiogubbins/recording';

/**
 * The identity of the output `output` describes, or the unknown output where
 * the browser cannot say which it is. An output listed without an identifier
 * of its own is known by its group and label (`isSameDevice`).
 */
export function outputIdentityOf(output: OutputDeviceDescriptor | undefined): OutputIdentity {
  if (output === undefined) return UNKNOWN_OUTPUT;
  return {
    kind: 'known',
    device: {
      id: output.deviceId ?? '',
      ...(output.groupId === undefined ? {} : { group: output.groupId }),
      ...(output.label === undefined ? {} : { label: output.label }),
    },
  };
}
