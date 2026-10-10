/**
 * What a Vorbis stream's headers say of the samples each audio packet decodes
 * to (Vorbis I, sections 4.2 and 4.3).
 *
 * The identification header states the two block sizes. The setup header
 * ends with the modes, each naming one of the two, but its codebooks, floors,
 * residues and mappings come first and are as long as their contents say, so
 * the whole header is read, field by field, to reach them. An audio packet
 * names its mode in the bits after its type bit; it decodes to a quarter of
 * the previous packet's block and a quarter of its own, and the first audio
 * packet to none, so a stream's granule positions follow from its packets.
 *
 * Every read is bounded by the packet: a header that ends before its fields
 * do, or states a value the specification forbids, is refused.
 */

import { fail, succeed, type DomainResult } from '@audiogubbins/domain';

import { invalidEncodedStream } from './framing-failures.js';

/** `vorbis`, after each header packet's type byte. */
const VORBIS = [0x76, 0x6f, 0x72, 0x62, 0x69, 0x73] as const;

/** The type byte of the identification, comment and setup headers. */
export const VorbisHeaderType = { Identification: 1, Comment: 3, Setup: 5 } as const;

/** The bytes of a header's type and `vorbis`. */
export const VORBIS_HEADER_PREFIX_BYTES = 7;

/** The bytes of the identification header (Vorbis I, section 4.2.2). */
const IDENTIFICATION_BYTES = 30;

/** A codebook's sync pattern, `BCV`. */
const CODEBOOK_SYNC = 0x564342;

/** The stream's block sizes and the block size each of its modes uses. */
export interface VorbisBlockSizes {
  readonly short: number;
  readonly long: number;

  /** Whether each mode, by its number, uses the long block. */
  readonly modeIsLong: readonly boolean[];
}

/** The integer's bit length: 0 for 0, 1 for 1, 2 for 2 and 3, and so on (`ilog`). */
function ilog(value: number): number {
  return value <= 0 ? 0 : 32 - Math.clz32(value);
}

/** A header that breaks the specification, refused with the reason. */
class MalformedHeader extends Error {}

/** Bits read least significant first, as Vorbis packs them, within one packet. */
class PacketBits {
  readonly #bytes: Uint8Array;
  #bit: number;

  constructor(bytes: Uint8Array, startByte: number) {
    this.#bytes = bytes;
    this.#bit = startByte * 8;
  }

