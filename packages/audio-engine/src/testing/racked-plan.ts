/**
 * A sound heard through a rack, as the tests of whatever reads processed
 * streams build one: a plan whose first stream reads the whole of a second,
 * which reads an asset's file through a chain, as an asset's rack makes it
 * (ADR-0060), and the file itself, held in memory as a WAV file.
 */

import { writeWav } from '@audiogubbins/codecs/testing';
import {
  StandardLayouts,
  derivedSampleCount,
  unsafeBrandId,
  type AssetId,
  type ChannelLayout,
  type EditPlan,
  type EffectChain,
  type SampleRate,
} from '@audiogubbins/domain';

import type { MediaFile } from '../pcm/media-file.js';
import type { MediaEntry } from '../pcm/plan-content.js';

/** The asset every racked plan here reads. */
export const RACKED_ASSET: AssetId = unsafeBrandId<'AssetId'>('0000eeee-7ac0');

/** A file in memory, read as a browser file is, a range at a time. */
export function memoryFile(bytes: Uint8Array): MediaFile {
  return {
    size: bytes.length,
    slice: (start, end) => ({ arrayBuffer: () => Promise.resolve(bytes.slice(start, end).buffer) }),
  };
}

/**
 * `samples`, one array per channel, as the file of {@link RACKED_ASSET}: a
 * WAV file's bytes, held by `fileOf`, which a test that posts the file to
 * another thread makes a browser file of.
 */
export function rackedMedia(
  samples: readonly Float32Array[],
  sampleRate: SampleRate,
  identity = 'memory:racked',
  fileOf: (bytes: Uint8Array<ArrayBuffer>) => MediaFile = memoryFile,
): MediaEntry {
  return {
    asset: RACKED_ASSET,
    identity,
    sampleRate,
    channels: samples.length,
    length: derivedSampleCount(samples[0]?.length ?? 0),
    file: fileOf(
      new Uint8Array(
        writeWav({ sampleRate, encoding: { kind: 'float', bits: 32 }, channels: samples }),
      ),
    ),
  };
}

/**
 * The plan of {@link RACKED_ASSET}'s `length` frames heard through `chain`:
 * stream 0 reads the whole of stream 1, which reads the file through it.
 */
export function rackedPlan(
  chain: EffectChain,
  length: number,
  sampleRate: SampleRate,
  layout: ChannelLayout = StandardLayouts.mono,
): EditPlan {
  const frames = derivedSampleCount(length);
  const whole = { start: derivedSampleCount(0), length: frames, reversed: false, stages: [] };
  return {
    streams: [
      { sampleRate, layout, segments: [{ ...whole, source: { kind: 'stream', stream: 1 } }] },
      {
        sampleRate,
        layout,
        segments: [{ ...whole, source: { kind: 'media', asset: RACKED_ASSET } }],
        processing: { kind: 'chain', chain, input: layout },
      },
    ],
  };
}
