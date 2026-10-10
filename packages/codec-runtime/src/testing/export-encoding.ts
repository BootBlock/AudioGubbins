/**
 * An export's encoder driven whole, for a test: a reproducible test signal,
 * the request and services an export is opened with, the file written in
 * blocks, and the error of a decoded file against its source.
 */

import { writeWhole } from '@audiogubbins/codecs/testing';
import {
  StandardLayouts,
  sampleRate,
  succeed,
  type CancellationSignal,
  type ChannelLayout,
  type SampleRate,
} from '@audiogubbins/domain';
import { exportTarget, type FormatEncoding } from '@audiogubbins/import-export';

import type { DecoderSession } from '../decoder-session.js';
import type { ExportEncodeRequest } from '../worker/codec-worker-messages.js';
import type { ExportEncoderServices } from '../worker/encode-job.js';
import { openExportEncoder } from '../encoding/open-export-encoder.js';
import { codecModule } from './codec-module.js';
import { prebuiltEncoderLoader } from './prebuilt-encoders.js';

/** A rate, which a test knows to be one. */
function rate(hertz: number): SampleRate {
  const made = sampleRate(hertz);
  if (!made.ok) throw new Error(made.failures[0].summary);
  return made.value;
}

/**
 * `frames` frames of music-like audio in each of `channels` channels: three
 * partials that differ by channel under a slow swell, and a little noise from
 * a fixed generator, peaking below full scale. The same arguments give the
 * same samples on every machine.
 */
export function testSignal(channels: number, frames: number, hertz: number): Float32Array[] {
  let state = 0x2545f491;
  const noise = (): number => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 2 ** 32 - 0.5;
  };
  return Array.from({ length: channels }, (_, channel) => {
    const base = 220 * (channel + 1);
    return Float32Array.from({ length: frames }, (_unused, frame) => {
      const time = frame / hertz;
      const swell = 0.6 + 0.4 * Math.sin(2 * Math.PI * 0.5 * time);
      const partials =
        0.4 * Math.sin(2 * Math.PI * base * time) +
        0.2 * Math.sin(2 * Math.PI * base * 2.01 * time + channel) +
        0.1 * Math.sin(2 * Math.PI * base * 3.98 * time);
      return swell * partials + 0.01 * noise();
    });
  });
}

/** A request for `encoding` of audio in `layout` at `hertz`, without metadata or dither. */
export function exportRequest(
  encoding: FormatEncoding,
  hertz: number,
  layout: ChannelLayout = StandardLayouts.stereo,
): ExportEncodeRequest {
  return {
    target: exportTarget(encoding),
    encoding,
    sampleRate: rate(hertz),
    layout,
    metadata: {},
    dither: { settings: { kind: 'none' }, key: 0 },
  };
}

/**
 * The services of a Node test: the run's codec module, the prebuilt encoders'
 * files, and the browser's encoder where a test gives one, said to be Chrome's.
 */
export function testServices(
  encoding?: ExportEncoderServices['encoding'],
  signal: CancellationSignal = new AbortController().signal,
): ExportEncoderServices {
  return {
    codecModule: async () => succeed(await codecModule()),
    prebuiltModule: prebuiltEncoderLoader(),
    encoding,
    browser: { name: 'Chrome', majorVersion: '131' },
    signal,
  };
}

/** The whole file `request` makes of `planes`, written in blocks of `block` frames. */
export async function encodeWhole(
  request: ExportEncodeRequest,
  planes: readonly Float32Array[],
  services: ExportEncoderServices = testServices(),
  block = 4_000,
): Promise<Uint8Array> {
  const opened = await openExportEncoder(request, services);
  if (!opened.ok) throw new Error(opened.failures[0].summary);
  return (await writeWhole(opened.value.writer, planes, block)).file;
}

/** Every frame a session decodes, one plane per channel. */
export function decodeAll(session: DecoderSession): Float32Array[] {
  const channels = session.description.channelCount;
  const block = Array.from({ length: channels }, () => new Float32Array(4_096));
  const parts: Float32Array[][] = Array.from({ length: channels }, () => []);
  for (;;) {
    const decoded = session.decode(block);
    if (!decoded.ok) throw new Error(decoded.failures[0].summary);
    if (decoded.value === 0) break;
    block.forEach((plane, channel) => {
      parts[channel]?.push(plane.slice(0, decoded.value));
    });
  }
  return parts.map((chunks) => {
    const plane = new Float32Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
      plane.set(chunk, offset);
      offset += chunk.length;
    }
    return plane;
  });
}

/**
 * The signal-to-noise ratio, in decibels, of `decoded` against `source`,
 * sample for sample over every channel: the source's energy over the
 * energy of the difference.
 */
export function snrDb(source: readonly Float32Array[], decoded: readonly Float32Array[]): number {
  let signal = 0;
  let noise = 0;
  source.forEach((plane, channel) => {
    const other = decoded[channel] ?? new Float32Array(0);
    plane.forEach((sample, frame) => {
      signal += sample * sample;
      noise += (sample - (other[frame] ?? 0)) ** 2;
    });
  });
  return 10 * Math.log10(signal / noise);
}
