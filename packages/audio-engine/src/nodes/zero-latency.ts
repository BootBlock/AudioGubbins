/**
 * The latency of a node whose output is not late: every built-in type but a
 * delay that stands for a lookahead.
 */

import { ZERO_SAMPLES } from '@audiogubbins/domain';
import type { ProcessorLatency } from '@audiogubbins/audio-graph';

/** No frames of latency, known. */
export const ZERO_LATENCY: ProcessorLatency = { kind: 'known', frames: ZERO_SAMPLES };
