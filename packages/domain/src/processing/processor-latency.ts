/**
 * How many frames later a processor's output is than its input.
 *
 * REQ-ARCH-144 requires a processor to report its latency accurately or to say
 * that it cannot. An unknown latency carries the reason, because nothing may
 * align parallel paths around a number nobody knows, and the person reading
 * that refusal needs to know which processor to change. The one definition the
 * application has: a processor's descriptor declares it, a chain's is found
 * from its processors', and the processing graph carries it through every path
 * (ADR-0030), so none of them can disagree about what a latency is.
 */

import type { SampleCount } from '../time/sample-time.js';

/** Frames of delay a processor introduces, or that it cannot say, and why. */
export type ProcessorLatency =
  | { readonly kind: 'known'; readonly frames: SampleCount }
  | { readonly kind: 'unknown'; readonly reason: string };
