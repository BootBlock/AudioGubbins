/**
 * Keeping audio the storage made itself as a 32-bit float WAV file in the media
 * store (ADR-0071, ADR-0090): a recording when it ends, and a decoded rendition
 * of a compressed file; and heading such audio that is kept beside the store,
 * as a session's sound in the staging is.
 *
 * The file is the recorded-media header followed by the frames as they stand,
 * already 32-bit floats, little-endian and interleaved in the asset's channel
 * order. Its identity is hashed over the header and the frames first, so the
 * store writes the file once, under that identity, rather than receiving it
 * and copying it again. It is then read back through the read contract before
 * anything names it, as an imported file is, and refused where it does not
 * read as the audio it was written as. The store holds the file until the
 * caller releases it, once a project's journal refers to it or nothing will.
 */

import {
  openAudio,
  recordedWavHeader,
  type AudioFormatDescriptor,
  type RecordedWavFormat,
} from '@audiogubbins/codecs';
import {
  fail,
  layoutsMatch,
  succeed,
  type DomainFailure,
  type DomainResult,
  type SampleCount,
} from '@audiogubbins/domain';
import type { MediaObjectStore } from '@audiogubbins/media-store';
import {
  contentIdOf,
  type ByteSource,
  type ContentIdentity,
  type Digest,
  type ManagedMedia,
} from '@audiogubbins/project-format';

/** The media type a stored WAV file is kept as, RF64 among them. */
export const STORED_WAV_MEDIA_TYPE = 'audio/wav';

/** How a stored file failed to read back as the audio it was written as. */
export type WavReadBackDifference = 'unreadable' | 'sample-rate' | 'layout' | 'length';

/** What storing a WAV file works with, each made once by the composition root. */
export interface WavStoring {
  readonly store: MediaObjectStore;
  readonly digest: Digest;
}

/** A WAV file stored and read back, held by the store until released. */
export interface StoredWav {
  readonly identity: ContentIdentity;
  readonly format: AudioFormatDescriptor;
  readonly release: () => void;
}

/**
 * Stores `frames` frames of `data` as a 32-bit float WAV file of `format`
 * (see the module comment), failing with `differs`' failure where it does not
 * read back as written.
 */
export async function storeFloatWav(
  data: ByteSource,
  format: RecordedWavFormat,
  frames: SampleCount,
  services: WavStoring,
  differs: (difference: WavReadBackDifference) => DomainFailure,
  signal?: AbortSignal,
): Promise<DomainResult<StoredWav>> {
  const header = recordedWavHeader(format, frames);
  if (!header.ok) return header;
  const file = headed(header.value.bytes, data);
  const options = signal === undefined ? {} : { signal };
  const identity = await contentIdOf(file, services.digest, options);
  if (!identity.ok) return identity;
  const { contentId } = identity.value;
  const put = await services.store.putNamed(file, contentId, options);
  if (!put.ok) return put;
  const release = (): void => {
    services.store.release(contentId);
  };
  const opened = await services.store.open(contentId);
  if (!opened.ok) {
    release();
    return opened;
  }
  const read = await readBack(opened.value, format, frames, signal);
  if (!read.ok) {
    release();
    return read;
  }
  if (read.value.kind === 'differs') {
    release();
    return fail(differs(read.value.difference));
  }
  return succeed({ identity: identity.value, format: read.value.format, release });
}

/** What reading the stored file back found. */
type ReadBack =
  | { readonly kind: 'read'; readonly format: AudioFormatDescriptor }
  | { readonly kind: 'differs'; readonly difference: WavReadBackDifference };

/** The written file's format, where the read contract reads it as the audio it was written as. */
async function readBack(
  file: ByteSource,
  written: RecordedWavFormat,
  frames: SampleCount,
  signal?: AbortSignal,
): Promise<DomainResult<ReadBack>> {
  const reader = await openAudio(file, signal);
  if (!reader.ok) return succeed({ kind: 'differs', difference: 'unreadable' });
  const { format } = reader.value;
  const difference: WavReadBackDifference | undefined =
    format.sampleRate !== written.sampleRate
      ? 'sample-rate'
      : !layoutsMatch(format.layout, written.layout)
        ? 'layout'
        : format.frames !== frames || format.declaredFrames !== frames
          ? 'length'
          : undefined;
  return succeed(
    difference === undefined ? { kind: 'read', format } : { kind: 'differs', difference },
  );
}

/**
 * The header that makes `data`, `frames` frames of `format`, a 32-bit float
 * WAV file where it is kept beside the data rather than in the store: read
 * back through the read contract over the two together, as a stored file is,
 * and failing with `differs`' failure where they do not read as written.
 */
export async function headFloatWav(
  data: ByteSource,
  format: RecordedWavFormat,
  frames: SampleCount,
  differs: (difference: WavReadBackDifference) => DomainFailure,
  signal?: AbortSignal,
): Promise<DomainResult<Uint8Array<ArrayBuffer>>> {
  const header = recordedWavHeader(format, frames);
  if (!header.ok) return header;
  const read = await readBack(headed(header.value.bytes, data), format, frames, signal);
  if (!read.ok) return read;
  return read.value.kind === 'differs'
    ? fail(differs(read.value.difference))
    : succeed(new Uint8Array(header.value.bytes));
}

/** Where an asset whose media is a stored WAV file finds its bytes. */
export function storedWavMedia(stored: StoredWav): ManagedMedia {
  const { contentId, byteLength } = stored.identity;
  return { kind: 'managed', contentId, byteLength, mediaType: STORED_WAV_MEDIA_TYPE };
}

/** `header` followed by `data`, as one source. */
function headed(header: Uint8Array, data: ByteSource): ByteSource {
  const size = header.length + data.size;
  return {
    size,
    read: async (offset, length, signal) => {
      const end = Math.min(offset + length, size);
      const bytes = new Uint8Array(Math.max(0, end - offset));
      if (offset < header.length) bytes.set(header.subarray(offset, Math.min(end, header.length)));
      if (end <= header.length) return bytes;
      const from = Math.max(offset, header.length);
      const part = await data.read(from - header.length, end - from, signal);
      bytes.set(part, from - offset);
      return part.length === end - from ? bytes : bytes.slice(0, from - offset + part.length);
    },
  };
}
