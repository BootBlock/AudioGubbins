/**
 * Reading a project document's assets and its timeline's clips (REQ-STOR-026,
 * REQ-EXEC-136.12).
 *
 * Each entity is checked against what it refers to as it is read, so every
 * refusal names the member at fault: a clip's track and asset must exist and
 * its range must lie inside the asset. An asset's chain of edits is read here
 * by its shape; whether each operation may stand where it does needs every
 * asset a paste reads, so the project's reader checks it once all are read.
 * Regions and markers belong to an asset (`placement-reading.ts`).
 */

import {
  AssetOrigin,
  addSamples,
  assetRangeFitsAsset,
  type Asset,
  type AssetId,
  type AssetRange,
  type Clip,
  type SampleCount,
  type Track,
  type TrackId,
} from '@audiogubbins/domain';

import {
  objectOf,
  optional,
  pathOf,
  required,
  type Converter,
  type Reading,
} from './document-reading.js';
import { asEditChain } from './edit-reading.js';
import { asAssetName } from './given-names.js';
import { asBoolean, asId, oneOfConverter, textConverter } from './scalar-reading.js';
import { asChannelLayout, asGain, asName, asSampleCount, asSampleRate } from './value-reading.js';

const ASSET_MEMBERS: ReadonlySet<string> = new Set([
  'id',
  'displayName',
  'origin',
  'sampleRate',
  'channelLayout',
  'length',
  'storageKey',
  'edits',
  'rack',
]);
const CLIP_MEMBERS: ReadonlySet<string> = new Set([
  'id',
  'trackId',
  'displayName',
  'source',
  'timelineStart',
  'timelineLength',
  'gain',
  'fadeInLength',
  'fadeOutLength',
  'muted',
]);
const RANGE_MEMBERS: ReadonlySet<string> = new Set(['assetId', 'start', 'length']);
const asOrigin = oneOfConverter(Object.values(AssetOrigin));

/**
 * A storage key as the document holds it. Its value is checked against the
 * asset's source once the sources are read.
 */
const asStorageKey = textConverter({ maximumLength: 256 });

/** Reads one asset. */
export const asAsset: Converter<Asset> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, ASSET_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);

  const id = required(reading, object, at, 'id', asId<'AssetId'>);
  const displayName = required(reading, object, at, 'displayName', asAssetName);
  const origin = required(reading, object, at, 'origin', asOrigin);
  const sampleRate = required(reading, object, at, 'sampleRate', asSampleRate);
  const channelLayout = required(reading, object, at, 'channelLayout', asChannelLayout);
  const length = required(reading, object, at, 'length', asSampleCount);
  const storageKey = required(reading, object, at, 'storageKey', asStorageKey);
  const edits = required(reading, object, at, 'edits', asEditChain);
  const rack = optional(reading, object, at, 'rack', asId<'EffectChainId'>);

  if (
    id === undefined ||
    displayName === undefined ||
    origin === undefined ||
    sampleRate === undefined ||
    channelLayout === undefined ||
    length === undefined ||
    storageKey === undefined ||
    edits === undefined
  ) {
    return undefined;
  }
  return {
    id,
    displayName,
    origin,
    sampleRate,
    channelLayout,
    length,
    storageKey,
    edits,
    ...(rack === undefined ? {} : { rack }),
  };
};

/**
 * A converter reading one clip, checked against the tracks and assets read
 * before it. A list that could not be read is `undefined`, and nothing is
 * checked against it, so one damaged list is not reported again as a missing
 * reference from every clip.
 */
