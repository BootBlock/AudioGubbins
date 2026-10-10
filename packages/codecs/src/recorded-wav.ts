/**
 * The header of a recorded asset's file: 32-bit float PCM WAV, RF64 past four
 * gibibytes (ADR-0071).
 *
 * A recording's length is known when it is written, since its chunks are
 * already committed, so the header is written whole before the samples and
 * never patched: the storage worker hashes the header and the chunks, then
 * writes the file once under that identity. The chunks are the data chunk's
 * body as they stand, 32-bit float, little-endian and interleaved, so nothing
 * here touches a sample.
 *
 * The header states the layout so that this package's own reader gives it back:
 * plain `WAVE_FORMAT_IEEE_FLOAT` where the format's default is the layout, as
 * mono and stereo are, and `WAVE_FORMAT_EXTENSIBLE` with the speaker mask
 * otherwise. A layout no header can state that way, as a labelled or an
 * ambisonic one, is refused rather than written as something else. Both forms
 * carry the `fact` chunk every WAV of a non-integer code must have.
 *
 * The export writer states every layout (ADR-0093), by moving speakers into a
 * mask's order and by `iXML`; this writer keeps refusing the rest, because its
 * samples are the recording's chunks as they stand, which it never reorders,
 * and a session asks it before recording whether its layout can be kept. It
 * builds its head with the export writer's (`wave-head.ts`), byte for byte as
 * before.
 */

import {
  fail,
  layoutsMatch,
  succeed,
  type ChannelLayout,
  type DomainResult,
  type SampleCount,
  type SampleRate,
} from '@audiogubbins/domain';

import { speakerMaskLayout, speakerMaskOf } from './channel-layouts.js';
import { unwritableLayout, unwritableLength } from './codec-failures.js';
import { layoutRead } from './format-descriptor.js';
import type { ReadableContainer } from './recognised-format.js';
import { waveFormatChunk, type WaveFormatForm } from './wave-format-writing.js';
import { waveHeadPlan, writeWaveHead, type WaveHeadParts, type WaveHeadPlan } from './wave-head.js';

/** The bytes of one 32-bit float sample. */
const SAMPLE_BYTES = 4;

/** What a recording is: its rate, and the layout its channels are in. */
export interface RecordedWavFormat {
  readonly sampleRate: SampleRate;
  readonly layout: ChannelLayout;
}

/** A recorded asset's header, and where the samples go after it. */
export interface RecordedWavHeader {
  /** `rf64` exactly when a size of the plain form would not fit its 32-bit field. */
  readonly container: Extract<ReadableContainer, 'wav' | 'rf64'>;

  /** The header, every byte of the file before the first sample. */
  readonly bytes: Uint8Array;

  /** The offset of the first sample's first byte, which is the header's length. */
  readonly dataOffset: number;

  /** The bytes of the samples: every frame of every channel, four bytes each. */
  readonly dataLength: number;

  /** The whole file's length, header and samples. */
  readonly fileLength: number;
}

/** Whether a header stating `stated`, or no layout, is read back as `layout`. */
function readsAs(stated: ChannelLayout | undefined, layout: ChannelLayout): boolean {
  const read = layoutRead(stated, layout.roles.length);
  return read.ok && layoutsMatch(read.value, layout);
}

/** The form of format chunk that states `layout`, or why none does. */
function formatForm(layout: ChannelLayout): DomainResult<WaveFormatForm> {
  const channelCount = layout.roles.length;
  // The plain form states no layout, so it is read as the default, which only
  // mono and stereo have; more channels need the extensible form in any case.
  if (channelCount <= 2 && readsAs(undefined, layout)) return succeed({ kind: 'plain' });
  const channelMask = speakerMaskOf(layout);
  if (channelMask !== undefined && readsAs(speakerMaskLayout(channelMask, channelCount), layout)) {
    return succeed({ kind: 'extensible', channelMask });
  }
  return fail(
    unwritableLayout(
      'A WAV file cannot state this channel layout: it holds labelled, ambisonic or out-of-order channels, or a single or pair of discrete ones, which would be read back as another layout.',
    ),
  );
}

/** What the header of `frames` frames in `format` holds, or why no WAV file can hold it. */
function headerParts(format: RecordedWavFormat, frames: SampleCount): DomainResult<WaveHeadParts> {
  const form = formatForm(format.layout);
  if (!form.ok) return form;
  const channelCount = format.layout.roles.length;
  const blockAlign = channelCount * SAMPLE_BYTES;
  return succeed({
    form: 'riff',
    format: waveFormatChunk({
      encoding: { kind: 'float', bits: 32, bytes: SAMPLE_BYTES, byteOrder: 'little' },
      channelCount,
      sampleRate: format.sampleRate,
      blockAlign,
      framesPerBlock: 1,
      form: form.value,
    }),
    // Every WAV of a code other than integer PCM carries the fact chunk.
    factFrames: frames,
    chunks: [],
    dataLength: frames * blockAlign,
    frames,
  });
}

/** The sizes of the header for `frames` frames in `format`, or why it cannot be written. */
function headerPlan(
  format: RecordedWavFormat,
  frames: SampleCount,
): DomainResult<{ readonly parts: WaveHeadParts; readonly plan: WaveHeadPlan }> {
  const parts = headerParts(format, frames);
  if (!parts.ok) return parts;
  const blockAlign = format.layout.roles.length * SAMPLE_BYTES;
  const plan = waveHeadPlan(parts.value, () => unwritableLength(frames, blockAlign));
  return plan.ok ? succeed({ parts: parts.value, plan: plan.value }) : plan;
}

/**
 * The header of a recording of `frames` frames in `format`, after which the
 * caller writes the samples, or why no WAV file can hold it.
 *
 * A layout is refused whatever the length, so a session can ask with no
 * frames, before it records, whether its recording can be written.
 */
export function recordedWavHeader(
  format: RecordedWavFormat,
  frames: SampleCount,
): DomainResult<RecordedWavHeader> {
  const planned = headerPlan(format, frames);
  if (!planned.ok) return planned;
  const { parts, plan } = planned.value;
  // The recorded writer writes neither BW64 nor odd data, so its head is RIFF or RF64 alone.
  const container = plan.container === 'wav' ? 'wav' : 'rf64';
  return succeed({
    container,
    bytes: writeWaveHead(plan, parts),
    dataOffset: plan.dataOffset,
    dataLength: parts.dataLength,
    fileLength: plan.fileLength,
  });
}

/**
 * The whole file's length for a recording of `frames` frames in `format`,
 * without writing its header, or why no WAV file can hold it.
 */
export function recordedWavLength(
  format: RecordedWavFormat,
  frames: SampleCount,
): DomainResult<number> {
  const planned = headerPlan(format, frames);
  return planned.ok ? succeed(planned.value.plan.fileLength) : planned;
}