  /** The next `count` bits, at most 32, as an unsigned number. */
  read(count: number): number {
    if (this.#bit + count > this.#bytes.length * 8) {
      throw new MalformedHeader('A Vorbis header ends before its fields do.');
    }
    let value = 0;
    for (let index = 0; index < count; index += 1) {
      const at = this.#bit + index;
      const bit = ((this.#bytes[at >>> 3] ?? 0) >>> (at & 7)) & 1;
      value += bit * 2 ** index;
    }
    this.#bit += count;
    return value;
  }

  /** Passes over `count` bits, refusing more than the packet holds. */
  skip(count: number): void {
    if (!Number.isSafeInteger(count) || this.#bit + count > this.#bytes.length * 8) {
      throw new MalformedHeader('A Vorbis header ends before its fields do.');
    }
    this.#bit += count;
  }
}

/** Whether `packet` is the Vorbis header of `type`. */
export function isVorbisHeader(packet: Uint8Array, type: number): boolean {
  return (
    packet.length >= VORBIS_HEADER_PREFIX_BYTES &&
    packet[0] === type &&
    VORBIS.every((byte, index) => packet[index + 1] === byte)
  );
}

/** The largest whole `r` with `r ** dimensions` at most `entries` (`lookup1_values`). */
function lookup1Values(entries: number, dimensions: number): number {
  let values = Math.floor(entries ** (1 / dimensions));
  while ((values + 1) ** dimensions <= entries) values += 1;
  while (values > 0 && values ** dimensions > entries) values -= 1;
  return values;
}

/** Reads past one codebook (section 3.2.1). */
function skipCodebook(bits: PacketBits): void {
  if (bits.read(24) !== CODEBOOK_SYNC) {
    throw new MalformedHeader('A Vorbis codebook does not begin with its sync pattern.');
  }
  const dimensions = bits.read(16);
  const entries = bits.read(24);
  if (bits.read(1) === 1) {
    bits.read(5);
    for (let entry = 0; entry < entries;) {
      entry += bits.read(ilog(entries - entry));
      if (entry > entries) throw new MalformedHeader('A Vorbis codebook lists too many lengths.');
    }
  } else {
    const sparse = bits.read(1) === 1;
    for (let entry = 0; entry < entries; entry += 1) {
      if (!sparse || bits.read(1) === 1) bits.read(5);
    }
  }
  const lookup = bits.read(4);
  if (lookup === 0) return;
  if (lookup > 2) throw new MalformedHeader('A Vorbis codebook names no lookup type.');
  bits.skip(64);
  const valueBits = bits.read(4) + 1;
  bits.read(1);
  const values = lookup === 1 ? lookup1Values(entries, dimensions) : entries * dimensions;
  bits.skip(values * valueBits);
}

/** Reads past one floor (section 6.2.1 and 7.2.2). */
function skipFloor(bits: PacketBits): void {
  const type = bits.read(16);
  if (type === 0) {
    bits.skip(8 + 16 + 16 + 6 + 8);
    bits.skip((bits.read(4) + 1) * 8);
    return;
  }
  if (type !== 1) throw new MalformedHeader('A Vorbis floor names no floor type.');
  const partitions = bits.read(5);
  const classes = Array.from({ length: partitions }, () => bits.read(4));
  const dimensions: number[] = [];
  for (let index = 0; index <= Math.max(-1, ...classes); index += 1) {
    dimensions.push(bits.read(3) + 1);
    const subclasses = bits.read(2);
    if (subclasses > 0) bits.read(8);
    bits.skip((1 << subclasses) * 8);
  }
  bits.read(2);
  const rangeBits = bits.read(4);
  for (const index of classes) bits.skip((dimensions[index] ?? 0) * rangeBits);
}

/** Reads past one residue (section 8.6.1). */
function skipResidue(bits: PacketBits): void {
  if (bits.read(16) > 2) throw new MalformedHeader('A Vorbis residue names no residue type.');
  bits.skip(24 * 3);
  const classifications = bits.read(6) + 1;
  bits.read(8);
  const cascades = Array.from({ length: classifications }, () => {
    const low = bits.read(3);
    return bits.read(1) === 1 ? bits.read(5) * 8 + low : low;
  });
  for (const cascade of cascades) {
    let books = 0;
    for (let bit = 0; bit < 8; bit += 1) books += (cascade >>> bit) & 1;
    bits.skip(books * 8);
  }
}

/** Reads past one mapping (section 4.2.4, its fifth part). */
function skipMapping(bits: PacketBits, channels: number): void {
  if (bits.read(16) !== 0) throw new MalformedHeader('A Vorbis mapping names no mapping type.');
  const submaps = bits.read(1) === 1 ? bits.read(4) + 1 : 1;
  if (bits.read(1) === 1) {
    const steps = bits.read(8) + 1;
    bits.skip(steps * 2 * ilog(channels - 1));
  }
  if (bits.read(2) !== 0) throw new MalformedHeader('A Vorbis mapping sets its reserved bits.');
  if (submaps > 1) bits.skip(channels * 4);
  bits.skip(submaps * 24);
}

/**
 * The block sizes the identification and setup headers state, or why the
 * headers are not Vorbis I's.
 */
export function readVorbisBlockSizes(
  identification: Uint8Array,
  setup: Uint8Array,
): DomainResult<VorbisBlockSizes> {
  if (
    !isVorbisHeader(identification, VorbisHeaderType.Identification) ||
    identification.length < IDENTIFICATION_BYTES
  ) {
    return fail(invalidEncodedStream('The first Vorbis packet is not an identification header.'));
  }
  const channels = identification[11] ?? 0;
  const sizes = identification[28] ?? 0;
  const short = 1 << (sizes & 0x0f);
  const long = 1 << (sizes >>> 4);
  if (channels === 0 || short < 64 || long > 8192 || short > long) {
    return fail(
      invalidEncodedStream('The Vorbis identification header states no channels or block sizes.'),
    );
  }
  if (!isVorbisHeader(setup, VorbisHeaderType.Setup)) {
    return fail(invalidEncodedStream('The third Vorbis packet is not a setup header.'));
  }
  try {
    const bits = new PacketBits(setup, VORBIS_HEADER_PREFIX_BYTES);
    const codebooks = bits.read(8) + 1;
    for (let index = 0; index < codebooks; index += 1) skipCodebook(bits);
    const times = bits.read(6) + 1;
    for (let index = 0; index < times; index += 1) {
      if (bits.read(16) !== 0) throw new MalformedHeader('A Vorbis time-domain value is not 0.');
    }
    const floors = bits.read(6) + 1;
    for (let index = 0; index < floors; index += 1) skipFloor(bits);
    const residues = bits.read(6) + 1;
    for (let index = 0; index < residues; index += 1) skipResidue(bits);
    const mappings = bits.read(6) + 1;
    for (let index = 0; index < mappings; index += 1) skipMapping(bits, channels);
    const modes = bits.read(6) + 1;
    const modeIsLong = Array.from({ length: modes }, () => {
      const long = bits.read(1) === 1;
      bits.skip(32);
      bits.read(8);
      return long;
    });
    if (bits.read(1) !== 1)
      throw new MalformedHeader('The Vorbis setup header has no framing bit.');
    return succeed({ short, long, modeIsLong });
  } catch (error) {
    if (error instanceof MalformedHeader) return fail(invalidEncodedStream(error.message));
    throw error;
  }
}

/**
 * The block size of an audio packet, by the mode it names, or why it is not
 * an audio packet of the stream these sizes describe.
 */
export function vorbisPacketBlockSize(
  packet: Uint8Array,
  sizes: VorbisBlockSizes,
): DomainResult<number> {
  const first = packet[0];
  if (first === undefined || (first & 1) !== 0) {
    return fail(invalidEncodedStream('A Vorbis audio packet is empty or is a header.'));
  }
  // A stream has at most 64 modes, so the number is at most six bits, after the type bit.
  const mode = (first >>> 1) & ((1 << ilog(sizes.modeIsLong.length - 1)) - 1);
  const long = sizes.modeIsLong[mode];
  if (long === undefined) {
    return fail(invalidEncodedStream('A Vorbis audio packet names a mode the setup lacks.'));
  }
  return succeed(long ? sizes.long : sizes.short);
}
