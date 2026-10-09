/**
 * The output the page plays through, as the recording part knows it
 * (`ADR-0070`).
 *
 * Choosing an output is Phase 14's, so the context plays to the system's
 * default output, which browsers list under the identifier `default`. The
 * capabilities' media input adapter lists inputs only, so the default output's
 * group and name are not known here: a calibration is kept for this one output
 * identity, and the feedback risk of monitoring cannot be judged from the
 * output's name, so it is taken as possible (`monitoring-control.ts`).
 */

import type { DeviceIdentity } from '@audiogubbins/recording';

/** The system's default output, the one the context plays to. */
export const SYSTEM_OUTPUT: DeviceIdentity = { id: 'default' };
