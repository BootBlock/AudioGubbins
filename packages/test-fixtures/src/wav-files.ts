/**
 * A signal fixture written as a WAV file, as a person's audio file arrives: a
 * canonical 16-bit PCM file, the commonest form there is, so an import, a
 * paste or a browser test is given bytes rather than a decoded signal.
 *
 * Only the canonical form. The codecs package has its own writer for every
 * form and every malformation it reads; this one makes the file a person most
 * often has, with no option for any other.
 */

import type { SignalFixture } from './signals.js';

/** The size of a canonical WAV header, before the samples. */
const HEADER_BYTES = 44;

/** The largest value a 16-bit sample holds. */
const FULL_SCALE = 32_767;

/** `fixture` as a canonical 16-bit PCM WAV file, each sample rounded to the nearest step. */
export function wavFile(fixture: SignalFixture): Uint8Array<ArrayBuffer> {
  const channels = fixture.channels.length;
  const frames = fixture.length;
  const dataBytes = frames * channels * 2;
  const bytes = new Uint8Array(HEADER_BYTES + dataBytes);
  const view = new DataView(bytes.buffer);
  const text = (at: number, value: string): void => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(at + index, value.charCodeAt(index));
    }
  };
  text(0, 'RIFF');
  view.setUint32(4, bytes.length - 8, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, fixture.sampleRate, true);
  view.setUint32(28, fixture.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, dataBytes, true);
  for (let frame = 0; frame < frames; frame += 1) {
    for (const [channel, samples] of fixture.channels.entries()) {
      const sample = Math.max(-1, Math.min(1, samples[frame] ?? 0));
      view.setInt16(
        HEADER_BYTES + (frame * channels + channel) * 2,
        Math.round(sample * FULL_SCALE),
        true,
      );
    }
  }
  return bytes;
}
