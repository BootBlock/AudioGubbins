/**
 * The audio of a graph input, described for another thread to make.
 *
 * A source object cannot cross a thread, so the main thread describes each
 * graph input's audio and the thread that reads it makes it: a render worker
 * for a render (`render-messages.ts`), and the feeder worker for real-time
 * playback (`feeder-messages.ts`). Recorded audio crosses as its planar
 * arrays, transferred rather than copied, so a long clip is never held twice
 * (the packet's "large media processing must avoid whole-file duplication");
 * its layout is the graph input's port's, which the receiving thread reads
 * from the graph, so no layout crosses the wire to disagree with it. A tone is
 * made by the receiving thread from its own canonical DSP.
 */

import type { SampleCount, SampleRate } from '@audiogubbins/domain';
import type { NodeId } from '@audiogubbins/audio-graph';

import {
  channelsAt,
  nodeAt,
  numberAt,
  oneOf,
  rateAt,
  samplesAt,
  type Fields,
} from './message-reading.js';

/** How a graph input's audio is described. */
export const SourceKind = {
  /** Audio in memory: a decoded clip's planar samples. */
  Pcm: 'pcm',
  /** A test tone the worker makes itself from the canonical oscillator. */
  Tone: 'tone',
} as const;

export type SourceKind = (typeof SourceKind)[keyof typeof SourceKind];

/** The audio one graph input reads, as it crosses to the worker. */
export type SourceDescription =
  | {
      readonly node: NodeId;
      readonly kind: typeof SourceKind.Pcm;
      readonly sampleRate: SampleRate;
      /**
       * One array per channel of the input's port, in its order, all the same
       * length. Transferred: the sender's arrays are detached once posted.
       */
      readonly channels: readonly Float32Array[];
    }
  | {
      readonly node: NodeId;
      readonly kind: typeof SourceKind.Tone;
      readonly sampleRate: SampleRate;
      readonly frequency: number;
      readonly amplitude: number;
      readonly frames: SampleCount;
    };

/**
 * Each distinct buffer behind the recorded audio's arrays, to transfer rather
 * than copy. A shared buffer is not transferred but shared, and two channels
 * that view one buffer must list it once, or the post is refused.
 */
export function sourceTransferables(sources: readonly SourceDescription[]): Transferable[] {
  const buffers = new Set<ArrayBuffer>();
  for (const source of sources) {
    if (source.kind !== SourceKind.Pcm) continue;
    for (const channel of source.channels) {
      if (channel.buffer instanceof ArrayBuffer) buffers.add(channel.buffer);
    }
  }
  return [...buffers];
}

/** A source's description, read field by field. */
export function sourceFrom(fields: Fields): SourceDescription {
  const node = nodeAt(fields, 'node');
  const rate = rateAt(fields, 'sampleRate');
  const kind = oneOf(fields, 'kind', SourceKind);
  switch (kind) {
    case SourceKind.Pcm:
      return { node, kind, sampleRate: rate, channels: channelsAt(fields, 'channels') };
    case SourceKind.Tone:
      return {
        node,
        kind,
        sampleRate: rate,
        frequency: numberAt(fields, 'frequency'),
        amplitude: numberAt(fields, 'amplitude'),
        frames: samplesAt(fields, 'frames'),
      };
  }
}
