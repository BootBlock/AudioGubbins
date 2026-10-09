/**
 * The audio of a graph input, described for another thread to make.
 *
 * The description itself is the engine's (`PcmDescription`, ADR-0045); a graph
 * input's names the node it feeds.
 *
 * A source object cannot cross a thread, so the main thread describes each
 * graph input's audio and the thread that reads it makes it: a render worker
 * for a render (`render-messages.ts`), and the feeder worker for real-time
 * playback (`feeder-messages.ts`). Recorded audio crosses as its planar arrays,
 * transferred rather than copied, so a long clip is never held twice (the
 * packet's "large media processing must avoid whole-file duplication"); its
 * layout is the graph input's port's, which the receiving thread reads from the
 * graph, so no layout crosses the wire to disagree with it. Generated audio
 * crosses as its signal recipe, and the receiving thread makes it from its own
 * canonical DSP (ADR-0045).
 */

import type { NodeId } from '@audiogubbins/audio-graph';
import {
  describedBuffers,
  pcmDescriptionOf,
  type PcmDescription,
} from '@audiogubbins/audio-engine';

import type { MessageFields } from '@audiogubbins/domain';
import { nodeAt } from './message-reading.js';

/** The audio one graph input reads, as it crosses to the worker. */
export type SourceDescription = PcmDescription & { readonly node: NodeId };

/** Each distinct buffer behind the recorded audio's arrays, to transfer rather than copy. */
export function sourceTransferables(sources: readonly SourceDescription[]): Transferable[] {
  return [...describedBuffers(sources)];
}

/** A source's description, named `field`, read field by field. */
export function sourceFrom(fields: MessageFields, field: string): SourceDescription {
  return { ...pcmDescriptionOf(fields, field), node: nodeAt(fields, 'node') };
}
