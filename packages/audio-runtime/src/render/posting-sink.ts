/**
 * A render sink in the worker that posts each chunk to the main thread.
 *
 * The renderer overwrites a block once its write settles, so each chunk is
 * copied into arrays of its own, and those are transferred rather than copied
 * a second time by the structured clone. A write first claims a slot of the
 * job's window, so it waits while the main thread still holds as many chunks
 * as the window allows.
 */

import type { NodeId } from '@audiogubbins/audio-graph';
import type { AudioFrameBlock, RenderSink } from '@audiogubbins/audio-engine';

import type { CancellationSignal } from '@audiogubbins/domain';

import { FromRenderWorkerKind, type FromRenderWorker } from '../protocol/render-messages.js';
import type { ChunkWindow } from './chunk-window.js';

/** How a worker sends a message, with the buffers it gives up. */
export type PostToHost = (message: FromRenderWorker, transfer: Transferable[]) => void;

/** What a posting sink belongs to. */
export interface PostingJob {
  readonly jobId: string;
  readonly window: ChunkWindow;
  /** The job's cancellation, which a write waiting for a slot hears. */
  readonly signal: CancellationSignal;
  readonly post: PostToHost;
}

/** A sink that posts `node`'s chunks for `job`. */
export function postingSink(node: NodeId, job: PostingJob): RenderSink {
  return {
    write: async (block: AudioFrameBlock) => {
      await job.window.claim(job.signal);
      const channels = block.channels.map((channel) => channel.slice(0, block.frames));
      job.post(
        { kind: FromRenderWorkerKind.Chunk, jobId: job.jobId, node, channels },
        channels.map((channel) => channel.buffer),
      );
    },
  };
}
