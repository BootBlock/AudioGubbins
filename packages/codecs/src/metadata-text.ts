/**
 * The text codings metadata is stored in: UTF-8, Latin-1 and UTF-16.
 *
 * Written out rather than taken from the platform, since this package compiles
 * against the ES2023 library alone, where `TextEncoder` and `TextDecoder` do
 * not exist. Metadata is untrusted text (REQ-EXEC-136), but a tag with one bad
 * byte is still a tag: unlike a project file, whose damage must refuse it, a
 * title is decoded with U+FFFD in place of each ill-formed sequence, as the
 * WHATWG decoder does, so the rest of the file's metadata survives.
 */

/** The character a malformed sequence or a lone surrogate is read and written as. */
const REPLACEMENT = 0xfffd;

/** How many code units are gathered before they are turned into text, few enough for one call's arguments. */
const UNITS_PER_FLUSH = 4_096;

/** Turns code units into text a flush at a time. */
class UnitText {
  private text = '';
  private readonly units: number[] = [];

  push(unit: number): void {
    this.units.push(unit);
    if (this.units.length >= UNITS_PER_FLUSH) this.flush();
  }

  pushPoint(point: number): void {
    if (point > 0xffff) {
      this.push(0xd800 + ((point - 0x10000) >> 10));
      this.push(0xdc00 + ((point - 0x10000) & 0x3ff));
    } else {
      this.push(point);
    }
  }

  finish(): string {
    this.flush();
    return this.text;
  }

  private flush(): void {
    this.text += String.fromCharCode(...this.units);
    this.units.length = 0;
  }
}

/** The code point at `index` of `text` and how many units it took, a lone surrogate read as U+FFFD. */
function pointAt(text: string, index: number): readonly [point: number, units: number] {
  const unit = text.charCodeAt(index);
  if (unit < 0xd800 || unit > 0xdfff) return [unit, 1];
  const next = text.charCodeAt(index + 1);
  if (unit <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
    return [0x10000 + ((unit - 0xd800) << 10) + (next - 0xdc00), 2];
  }
  return [REPLACEMENT, 1];
}

/** The bytes of `text` in UTF-8, a lone surrogate written as U+FFFD, since it has no UTF-8 form. */
export function encodeUtf8(text: string): Uint8Array {
  const bytes: number[] = [];
  for (let index = 0; index < text.length;) {
    const [point, units] = pointAt(text, index);
    index += units;
    if (point < 0x80) {
      bytes.push(point);
    } else if (point < 0x800) {
      bytes.push(0xc0 | (point >> 6), 0x80 | (point & 0x3f));
    } else if (point < 0x10000) {
      bytes.push(0xe0 | (point >> 12), 0x80 | ((point >> 6) & 0x3f), 0x80 | (point & 0x3f));
    } else {
      bytes.push(
        0xf0 | (point >> 18),
        0x80 | ((point >> 12) & 0x3f),
        0x80 | ((point >> 6) & 0x3f),
        0x80 | (point & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
}

/** The byte at an offset the caller has checked is inside `bytes`. */
function byteAt(bytes: Uint8Array, offset: number): number {
  return bytes[offset] ?? 0;
}

/**
 * Decodes UTF-8, each maximal ill-formed subpart read as one U+FFFD (the
 * WHATWG decoder's rule, from Unicode's "best practice" for replacement).
 */
export function decodeUtf8(bytes: Uint8Array): string {
  const text = new UnitText();
  let offset = 0;
  while (offset < bytes.length) {
    const lead = byteAt(bytes, offset);
    offset += 1;
    if (lead < 0x80) {
      text.push(lead);
      continue;
    }
    let needed: number;
    let point: number;
    let lower = 0x80;
    let upper = 0xbf;
    if (lead >= 0xc2 && lead <= 0xdf) {
      needed = 1;
      point = lead & 0x1f;
    } else if (lead >= 0xe0 && lead <= 0xef) {
      needed = 2;
      point = lead & 0x0f;
      if (lead === 0xe0) lower = 0xa0;
      if (lead === 0xed) upper = 0x9f;
    } else if (lead >= 0xf0 && lead <= 0xf4) {
      needed = 3;
      point = lead & 0x07;
      if (lead === 0xf0) lower = 0x90;
      if (lead === 0xf4) upper = 0x8f;
    } else {
      text.push(REPLACEMENT);
      continue;
    }
    let complete = true;
    for (let index = 0; index < needed; index += 1) {
      const next = offset < bytes.length ? byteAt(bytes, offset) : -1;
      if (next < lower || next > upper) {
        complete = false;
        break;
      }
      lower = 0x80;
      upper = 0xbf;
      point = (point << 6) | (next & 0x3f);
      offset += 1;
    }
    text.pushPoint(complete ? point : REPLACEMENT);
  }
  return text.finish();
}

/** Decodes ISO 8859-1, every byte the character of that number. */
export function decodeLatin1(bytes: Uint8Array): string {
  const text = new UnitText();
  for (const byte of bytes) text.push(byte);
  return text.finish();
}

/** The bytes of `text` in ISO 8859-1, or `undefined` where a character has no Latin-1 form. */
export function encodeLatin1(text: string): Uint8Array | undefined {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit > 0xff) return undefined;
    bytes[index] = unit;
  }
  return bytes;
}

/**
 * Decodes UTF-16 in the byte order a leading byte order mark states, or in
 * `defaultBigEndian`'s where there is none, the mark itself not kept. A lone
 * surrogate and an odd last byte are read as U+FFFD.
 */
export function decodeUtf16(bytes: Uint8Array, defaultBigEndian: boolean): string {
  let bigEndian = defaultBigEndian;
  let offset = 0;
  if (bytes.length >= 2) {
    const first = byteAt(bytes, 0);
    const second = byteAt(bytes, 1);
    if (first === 0xfe && second === 0xff) {
      bigEndian = true;
      offset = 2;
    } else if (first === 0xff && second === 0xfe) {
      bigEndian = false;
      offset = 2;
    }
  }
  const unitAt = (at: number): number =>
    bigEndian
      ? (byteAt(bytes, at) << 8) | byteAt(bytes, at + 1)
      : byteAt(bytes, at) | (byteAt(bytes, at + 1) << 8);

  const text = new UnitText();
  while (offset + 1 < bytes.length) {
    const unit = unitAt(offset);
    offset += 2;
    if (unit >= 0xd800 && unit <= 0xdbff && offset + 1 < bytes.length) {
      const next = unitAt(offset);
      if (next >= 0xdc00 && next <= 0xdfff) {
        text.push(unit);
        text.push(next);
        offset += 2;
        continue;
      }
    }
    text.push(unit >= 0xd800 && unit <= 0xdfff ? REPLACEMENT : unit);
  }
  if (offset < bytes.length) text.push(REPLACEMENT);
  return text.finish();
}
