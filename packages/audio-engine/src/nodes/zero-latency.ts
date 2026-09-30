/**
 * The latency of a node whose output is not late: every built-in type but a
 * delay that stands for a lookahead.
 */

import { ZERO_SAMPLES, type ProcessorLatency } from '@audiogubbins/domain';

/** No frames of latency, known. */
export const ZERO_LATENCY: ProcessorLatency = { kind: 'known', frames: ZERO_SAMPLES };
