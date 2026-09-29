/**
 * Sources, sinks and jobs for the engine's render tests.
 *
 * A render test binds sources and sinks by node name to a graph stated with
 * the graph builders, and reads back every frame a sink was written, so each
 * test is about what it renders rather than how a job is put together.
 */

import { sampleCount, sampleRate, type ChannelLayout, type SampleRate } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import type { GraphDescriptor } from '@audiogubbins/audio-graph';

import { MAXIMUM_RENDER_QUALITY, type RenderJob, type RenderSink } from '../render/render-job.js';
import { frameBlock, type AudioFrameBlock } from '../pcm/frame-block.js';
import { memorySource } from '../pcm/memory-source.js';
import type { PcmSource } from '../pcm/pcm-source.js';
import { distinctChannels, named } from './graph-builders.js';

const RENDER_RATE: SampleRate = expectSuccess(sampleRate(48_000));

/**
 * A block of `frames` frames whose channels all differ and are exact in f32:
 * channel `c` at frame `i` is `((c + 1) · 1000 + i % 4096) / 65536`.
 */
export function distinctAudio(
  layout: ChannelLayout,
  frames: number,
  rate: SampleRate = RENDER_RATE,
): AudioFrameBlock {
  return expectSuccess(frameBlock(layout, rate, distinctChannels(layout, frames)));
}

export function sourceOf(block: AudioFrameBlock): PcmSource {
  return expectSuccess(memorySource(block));
}

/** A sink that keeps every frame written to it, one array per channel. */
export interface CollectingSink extends RenderSink {
  readonly channels: () => readonly Float32Array[];
  readonly writes: () => number;
}

export function collectingSink(): CollectingSink {
  const parts: Float32Array[][] = [];
  let writes = 0;
  return {
    write: (block) => {
      writes += 1;
      block.channels.forEach((channel, index) => {
        (parts[index] ??= []).push(channel.slice(0, block.frames));
      });
      return Promise.resolve();
    },
    channels: () =>
      parts.map((pieces) => {
        const whole = new Float32Array(pieces.reduce((total, piece) => total + piece.length, 0));
        let at = 0;
        for (const piece of pieces) {
          whole.set(piece, at);
          at += piece.length;
        }
        return whole;
      }),
    writes: () => writes,
  };
}

/** A job over the given graph, binding sources and sinks by node name. */
export function jobOf(
  graph: GraphDescriptor,
  bindings: {
    readonly sources?: Readonly<Record<string, PcmSource>>;
    readonly sinks: Readonly<Record<string, RenderSink>>;
    readonly length: number;
    readonly start?: number;
    readonly chunkFrames?: number;
  },
): RenderJob {
  return {
    graph,
    sampleRate: RENDER_RATE,
    sources: new Map(
      Object.entries(bindings.sources ?? {}).map(([node, source]) => [named(node), source]),
    ),
    sinks: new Map(Object.entries(bindings.sinks).map(([node, sink]) => [named(node), sink])),
    range: {
      start: expectSuccess(sampleCount(bindings.start ?? 0)),
      length: expectSuccess(sampleCount(bindings.length)),
    },
    quality: MAXIMUM_RENDER_QUALITY,
    chunkFrames: bindings.chunkFrames ?? 4_096,
  };
}
