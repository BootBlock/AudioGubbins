/**
 * The IFF forms: AIFF and AIFF-C.
 *
 * A file is `FORM`, a size and `AIFF` or `AIFC`, then big-endian chunks in any
 * order: `COMM` describes the samples, `SSND` holds them after its own offset
 * and block size, and an optional `CHAN` chunk carries CoreAudio's channel
 * layout. Since `CHAN` may follow the samples, the parse walks every chunk the
 * file holds, within the walk's bound; recognition stops at `COMM`, and the rest
 * of the parse continues the same walk. As with RIFF, the form's size is not
 * consulted, so a file cut short is walked to its true end.
 */

import { fail, succeed, type ChannelLayout, type DomainResult } from '@audiogubbins/domain';

import {
  AIFC_COMM_BYTES,
  commonEncoding,
  isUncompressed,
  readCommon,
  type CommonFacts,
} from './aiff-common.js';
import type { ReadSignal } from './audio-bytes.js';
import { viewOf, type HeaderSource } from './byte-reading.js';
import { coreAudioLayout, type CoreAudioLayout } from './channel-layouts.js';
import { ChunkWalk, readHeaderChunk, type ChunkSpan } from './chunk-walk.js';
import { malformed } from './codec-failures.js';
import {
  describeAudio,
  type AudioFormatDescriptor,
  type FormatStage,
} from './format-descriptor.js';

/** Where the chunks begin, after `FORM`, its size and the form type. */
const FIRST_CHUNK = 12;

/** `SSND`'s offset and block size, before its samples. */
const SOUND_HEADER_BYTES = 8;

/** `CHAN`'s tag, bitmap and description count, and each description's bytes. */
const CHANNEL_LAYOUT_BYTES = 12;
const CHANNEL_DESCRIPTION_BYTES = 20;

/** The most channels a `CHAN` chunk is read for, which is the domain's limit. */
const MAXIMUM_DESCRIBED_CHANNELS = 256;

/** The chunks the parse needs, the first of each id the walk has met. */
interface FoundChunks {
  common?: ChunkSpan;
  sound?: ChunkSpan;
  channels?: ChunkSpan;
}

const CHUNK_SLOTS: ReadonlyMap<string, keyof FoundChunks> = new Map([
  ['COMM', 'common'],
  ['SSND', 'sound'],
  ['CHAN', 'channels'],
]);

/** Walks on, keeping the chunks the parse needs, until `done` or the end of the file. */
async function walkUntil(
  walk: ChunkWalk,
  found: FoundChunks,
  done: () => boolean,
  signal: ReadSignal | undefined,
): Promise<DomainResult<undefined>> {
  while (!done()) {
    const next = await walk.next(signal);
    if (!next.ok) return next;
    if (next.value === undefined) break;
    const slot = CHUNK_SLOTS.get(next.value.id);
    if (slot !== undefined) found[slot] ??= next.value;
  }
  return succeed(undefined);
}

/** Reads a `CHAN` chunk's CoreAudio layout, or `undefined` where it is too short to hold one. */
async function readChannelLayout(
  source: HeaderSource,
  span: ChunkSpan,
  channelCount: number,
  signal: ReadSignal | undefined,
): Promise<DomainResult<CoreAudioLayout | undefined>> {
  const described = Math.min(Math.max(channelCount, 0), MAXIMUM_DESCRIBED_CHANNELS);
  const limit = CHANNEL_LAYOUT_BYTES + described * CHANNEL_DESCRIPTION_BYTES;
  const body = await readHeaderChunk(source, span, limit, signal);
  if (!body.ok) return body;
  if (body.value.length < CHANNEL_LAYOUT_BYTES) return succeed(undefined);
  const view = viewOf(body.value);
  const descriptions = view.getUint32(8, false);
  const labels: number[] = [];
  if (CHANNEL_LAYOUT_BYTES + descriptions * CHANNEL_DESCRIPTION_BYTES <= body.value.length) {
    for (let index = 0; index < descriptions; index += 1) {
      labels.push(view.getUint32(CHANNEL_LAYOUT_BYTES + index * CHANNEL_DESCRIPTION_BYTES, false));
    }
  }
  return succeed({ tag: view.getUint32(0, false), bitmap: view.getUint32(4, false), labels });
}

