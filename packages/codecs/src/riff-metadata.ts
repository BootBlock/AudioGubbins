/**
 * The metadata of a WAV, RF64 or BW64 file, read into the one map (ADR-0093).
 *
 * The walk is the audio reader's own, so RF64's ds64 sizes mean the same to
 * both, and it never reads the sample data; what each chunk means to the map is
 * `riff-chunk-reading.ts`'s, which FLAC's carried chunks are read by as well.
 * Only the bodies of the chunks the map takes are read, a `LIST`'s once its
 * type says the map takes it, each within the per-chunk and per-file bounds.
 */

import { fail, succeed, type CancellationSignal, type DomainResult } from '@audiogubbins/domain';

import type { AudioBytes } from './audio-bytes.js';
import { fourCharacterCode, type HeaderSource } from './byte-reading.js';
import { readHeaderChunk, type ChunkSpan } from './chunk-walk.js';
import { malformed } from './codec-failures.js';
import type { MetadataMap } from './metadata-map.js';
import { MetadataChunkReader, openForm, type MetadataReader } from './metadata-reading.js';
import { RiffChunkReading } from './riff-chunk-reading.js';
import { firstWalk } from './riff-container.js';
import { LIST_TYPE_BYTES } from './riff-list-entries.js';

/** The RIFF forms by the id a file opens with. */
const FORMS: ReadonlyMap<string, 'wav' | 'rf64' | 'bw64'> = new Map([
  ['RIFF', 'wav'],
  ['RF64', 'rf64'],
  ['BW64', 'bw64'],
]);

/** Whether the map takes the chunk the walk met, reading a `LIST`'s type to decide. */
async function taken(
  source: HeaderSource,
  span: ChunkSpan,
  reading: RiffChunkReading,
  signal: CancellationSignal | undefined,
): Promise<DomainResult<boolean>> {
  if (span.id !== 'LIST') return succeed(reading.takesChunk(span.id, span.size));
  // A list too short for its type is read whole, for its refusal.
  if (span.size < LIST_TYPE_BYTES) return succeed(true);
  const type = await readHeaderChunk(source, span, LIST_TYPE_BYTES, signal);
  if (!type.ok) return type;
  return succeed(reading.takesList(fourCharacterCode(type.value, 0)));
}

/** Reads a WAV, RF64 or BW64 file's metadata. */
export const readRiffMetadata: MetadataReader = async (
  bytes: AudioBytes,
  signal?: CancellationSignal,
): Promise<DomainResult<MetadataMap>> => {
  const opened = await openForm(bytes, signal);
  if (!opened.ok) return opened;
  const { head, source } = opened.value;
  const form = FORMS.get(fourCharacterCode(head, 0));
  if (form === undefined || fourCharacterCode(head, 8) !== 'WAVE') {
    return fail(malformed('The file is not a WAV, RF64 or BW64 file.'));
  }
  const walked = await firstWalk(source, form, signal);
  if (!walked.ok) return walked;
  const chunks = new MetadataChunkReader(source);
  const reading = new RiffChunkReading();
  for (;;) {
    const next = await walked.value.next(signal);
    if (!next.ok) return next;
    if (next.value === undefined) return succeed(reading.toMap());
    const span = next.value;
    const take = await taken(source, span, reading, signal);
    if (!take.ok) return take;
    if (!take.value) continue;
    const body = await chunks.body(span, signal);
    if (!body.ok) return body;
    const read = reading.read(span.id, body.value);
    if (!read.ok) return read;
  }
};
