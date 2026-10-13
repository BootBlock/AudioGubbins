/**
 * The assembly of a header or metadata block whose length is learnt as it is
 * written.
 *
 * Every container this package frames writes fields of both byte orders, some
 * of them 24 or 64 bits wide, around bodies of other blocks. The writer grows
 * one buffer by doubling, so a block of many small fields costs one copy per
 * doubling rather than one per field, and `bytes` answers a view of what was
 * written without copying it again.
 */

/** The first capacity of a writer: most headers fit, and a picture grows it a few times. */
const INITIAL_CAPACITY = 256;

/** The largest whole number a field of 64 bits is written from: past it a number is not exact. */
const LARGEST_EXACT = Number.MAX_SAFE_INTEGER;

/** A growing buffer of fields and bytes. */
export class ByteWriter {
  private buffer = new Uint8Array(INITIAL_CAPACITY);
  private view = new DataView(this.buffer.buffer);
  private written = 0;

  /** How many bytes have been written. */
  get length(): number {
    return this.written;
  }

  u8(value: number): this {
    this.reserve(1).setUint8(this.written - 1, value);
    return this;
  }

  u16(value: number, littleEndian = false): this {
    this.reserve(2).setUint16(this.written - 2, value, littleEndian);
    return this;
  }

  u24(value: number): this {
    const view = this.reserve(3);
    view.setUint8(this.written - 3, (value >>> 16) & 0xff);
    view.setUint16(this.written - 2, value & 0xffff);
    return this;
  }

  u32(value: number, littleEndian = false): this {
    this.reserve(4).setUint32(this.written - 4, value, littleEndian);
    return this;
  }

  i32(value: number, littleEndian = false): this {
    this.reserve(4).setInt32(this.written - 4, value, littleEndian);
    return this;
  }

  /**
   * A 64-bit unsigned field from a whole number no larger than 2^53 - 1, the
   * largest every caller's sizes and positions reach exactly.
   */
  u64(value: number, littleEndian = false): this {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(
        `A 64-bit field is written from an exact whole number, not ${String(value)}.`,
      );
    }
    const high = Math.floor(value / 2 ** 32);
    const low = value % 2 ** 32;
    const view = this.reserve(8);
    view.setUint32(this.written - 8, littleEndian ? low : high, littleEndian);
    view.setUint32(this.written - 4, littleEndian ? high : low, littleEndian);
    return this;
  }

  bytes(bytes: Uint8Array): this {
    this.reserve(bytes.length);
    this.buffer.set(bytes, this.written - bytes.length);
    return this;
  }

  /** `count` zero bytes. */
  zeros(count: number): this {
    this.reserve(count);
    this.buffer.fill(0, this.written - count, this.written);
    return this;
  }

  /** Text whose every character is below 256, one byte each: a four-character code or an ASCII key. */
  latin1(text: string): this {
    const view = this.reserve(text.length);
    const start = this.written - text.length;
    for (let index = 0; index < text.length; index += 1) {
      const unit = text.charCodeAt(index);
      if (unit > 0xff)
        throw new RangeError('A one-byte text field holds characters below 256 alone.');
      view.setUint8(start + index, unit);
    }
    return this;
  }

  /** Overwrites a 32-bit field already written, for a size learnt after its body. */
  patchU32(offset: number, value: number, littleEndian = false): this {
    this.view.setUint32(offset, value, littleEndian);
    return this;
  }

  /** The bytes written, as a view of the writer's buffer: write nothing more once it is taken. */
  toBytes(): Uint8Array {
    return this.buffer.subarray(0, this.written);
  }

  /** Room for `count` more bytes, counted as written, and the view to write them through. */
  private reserve(count: number): DataView {
    const needed = this.written + count;
    if (needed > LARGEST_EXACT)
      throw new RangeError('A block cannot be larger than an exact length.');
    if (needed > this.buffer.length) {
      let capacity = this.buffer.length * 2;
      while (capacity < needed) capacity *= 2;
      const grown = new Uint8Array(capacity);
      grown.set(this.buffer.subarray(0, this.written));
      this.buffer = grown;
      this.view = new DataView(grown.buffer);
    }
    this.written = needed;
    return this.view;
  }
}

/** The parts joined into one array. */
export function concatenate(parts: readonly Uint8Array[]): Uint8Array {
  let length = 0;
  for (const part of parts) length += part.length;
  const joined = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
}
