/**
 * Naming a file's format from its contents, never its name (REQ-AUDIO-220).
 *
 * The first 64 bytes name every container by its magic number. A RIFF or IFF
 * form names only its container there, so for those the walk goes on to the
 * chunk that names the codec, which is the first stage of the parse that
 * `openAudio` continues: one authority recognises and reads a header, so the
 * two cannot disagree about what a file is. A stream format is named, with its
 * codec where its first bytes state one, by `stream-recognition.ts`.
 */

import {
  mapResult,
  throwIfCancelled,
  type CancellationSignal,
  type DomainResult,
} from '@audiogubbins/domain';

import { recogniseAiff } from './aiff-container.js';
import type { AudioBytes } from './audio-bytes.js';
import { HeaderSource, fourCharacterCode, readExactly } from './byte-reading.js';
import type { FormatStage } from './format-descriptor.js';
import type { ReadableContainer, RecognisedFormat } from './recognised-format.js';
import { recogniseRiff } from './riff-container.js';
import { recogniseStream } from './stream-recognition.js';

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
      return mapResult(await recogniseStream(source, head.value, signal), (format) => ({
        readable: false,
        format,
      }));
  }
}

/**
 * Names a file's format from its first bytes and, for a RIFF or IFF form, a
 * bounded walk to the chunk that names its codec, or for a stream, the bounded
 * reads that name its codec.
 */
export async function recogniseAudio(
  bytes: AudioBytes,
  signal?: CancellationSignal,
): Promise<DomainResult<RecognisedFormat>> {
  return mapResult(await recogniseStage(bytes, signal), (stage) => stage.format);
}
