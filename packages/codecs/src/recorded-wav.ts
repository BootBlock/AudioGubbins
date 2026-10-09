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
import { DS64_FIXED_BYTES, SIZE_IN_DS64 } from './riff-container.js';
import {
  EXTENSIBLE_FORMAT_BYTES,
  EXTENSION_BYTES,
  STANDARD_SUBTYPE_TAIL,
  WAVE_FORMAT_EXTENSIBLE,
  WAVE_FORMAT_IEEE_FLOAT,
} from './wave-format.js';

/** The bytes of one 32-bit float sample. */
const SAMPLE_BYTES = 4;

/** A chunk's id and 32-bit size. */
const CHUNK_HEADER_BYTES = 8;

/** The form's id, its size and `WAVE`. */
const FORM_HEADER_BYTES = 12;

/** The plain format chunk: the 16 bytes every WAV format holds, and an empty extension's size. */
const PLAIN_FORMAT_BYTES = 18;

/** The `fact` chunk's body: the frames, as samples of each channel. */
const FACT_BYTES = 4;

/**
 * The largest size a 32-bit field states in the plain form. One more is RF64's
 * marker, which sends a reader to the ds64 chunk, so a plain file never states
 * it.
 */
const LARGEST_PLAIN_SIZE = SIZE_IN_DS64 - 1;

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

/** How the format chunk states the layout. */
type FormatForm =
  { readonly kind: 'plain' } | { readonly kind: 'extensible'; readonly channelMask: number };

/** Every size the header is written with, decided before a byte of it is. */
interface HeaderPlan {
  readonly form: FormatForm;
  readonly container: RecordedWavHeader['container'];
  readonly channelCount: number;
  readonly formatBytes: number;
  readonly dataOffset: number;
  readonly dataLength: number;
  readonly fileLength: number;
}

/** Whether a header stating `stated`, or no layout, is read back as `layout`. */
function readsAs(stated: ChannelLayout | undefined, layout: ChannelLayout): boolean {
  const read = layoutRead(stated, layout.roles.length);
  return read.ok && layoutsMatch(read.value, layout);
}

/** The form of format chunk that states `layout`, or why none does. */
function formatForm(layout: ChannelLayout): DomainResult<FormatForm> {
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

/** Every size of the header for `frames` frames in `format`, or why it cannot be written. */
function headerPlan(format: RecordedWavFormat, frames: SampleCount): DomainResult<HeaderPlan> {
  const form = formatForm(format.layout);
  if (!form.ok) return form;
  const channelCount = format.layout.roles.length;
  const blockAlign = channelCount * SAMPLE_BYTES;
  const formatBytes = form.value.kind === 'plain' ? PLAIN_FORMAT_BYTES : EXTENSIBLE_FORMAT_BYTES;
  const plainHeader = FORM_HEADER_BYTES + CHUNK_HEADER_BYTES * 3 + formatBytes + FACT_BYTES;
  const dataLength = frames * blockAlign;
  // The form's size counts everything after its own id and size field.
  const plainFormSize = plainHeader - CHUNK_HEADER_BYTES + dataLength;
  const container = plainFormSize <= LARGEST_PLAIN_SIZE ? 'wav' : 'rf64';
  const dataOffset =
    container === 'wav' ? plainHeader : plainHeader + CHUNK_HEADER_BYTES + DS64_FIXED_BYTES;
  const fileLength = dataOffset + dataLength;
  if (!Number.isSafeInteger(fileLength)) return fail(unwritableLength(frames, blockAlign));
  return succeed({
    form: form.value,
    container,
    channelCount,
    formatBytes,
    dataOffset,
    dataLength,
    fileLength,
  });
}

/** Writes the header's fields in order, little-endian, as a RIFF form is. */
class FieldWriter {
  readonly bytes: Uint8Array;
  private readonly view: DataView;
  private at = 0;

  constructor(length: number) {
    this.bytes = new Uint8Array(length);
    this.view = new DataView(this.bytes.buffer);
  }

  code(id: string): void {
    for (let index = 0; index < 4; index += 1) this.bytes[this.at + index] = id.charCodeAt(index);
    this.at += 4;
  }

  uint16(value: number): void {
    this.view.setUint16(this.at, value, true);
    this.at += 2;
  }

  uint32(value: number): void {
    this.view.setUint32(this.at, value, true);
    this.at += 4;
  }

  /** A 64-bit value, which the plan has kept a safe integer. */
  uint64(value: number): void {
    this.uint32(value % 2 ** 32);
    this.uint32(Math.floor(value / 2 ** 32));
  }

  raw(values: readonly number[]): void {
    this.bytes.set(values, this.at);
    this.at += values.length;
  }
}

/** The format chunk, plain or extensible, of 32-bit float samples. */
function writeFormat(out: FieldWriter, plan: HeaderPlan, sampleRate: SampleRate): void {
  const blockAlign = plan.channelCount * SAMPLE_BYTES;
  const bits = SAMPLE_BYTES * 8;
  out.code('fmt ');
  out.uint32(plan.formatBytes);
  out.uint16(plan.form.kind === 'plain' ? WAVE_FORMAT_IEEE_FLOAT : WAVE_FORMAT_EXTENSIBLE);
  out.uint16(plan.channelCount);
  out.uint32(sampleRate);
  out.uint32(sampleRate * blockAlign);
  out.uint16(blockAlign);
  out.uint16(bits);
  if (plan.form.kind === 'plain') {
    out.uint16(0);
    return;
  }
  out.uint16(EXTENSION_BYTES);
  out.uint16(bits);
  out.uint32(plan.form.channelMask);
  // The sub-format GUID KSDATAFORMAT_SUBTYPE_IEEE_FLOAT: the code, then the family's tail.
  out.uint32(WAVE_FORMAT_IEEE_FLOAT);
  out.raw(STANDARD_SUBTYPE_TAIL);
}

/** Writes the header a plan describes. */
function writeHeader(plan: HeaderPlan, format: RecordedWavFormat, frames: SampleCount): Uint8Array {
  const out = new FieldWriter(plan.dataOffset);
  const large = plan.container === 'rf64';
  out.code(large ? 'RF64' : 'RIFF');
  out.uint32(large ? SIZE_IN_DS64 : plan.fileLength - CHUNK_HEADER_BYTES);
  out.code('WAVE');
  if (large) {
    // EBU Tech 3306: the form's, the data's and the samples' true sizes, and no table.
    out.code('ds64');
    out.uint32(DS64_FIXED_BYTES);
    out.uint64(plan.fileLength - CHUNK_HEADER_BYTES);
    out.uint64(plan.dataLength);
    out.uint64(frames);
    out.uint32(0);
  }
  writeFormat(out, plan, format.sampleRate);
  out.code('fact');
  out.uint32(FACT_BYTES);
  out.uint32(large ? SIZE_IN_DS64 : frames);
  out.code('data');
  out.uint32(large ? SIZE_IN_DS64 : plan.dataLength);
  return out.bytes;
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
  const plan = headerPlan(format, frames);
  if (!plan.ok) return plan;
  const { container, dataOffset, dataLength, fileLength } = plan.value;
  return succeed({
    container,
    bytes: writeHeader(plan.value, format, frames),
    dataOffset,
    dataLength,
    fileLength,
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
  const plan = headerPlan(format, frames);
  return plan.ok ? succeed(plan.value.fileLength) : plan;
}
