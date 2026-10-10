/**
 * The dither's key, from the export's settings: the same settings give the
 * same key, and so the same noise and the same bits, on every machine
 * (ADR-0092, REQ-ARCH-049).
 *
 * The settings are written as canonical text, every object's keys in sorted
 * order, and its UTF-16 code units, low byte first, are run through the
 * domain's CRC-32. The dither's own seed is among the settings, so a person
 * who wants other noise for the same settings changes the seed.
 */

import { crc32 } from '@audiogubbins/domain';

import type { ExportSettings } from './export-settings.js';

/** A value as text that does not depend on the order its object's keys were written in. */
function canonicalText(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalText).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value)
      .filter(([, one]) => one !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, one]) => `${JSON.stringify(key)}:${canonicalText(one)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** The 32-bit key the dither of an export with these settings draws its noise under. */
export function ditherKey(settings: ExportSettings): number {
  const text = canonicalText(settings);
  const bytes = new Uint8Array(text.length * 2);
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    bytes[index * 2] = unit & 0xff;
    bytes[index * 2 + 1] = unit >>> 8;
  }
  return crc32(bytes);
}
