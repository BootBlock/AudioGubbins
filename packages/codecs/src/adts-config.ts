/**
 * The AudioSpecificConfig an ADTS stream's first frame header states (ISO/IEC
 * 14496-3, 1.6.2.1 and 1.A.2.2).
 *
 * An ADTS stream carries its configuration in every frame's header rather
 * than once, so a demultiplexer that strips the headers, as the codec
 * module's does, leaves a decoder of raw access units nothing to be
 * configured with. The browser's decoder of HE-AAC is such a decoder; this
 * reads the first header, after any ID3v2 tag before it, into the two bytes
 * of configuration it states: the object type (the profile plus one), the
 * sampling frequency index and the channel configuration. An ADTS header can
 * signal SBR only implicitly, so the configuration is the core's, and the
 * decoder finds the SBR in the data.
 */

import { fail, succeed, type CancellationSignal, type DomainResult } from '@audiogubbins/domain';

import type { AudioBytes } from './audio-bytes.js';
import { readExactly } from './byte-reading.js';
import { malformed } from './codec-failures.js';
import { id3v2TagLength } from './id3v2-header.js';

/** The fixed part of an ADTS header that states the configuration. */
const ADTS_FIXED_HEADER_BYTES = 4;

/** The highest sampling frequency index naming a rate: 7,350 Hz. */
const MAXIMUM_RATE_INDEX = 12;

/** The AudioSpecificConfig of an ADTS stream's first frame. */
export async function adtsAudioConfig(
  bytes: AudioBytes,
  signal?: CancellationSignal,
): Promise<DomainResult<Uint8Array>> {
  const start = await id3v2TagLength(bytes, signal);
  if (!start.ok) return start;
  if (start.value + ADTS_FIXED_HEADER_BYTES > bytes.size) {
    return fail(malformed('The file ends before its first ADTS frame header.'));
  }
  const header = await readExactly(bytes, start.value, ADTS_FIXED_HEADER_BYTES, signal);
  if (!header.ok) return header;
  const [sync = 0, flags = 0, third = 0, fourth = 0] = header.value;
  // A twelve-bit sync and layer zero.
  if (sync !== 0xff || (flags & 0xf6) !== 0xf0) {
    return fail(malformed('The file does not begin with an ADTS frame header.'));
  }
  const objectType = (third >> 6) + 1;
  const rateIndex = (third >> 2) & 0x0f;
  const channels = ((third & 0x01) << 2) | (fourth >> 6);
  if (rateIndex > MAXIMUM_RATE_INDEX) {
    return fail(malformed('The ADTS frame header states a sampling frequency index of no rate.'));
  }
  if (channels === 0) {
    // Channel configuration 0 states the channels in a program configuration
    // element inside the frame, which a two-byte configuration cannot carry.
    return fail(
      malformed('The ADTS stream states its channels in the frame rather than its header.'),
    );
  }
  return succeed(
    Uint8Array.of((objectType << 3) | (rateIndex >> 1), ((rateIndex & 1) << 7) | (channels << 3)),
  );
}
