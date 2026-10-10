/**
 * The metadata of an MP3 file: its leading ID3v2 tag, of version 2.2, 2.3 or
 * 2.4, and its trailing ID3v1 tag, whose fields fill only the text the ID3v2
 * tag does not give (ADR-0093). The ID3v2 tag is read whole within the metadata
 * bound; the ID3v1 tag is the file's last 128 bytes.
 */

import { fail, succeed, type CancellationSignal, type DomainResult } from '@audiogubbins/domain';

import type { AudioBytes } from './audio-bytes.js';
import { readExactly } from './byte-reading.js';
import { malformed } from './codec-failures.js';
import { metadataOverBound } from './framing-failures.js';
import { ID3V1_BYTES, readId3v1 } from './id3v1-reader.js';
import { ID3V2_HEADER_BYTES, readId3v2Header } from './id3v2-header.js';
import { readId3v2Frames } from './id3v2-reader.js';
import { MetadataGathering } from './metadata-gathering.js';
import { MAXIMUM_METADATA_BYTES } from './metadata-limits.js';
import type { MetadataMap } from './metadata-map.js';

/** The metadata of an MP3 file's ID3 tags. */
export async function readMp3Metadata(
  bytes: AudioBytes,
  signal?: CancellationSignal,
): Promise<DomainResult<MetadataMap>> {
  const tags = new MetadataGathering();
  let tagEnd = 0;
  if (bytes.size >= ID3V2_HEADER_BYTES) {
    const head = await readExactly(bytes, 0, ID3V2_HEADER_BYTES, signal);
    if (!head.ok) return head;
    const header = readId3v2Header(head.value);
    if (!header.ok) return header;
    if (header.value !== undefined) {
      if (header.value.length > bytes.size)
        return fail(malformed('The ID3v2 tag runs past the end of the file.'));
      if (header.value.size > MAXIMUM_METADATA_BYTES)
        return fail(metadataOverBound('ID3v2 tag', MAXIMUM_METADATA_BYTES));
      const tag = await readExactly(bytes, ID3V2_HEADER_BYTES, header.value.size, signal);
      if (!tag.ok) return tag;
      const read = readId3v2Frames(header.value, tag.value, tags);
      if (!read.ok) return read;
      tagEnd = header.value.length;
    }
  }
  const map = tags.toMap();
  if (bytes.size - tagEnd < ID3V1_BYTES) return succeed(map);

  const trailing = await readExactly(bytes, bytes.size - ID3V1_BYTES, ID3V1_BYTES, signal);
  if (!trailing.ok) return trailing;
  const old = new MetadataGathering();
  readId3v1(trailing.value, old);
  const filling = old.toMap().text;
  if (filling === undefined) return succeed(map);
  return succeed({ ...map, text: { ...filling, ...map.text } });
}
