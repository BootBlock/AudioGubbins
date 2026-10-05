/**
 * Naming a file's format from its contents, never its name (REQ-AUDIO-220).
 *
 * The first 64 bytes name every format a refusal must name by its magic
 * number. A RIFF or IFF form names only its container there, so for those the
 * walk goes on to the chunk that names the codec, which is the first stage of
 * the parse that `openAudio` continues: one authority recognises and reads a
 * header, so the two cannot disagree about what a file is.
 */

import {
  mapResult,
  succeed,
  throwIfCancelled,
  type CancellationSignal,
  type DomainResult,
} from '@audiogubbins/domain';

import { recogniseAiff } from './aiff-container.js';
import type { AudioBytes } from './audio-bytes.js';
import { HeaderSource, fourCharacterCode, readExactly } from './byte-reading.js';
import type { FormatStage } from './format-descriptor.js';
import type { ReadableContainer, ReadableFormat, RecognisedFormat } from './recognised-format.js';
import { recogniseRiff } from './riff-container.js';

/** The bytes read before anything else: enough for every magic number and most headers. */
const HEAD_BYTES = 64;

/** The readable forms, by their form id and form type. */
const FORMS: ReadonlyMap<string, ReadableContainer> = new Map([
  ['RIFFWAVE', 'wav'],
  ['RF64WAVE', 'rf64'],
  ['BW64WAVE', 'bw64'],
  ['FORMAIFF', 'aiff'],
  ['FORMAIFC', 'aifc'],
]);

/** Whether the head starts with an MPEG audio frame header: a sync, a layer and a usable rate. */
function startsWithMpegFrame(head: Uint8Array): boolean {
  const [sync = 0, flags = 0, rates = 0] = head;
  const layer = (flags >> 1) & 0b11;
  const bitRate = rates >> 4;
  const sampleRate = (rates >> 2) & 0b11;
  return (
    sync === 0xff &&
    (flags & 0xe0) === 0xe0 &&
    layer !== 0 &&
    bitRate !== 0xf &&
    sampleRate !== 0b11
  );
}

/** The format a head that is no readable form names, by its magic number. */
function foreignFormat(head: Uint8Array): Exclude<RecognisedFormat, ReadableFormat> {
  const first = fourCharacterCode(head, 0);
  if (first === 'fLaC') return { kind: 'flac' };
  if (first === 'OggS') return { kind: 'ogg' };
  if (first.startsWith('ID3') || startsWithMpegFrame(head)) return { kind: 'mp3' };
  if (fourCharacterCode(head, 4) === 'ftyp') return { kind: 'mp4' };
  return { kind: 'unknown' };
}

/** The first stage of the parse: the format, and for a readable one, the rest of the parse. */
export async function recogniseStage(
  bytes: AudioBytes,
  signal: CancellationSignal | undefined,
): Promise<DomainResult<FormatStage>> {
  if (!Number.isSafeInteger(bytes.size) || bytes.size < 0) {
    throw new RangeError('An audio byte source reports its size as a whole number of bytes.');
  }
  throwIfCancelled(signal);
  const head = await readExactly(bytes, 0, Math.min(HEAD_BYTES, bytes.size), signal);
  if (!head.ok) return head;
  const source = new HeaderSource(bytes, head.value);
  const form = FORMS.get(fourCharacterCode(head.value, 0) + fourCharacterCode(head.value, 8));
  switch (form) {
    case 'wav':
    case 'rf64':
    case 'bw64':
      return await recogniseRiff(source, form, signal);
    case 'aiff':
    case 'aifc':
      return await recogniseAiff(source, form, signal);
    case undefined:
      return succeed({ readable: false, format: foreignFormat(head.value) });
  }
}

/**
 * Names a file's format from its first bytes and, for a RIFF or IFF form, a
 * bounded walk to the chunk that names its codec.
 */
export async function recogniseAudio(
  bytes: AudioBytes,
  signal?: CancellationSignal,
): Promise<DomainResult<RecognisedFormat>> {
  return mapResult(await recogniseStage(bytes, signal), (stage) => stage.format);
}
