/**
 * Source assets.
 *
 * REQ-ARCH-004.2 makes source media immutable: an asset describes audio that
 * AudioGubbins reads and never rewrites. Every edit is a parameter on something
 * that refers to an asset, never a change to the asset itself.
 *
 * An asset holds the audio's shape, not its samples. Sample data is large,
 * lives outside the domain, and is loaded on demand by the audio engine.
 * Keeping it out of the domain is what allows a project to describe an hour of
 * audio without an hour of audio being resident (REQ-ARCH-004.3).
 */

import type { AssetId } from '../identity/branded-id.js';
import type { ChannelLayout } from '../audio/channel-layout.js';
import type { SampleCount, SampleRate } from '../time/sample-time.js';
import type { EditOperation } from '../editing/operations.js';

/**
 * Where an asset's audio comes from.
 *
 * The domain names the origin but does not resolve it. Resolution needs storage
 * handles, permissions and user consent, which belong to the storage layer.
 */
export const AssetOrigin = {
  /** Imported from a file the user chose. */
  Imported: 'imported',

  /** Captured by AudioGubbins. */
  Recorded: 'recorded',

  /** Produced by AudioGubbins from other assets, such as a bounce. */
  Generated: 'generated',
} as const;

/** Where an asset's audio comes from. */
export type AssetOrigin = (typeof AssetOrigin)[keyof typeof AssetOrigin];

/**
 * An immutable source asset.
 *
 * `displayName` is what the user sees and may rename freely; it is never an
 * identifier (REQ-PROD-056, REQ-PRIV-164).
 */
export interface Asset {
  readonly id: AssetId;

  /** User-facing name. Renaming this changes nothing else. */
  readonly displayName: string;

  readonly origin: AssetOrigin;

  /** The asset's own sample rate, which need not match any other asset's. */
  readonly sampleRate: SampleRate;

  /** The asset's own channel layout, which need not match any other asset's. */
  readonly channelLayout: ChannelLayout;

  /** Length in sample frames at the asset's own rate. */
  readonly length: SampleCount;

  /**
   * A stable key for the asset's stored audio.
   *
   * Opaque to the domain. The storage layer decides what it means, so the
   * domain does not acquire an opinion about OPFS, file handles or blob URLs
   * (REQ-EXEC-136.4).
   */
  readonly storageKey: string;

  /**
   * What has been done to the asset, in order, over its unchanged source
   * (ADR-0051). Its source is never rewritten: an edit is an operation here,
   * and an undo withdraws the last.
   */
  readonly edits: readonly EditOperation[];
}

/**
 * A half-open range of sample frames within an asset.
 *
 * Half-open, `[start, start + length)`, so adjacent ranges tile without overlap
 * and a zero-length range is expressible. Closed ranges make "does the next one
 * start at the same sample?" ambiguous, which is how an off-by-one click at a
 * splice point gets written.
 */
export interface AssetRange {
  readonly assetId: AssetId;
  readonly start: SampleCount;
  readonly length: SampleCount;
}

/** The first sample frame after the range. */
export function assetRangeEnd(range: AssetRange): number {
  return range.start + range.length;
}

/** Whether the range lies entirely within the asset. */
export function assetRangeFitsAsset(range: AssetRange, asset: Asset): boolean {
  return range.assetId === asset.id && assetRangeEnd(range) <= asset.length;
}