/** Where `SSND`'s samples start and how many of their bytes the file holds. */
async function soundData(
  source: HeaderSource,
  sound: ChunkSpan,
  signal: ReadSignal | undefined,
): Promise<DomainResult<{ readonly dataOffset: number; readonly presentBytes: number }>> {
  if (sound.size < SOUND_HEADER_BYTES) {
    return fail(malformed('The SSND chunk is shorter than the 8 bytes that precede its samples.'));
  }
  const chunkEnd = Math.min(sound.bodyOffset + sound.size, source.size);
  if (sound.bodyOffset + SOUND_HEADER_BYTES > source.size) {
    // Cut off inside its own header: a truncation with no frames left, not a malformed file.
    return succeed({ dataOffset: sound.bodyOffset + SOUND_HEADER_BYTES, presentBytes: 0 });
  }
  const header = await source.read(sound.bodyOffset, SOUND_HEADER_BYTES, signal);
  if (!header.ok) return header;
  const offset = viewOf(header.value).getUint32(0, false);
  if (offset > sound.size - SOUND_HEADER_BYTES) {
    return fail(malformed("The SSND chunk's offset points past the end of the chunk."));
  }
  const dataOffset = sound.bodyOffset + SOUND_HEADER_BYTES + offset;
  return succeed({ dataOffset, presentBytes: Math.max(0, chunkEnd - dataOffset) });
}

/** Continues the walk to the file's end and describes it from what it found. */
async function describeSound(
  source: HeaderSource,
  walk: ChunkWalk,
  found: FoundChunks,
  stated: { readonly container: 'aiff' | 'aifc'; readonly common: CommonFacts },
  signal: ReadSignal | undefined,
): Promise<DomainResult<AudioFormatDescriptor>> {
  const { container, common } = stated;
  const walked = await walkUntil(walk, found, () => false, signal);
  if (!walked.ok) return walked;
  if (!common.sampleRate.ok) return common.sampleRate;
  const encoding = commonEncoding(common);
  if (!encoding.ok) return encoding;
  if (found.sound === undefined) {
    return fail(malformed('The file has no SSND chunk holding its samples.'));
  }
  const data = await soundData(source, found.sound, signal);
  if (!data.ok) return data;
  let layout: CoreAudioLayout | undefined;
  if (found.channels !== undefined) {
    const read = await readChannelLayout(source, found.channels, common.channelCount, signal);
    if (!read.ok) return read;
    layout = read.value;
  }
  return describeAudio(
    {
      container,
      sampleRate: common.sampleRate.value,
      encoding: encoding.value,
      channelCount: common.channelCount,
      blockAlign: Math.max(common.channelCount, 0) * encoding.value.bytes,
      declaredFrames: common.declaredFrames,
      ...data.value,
    },
    (channelCount): ChannelLayout | undefined =>
      layout === undefined ? undefined : coreAudioLayout(layout, channelCount),
  );
}

/**
 * Recognises an IFF form's codec by walking to its `COMM` chunk, and, where the
 * samples are uncompressed PCM, offers the rest of the parse, which continues
 * the same walk and so is taken once.
 */
export async function recogniseAiff(
  source: HeaderSource,
  container: 'aiff' | 'aifc',
  signal: ReadSignal | undefined,
): Promise<DomainResult<FormatStage>> {
  const walk = new ChunkWalk(source, FIRST_CHUNK, { littleEndian: false });
  const found: FoundChunks = {};
  const walked = await walkUntil(walk, found, () => found.common !== undefined, signal);
  if (!walked.ok) return walked;
  if (found.common === undefined) {
    return fail(malformed('The file has no COMM chunk describing its samples.'));
  }
  const body = await readHeaderChunk(source, found.common, AIFC_COMM_BYTES, signal);
  if (!body.ok) return body;
  const common = readCommon(body.value, container === 'aifc');
  if (!common.ok) return common;
  const facts = common.value;
  if (!isUncompressed(facts.compressionType)) {
    return succeed({
      readable: false,
      format: { kind: 'compressed-aifc', compressionType: facts.compressionType },
    });
  }
  return succeed({
    readable: true,
    format: { kind: container },
    describe: async (describeSignal) =>
      await describeSound(source, walk, found, { container, common: facts }, describeSignal),
  });
}
