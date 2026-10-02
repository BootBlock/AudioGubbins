/**
 * The quick identity signals of a file, read without reading all of it: the
 * fast fingerprint and the container signature (REQ-STOR-104).
 *
 * The fast fingerprint is SHA-256, through the injected digest, over the byte
 * length as 8 bytes, big-endian, then the first, middle and last
 * {@link SAMPLE_BYTES} of the file, the middle one centred in it; a file of
 * three samples or fewer is taken whole. At most 192 KiB is read whatever the
 * file's size, so a file is recognised again at once, and the full content
 * identity follows in the background (`progressive-hashing.ts`). It is a
 * sampling: two files alike in length and in every sampled byte share it, which
 * is why a match on it alone is reported as sampled rather than proven
 * (`source-classification.ts`).
 *
 * The signature is the first 16 bytes, or all of a shorter file, in lower-case
 * hexadecimal: the container's magic, which says what kind of file stands
 * there.
 */

import { fail, succeed, type DomainResult } from '@audiogubbins/domain';
import { hexOf, type ByteSource, type Digest } from '@audiogubbins/project-format';

import { checkedSize } from './chunk-reading.js';
import { sourceChanged } from './media-failures.js';

/** The bytes of each sampled range: 64 KiB. */
const SAMPLE_BYTES = 65_536;

/** The bytes of the signature. */
const SIGNATURE_BYTES = 16;

/** The bytes the length is written in. */
const LENGTH_BYTES = 8;

/** The quick signals a file is recognised by. */
export interface SourceSample {
  /** 64 lower-case hexadecimal digits. */
  readonly fastFingerprint: string;

  /** Up to 16 bytes in lower-case hexadecimal. */
  readonly signature: string;
}

/**
 * Reads the sampled ranges of a source and gives its quick signals. Fails with
 * `media.source-changed` where a read comes back short.
 */
export async function sampleSource(
  source: ByteSource,
  digest: Digest,
  signal?: AbortSignal,
): Promise<DomainResult<SourceSample>> {
  const size = checkedSize(source);
  const input = new Uint8Array(LENGTH_BYTES + Math.min(size, 3 * SAMPLE_BYTES));
  const view = new DataView(input.buffer);
  view.setUint32(0, Math.floor(size / 2 ** 32));
  view.setUint32(4, size >>> 0);

  let filled = LENGTH_BYTES;
  for (const [offset, length] of sampledRanges(size)) {
    signal?.throwIfAborted();
    const bytes = await source.read(offset, length, signal);
    if (bytes.length !== length) return fail(sourceChanged(offset, length, bytes.length));
    input.set(bytes, filled);
    filled += length;
  }
  signal?.throwIfAborted();

  const head = input.subarray(LENGTH_BYTES, LENGTH_BYTES + Math.min(size, SIGNATURE_BYTES));
  return succeed({ fastFingerprint: hexOf(await digest(input)), signature: hexOf(head) });
}

/** The ranges sampled from a file of `size` bytes, as offset and length. */
function sampledRanges(size: number): readonly (readonly [number, number])[] {
  if (size === 0) return [];
  if (size <= 3 * SAMPLE_BYTES) return [[0, size]];
  return [
    [0, SAMPLE_BYTES],
    [Math.floor((size - SAMPLE_BYTES) / 2), SAMPLE_BYTES],
    [size - SAMPLE_BYTES, SAMPLE_BYTES],
  ];
}
