/**
 * An asset an editor view can open: audio the session knows, with what it is
 * called, its rate, its layout, its length, how to describe it to the thread
 * that reads it, and the markers and regions it opens with.
 *
 * No asset of a project is opened here until audio is imported into a project
 * at its own rate (ADR-0021), so the assets are the deterministic test assets
 * (`test-assets.ts`) and the sound of a reference picture the browser could
 * decode. Each keeps its native rate (REQ-ARCH-085): playback runs at the
 * asset's rate, the peaks are made at it and every position in the editor is a
 * boundary at it.
 */

import type { ChannelLayout, Marker, Region, SampleCount, SampleRate } from '@audiogubbins/domain';
import type { PcmDescription } from '@audiogubbins/audio-engine';

/** An asset an editor view can open. */
export interface EditorAsset {
  /** What the asset is, stable across sessions: views name it, and its peaks are kept under it. */
  readonly id: string;
  readonly name: string;
  /** What it holds, in a sentence, for the list an empty view offers. */
  readonly description: string;
  readonly sampleRate: SampleRate;
  readonly layout: ChannelLayout;
  readonly length: SampleCount;
  /** Which version of its audio, so peaks kept for another are never drawn for it. */
  readonly revision: string;
  /**
   * Its audio, described for the thread that reads it. Arrays in memory are
   * transferred there, so each call gives arrays the caller may lose.
   */
  readonly describe: () => PcmDescription;
  /** The markers and regions it opens with, at its own frames. */
  readonly markers: readonly Marker[];
  readonly regions: readonly Region[];
}

/** The FNV-1a offset basis and prime, for a short fingerprint of a description. */
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * A short, stable fingerprint of `text`, written in hexadecimal: the revision
 * of an asset whose audio is described by that text, so a change to how an
 * asset is made changes its revision without anyone remembering to.
 */
export function revisionOf(text: string): string {
  let hash = FNV_OFFSET;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
