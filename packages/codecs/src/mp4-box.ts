/**
 * ISO base media boxes (ISO/IEC 14496-12), as the MP4 writer and the `ilst`
 * metadata assemble them: a 32-bit size, a four-character type and a body, and
 * the full box, whose body begins with a version byte and 24 bits of flags. The
 * writer's boxes other than `mdat` are far below four gibibytes, so none here
 * needs the 64-bit size.
 */

import { ByteWriter, concatenate } from './byte-writer.js';

/** A box of `type` holding `parts` in order. */
export function box(type: string, ...parts: readonly Uint8Array[]): Uint8Array {
  const body = concatenate(parts);
  return concatenate([
    new ByteWriter()
      .u32(8 + body.length)
      .latin1(type)
      .toBytes(),
    body,
  ]);
}

/** A full box of `type`, its version and flags, holding `parts` in order. */
export function fullBox(
  type: string,
  version: number,
  flags: number,
  ...parts: readonly Uint8Array[]
): Uint8Array {
  return box(type, new ByteWriter().u8(version).u24(flags).toBytes(), ...parts);
}
