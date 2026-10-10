/**
 * How the GPU backends hold fields (ADR-0082): each in slices no larger than
 * the device takes as a texture, and every texture in a cache of the values a
 * frame carries, bounded by bytes and emptied least recently drawn first.
 *
 * The cache is the only memory of a field a backend keeps. A lost device or
 * context takes the cache with it, and the next frame that draws the field
 * uploads it again.
 */

/** What a backend holds field textures within unless it is told otherwise: 64 MiB. */
export const FIELD_TEXTURE_BUDGET = 64 * 1024 * 1024;

/** What a backend holds ramp textures within: 256 ramps of 1 KiB. */
export const RAMP_TEXTURE_BUDGET = 256 * 1024;

/** A part of a field, in cells, uploaded as one texture. */
export interface FieldSlice {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A field of `width` by `height` cells cut into slices no wider or taller than `largest`. */
export function fieldSlices(width: number, height: number, largest: number): readonly FieldSlice[] {
  const slices: FieldSlice[] = [];
  for (let y = 0; y < height; y += largest) {
    for (let x = 0; x < width; x += largest) {
      slices.push({
        x,
        y,
        width: Math.min(largest, width - x),
        height: Math.min(largest, height - y),
      });
    }
  }
  return slices;
}

/**
 * Textures by key, within a budget of bytes. A frame takes what it draws and
 * holds what it uploads, then trims: any texture larger than the whole budget
 * goes, having been drawn once, and then the least recently drawn until the
 * rest fit. Trimming waits for the frame, so nothing a frame draws is released
 * before the frame is submitted.
 */
export class TextureCache<Texture> {
  readonly #budget: number;
  readonly #release: (texture: Texture) => void;
  /** In the order they were last drawn, least recently first. */
  readonly #held = new Map<string, { readonly texture: Texture; readonly bytes: number }>();
  #bytes = 0;

  constructor(budget: number, release: (texture: Texture) => void) {
    this.#budget = budget;
    this.#release = release;
  }

  /** The bytes held. */
  get bytes(): number {
    return this.#bytes;
  }

  /** The texture held for `key`, drawn now, or `undefined` where none is held. */
  take(key: string): Texture | undefined {
    const entry = this.#held.get(key);
    if (entry === undefined) return undefined;
    this.#held.delete(key);
    this.#held.set(key, entry);
    return entry.texture;
  }

  /** Holds `texture`, uploaded for `key` when `take` found none, as drawn now. */
  hold(key: string, texture: Texture, bytes: number): void {
    this.#held.set(key, { texture, bytes });
    this.#bytes += bytes;
  }

  /** Releases what is past the budget, once a frame has been submitted. */
  trim(): void {
    for (const [key, entry] of this.#held) {
      if (entry.bytes > this.#budget) this.#drop(key, entry.texture, entry.bytes);
    }
    for (const [key, entry] of this.#held) {
      if (this.#bytes <= this.#budget) return;
      this.#drop(key, entry.texture, entry.bytes);
    }
  }

  #drop(key: string, texture: Texture, bytes: number): void {
    this.#held.delete(key);
    this.#bytes -= bytes;
    this.#release(texture);
  }
}
