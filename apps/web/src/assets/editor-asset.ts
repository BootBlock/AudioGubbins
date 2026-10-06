/**
 * An asset an editor view can open: audio the session knows, with what it is
 * called, its rate, its layout, its length, how to describe it to the thread
 * that reads it, what it belongs to, and the markers and regions it shows.
 *
 * Most are the open project's assets and regions (`project-assets.ts`), each
 * its edit plan over the files its media is kept in. The rest belong to the
 * session alone: the deterministic test assets (`test-assets.ts`) and the
 * sound of a reference picture the browser could decode, which no project
 * holds, so nothing marks or edits them. Each keeps its native rate
 * (REQ-ARCH-085): playback runs at the asset's rate, the peaks are made at it
 * and every position in the editor is a boundary at it.
 */

import type {
  Asset,
  ChannelLayout,
  EditPlan,
  PlacedMarker,
  PlacedRegion,
  Region,
  SampleCount,
  SampleRate,
} from '@audiogubbins/domain';
import type { PcmDescription } from '@audiogubbins/audio-engine';

/** What an asset belongs to, which says what may be done to it. */
export type AssetOwner =
  | {
      /** Audio the session made or decoded, which no project holds. */
      readonly kind: 'session';
      /** Why it takes no marker, region or edit, as a reader is told. */
      readonly reason: string;
    }
  | {
      /** An asset of the open project, or one of its regions. */
      readonly kind: 'project';
      readonly asset: Asset;
      readonly region?: Region;
      /** What is heard: the asset's chain, or the region's slice of it with its processing. */
      readonly plan: EditPlan;
      /** Where the view's first boundary lies on the asset's edited timeline. */
      readonly offset: SampleCount;
    };

/** The owner of an asset of the open project. */
export type ProjectOwner = Extract<AssetOwner, { readonly kind: 'project' }>;

/**
 * An asset's audio before its racks: what a rack edit over a range of it
 * reads, since a rack edit acts before the racks (ADR-0060's order).
 */
export interface UnrackedAudio {
  /** What it is made from, written out whole, as the audio heard's `content` is. */
  readonly content: string;
  /** Its layout, which a rack of the asset may change in the audio heard. */
  readonly layout: ChannelLayout;
  /** It, described as the audio heard is described. */
  readonly describe: () => PcmDescription;
}

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
  /**
   * What its audio is made from, written out whole: for an asset of the
   * project, its plan as the project writes it and the media that plan reads.
   * Two assets of one content sound alike, so work kept for one, such as a
   * detection's findings, answers for the other.
   */
  readonly content: string;
  /**
   * Which version of its audio, so peaks kept for another are never drawn for
   * it: a short fingerprint of its content, `revisionOf(content)`.
   */
  readonly revision: string;
  /**
   * Its audio, described for the thread that reads it. Arrays in memory are
   * transferred there, so each call gives arrays the caller may lose.
   */
  readonly describe: () => PcmDescription;
  /**
   * Its audio before its racks, or `undefined` where it has none, so the
   * audio heard is what a rack edit over a range of it reads.
   */
  readonly unracked: UnrackedAudio | undefined;
  readonly owner: AssetOwner;
  /** Its markers and regions, at its own frames, in position order. */
  readonly markers: readonly PlacedMarker[];
  readonly regions: readonly PlacedRegion[];
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