export function clipConverter(
  tracks: ReadonlyMap<TrackId, Track> | undefined,
  assets: ReadonlyMap<AssetId, Asset> | undefined,
): Converter<Clip> {
  return (reading, value, parent, key) => {
    const object = objectOf(reading, value, parent, key, CLIP_MEMBERS);
    if (object === undefined) return undefined;
    const at = pathOf(parent, key);

    const id = required(reading, object, at, 'id', asId<'ClipId'>);
    const trackId = required(reading, object, at, 'trackId', asId<'TrackId'>);
    const displayName = required(reading, object, at, 'displayName', asName);
    const source = required(reading, object, at, 'source', asRange);
    const timelineStart = required(reading, object, at, 'timelineStart', asSampleCount);
    const timelineLength = required(reading, object, at, 'timelineLength', asSampleCount);
    const gain = required(reading, object, at, 'gain', asGain);
    const fadeInLength = required(reading, object, at, 'fadeInLength', asSampleCount);
    const fadeOutLength = required(reading, object, at, 'fadeOutLength', asSampleCount);
    const muted = required(reading, object, at, 'muted', asBoolean);

    if (
      id === undefined ||
      trackId === undefined ||
      displayName === undefined ||
      source === undefined ||
      timelineStart === undefined ||
      timelineLength === undefined ||
      gain === undefined ||
      fadeInLength === undefined ||
      fadeOutLength === undefined ||
      muted === undefined
    ) {
      return undefined;
    }
    const clip: Clip = {
      id,
      trackId,
      displayName,
      source,
      timelineStart,
      timelineLength,
      gain,
      fadeInLength,
      fadeOutLength,
      muted,
    };
    checkClip(reading, clip, at, tracks, assets);
    return clip;
  };
}

/** Checks a clip against what it refers to and against its own lengths. */
function checkClip(
  reading: Reading,
  clip: Clip,
  at: string,
  tracks: ReadonlyMap<TrackId, Track> | undefined,
  assets: ReadonlyMap<AssetId, Asset> | undefined,
): void {
  if (tracks !== undefined && !tracks.has(clip.trackId)) {
    reading.refuse(
      'project.unknown-track',
      'The clip is on a track the project does not have.',
      pathOf(at, 'trackId'),
    );
  }

  const asset = assets?.get(clip.source.assetId);
  if (assets !== undefined && asset === undefined) {
    reading.refuse(
      'project.unknown-asset',
      'The clip plays an asset the project does not have.',
      pathOf(pathOf(at, 'source'), 'assetId'),
    );
  } else if (asset !== undefined && !assetRangeFitsAsset(clip.source, asset)) {
    reading.refuse(
      'project.clip-outside-asset',
      'The clip plays past the end of its asset.',
      pathOf(at, 'source'),
      {
        assetLength: asset.length,
      },
    );
  }

  // No clip is stretched yet, so the time it occupies is the audio it plays.
  if (clip.timelineLength !== clip.source.length) {
    reading.refuse(
      'project.clip-length-mismatch',
      'An unstretched clip occupies as much of the timeline as it plays of its asset.',
      pathOf(at, 'timelineLength'),
    );
  }
  if (clip.fadeInLength + clip.fadeOutLength > clip.timelineLength) {
    reading.refuse(
      'project.clip-fades-exceed-length',
      'The clip fades in and out for longer than it lasts.',
      pathOf(at, 'fadeOutLength'),
    );
  }
  checkEnd(reading, clip.timelineStart, clip.timelineLength, pathOf(at, 'timelineLength'));
}

/** Refuses a span whose end cannot be represented as a sample count. */
function checkEnd(reading: Reading, start: SampleCount, length: SampleCount, at: string): void {
  const end = addSamples(start, length);
  if (!end.ok) reading.refuseAll(end.failures, at);
}

/** Reads the part of an asset a clip plays. */
const asRange: Converter<AssetRange> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, RANGE_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);

  const assetId = required(reading, object, at, 'assetId', asId<'AssetId'>);
  const start = required(reading, object, at, 'start', asSampleCount);
  const length = required(reading, object, at, 'length', asSampleCount);
  return assetId === undefined || start === undefined || length === undefined
    ? undefined
    : { assetId, start, length };
};
