/**
 * Small, named values the editing tests build their assets and operations
 * from, so each test states only what it is about.
 */

import { StandardLayouts, type ChannelLayout } from '../audio/channel-layout.js';
import { unsafeBrandId, type AssetId, type EditOperationId } from '../identity/branded-id.js';
import { AssetOrigin, type Asset } from '../project/asset.js';
import { derivedSampleCount, sampleRate, type SampleCount } from '../time/sample-time.js';
import { expectSuccess } from './unwrap.js';
import type { EditOperation, EditRange } from '../editing/operations.js';

const RATE = expectSuccess(sampleRate(48_000));
export const OTHER_RATE = expectSuccess(sampleRate(44_100));

export function frames(value: number): SampleCount {
  return derivedSampleCount(value);
}

export function range(start: number, end: number): EditRange {
  return { start: frames(start), end: frames(end) };
}

export function operationId(name: string): EditOperationId {
  return unsafeBrandId<'EditOperationId'>(`0000aaaa-${name}`);
}

export function assetOf(
  name: string,
  length: number,
  edits: readonly EditOperation[] = [],
  layout: ChannelLayout = StandardLayouts.stereo,
  rate = RATE,
): Asset {
  const id: AssetId = unsafeBrandId<'AssetId'>(`0000bbbb-${name}`);
  return {
    id,
    displayName: name,
    origin: AssetOrigin.Imported,
    sampleRate: rate,
    channelLayout: layout,
    length: frames(length),
    storageKey: `content:${name}`,
    edits,
  };
}
