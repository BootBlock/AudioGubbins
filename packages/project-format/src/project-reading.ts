/**
 * Reading the domain project from a project document: its settings and each
 * list of entities, in the order their references need (REQ-STOR-026,
 * REQ-EXEC-136.12).
 *
 * Chains are read first, since tracks and buses name them; then buses, whose
 * routing is checked once all are known; then tracks, assets, and the clips,
 * regions and markers that refer to them; and the track order last.
 */

import type { Project, ProjectSettings, ProcessorId, Track, TrackId } from '@audiogubbins/domain';

import type { JsonObject } from './canonical-json.js';
import {
  entitiesOf,
  listConverter,
  objectOf,
  pathOf,
  required,
  type Converter,
  type Reading,
} from './document-reading.js';
import { effectChainConverter } from './processing-reading.js';
import { readBuses, trackConverter } from './routing-reading.js';
import { asId } from './scalar-reading.js';
import { asAsset, asMarker, asRegion, clipConverter } from './timeline-reading.js';
import { MAXIMUM_ENTITIES, asChannelLayout, asName, asSampleRate } from './value-reading.js';

const PROJECT_MEMBERS: ReadonlySet<string> = new Set([
  'id',
  'displayName',
  'settings',
  'assets',
  'tracks',
  'buses',
  'clips',
  'regions',
  'markers',
  'effectChains',
  'trackOrder',
]);
const SETTINGS_MEMBERS: ReadonlySet<string> = new Set(['sampleRate', 'channelLayout']);

const asTrackOrder = listConverter(MAXIMUM_ENTITIES, asId<'TrackId'>);

/** A project's entity lists and track order: everything but its name and settings. */
type ProjectContents = Omit<Project, 'id' | 'displayName' | 'settings'>;

/** Reads the project. */
export const asProject: Converter<Project> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, PROJECT_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);

  const id = required(reading, object, at, 'id', asId<'ProjectId'>);
  const displayName = required(reading, object, at, 'displayName', asName);
  const settings = required(reading, object, at, 'settings', asSettings);
  const contents = readContents(reading, object, at);
  return id === undefined ||
    displayName === undefined ||
    settings === undefined ||
    contents === undefined
    ? undefined
    : { id, displayName, settings, ...contents };
};

const asSettings: Converter<ProjectSettings> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, SETTINGS_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);

  const sampleRate = required(reading, object, at, 'sampleRate', asSampleRate);
  const channelLayout = required(reading, object, at, 'channelLayout', asChannelLayout);
  return sampleRate === undefined || channelLayout === undefined
    ? undefined
    : { sampleRate, channelLayout };
};

/** Reads every entity list, each checked against those read before it. */
function readContents(
  reading: Reading,
  object: JsonObject,
  at: string,
): ProjectContents | undefined {
  const entities = <TEntity extends { readonly id: string }>(
    key: string,
    entity: Converter<TEntity>,
  ): ReadonlyMap<TEntity['id'], TEntity> | undefined =>
    entitiesOf(reading, object, at, key, MAXIMUM_ENTITIES, entity);

  const effectChains = entities('effectChains', effectChainConverter(new Set<ProcessorId>()));
  const buses = readBuses(reading, object, at, effectChains);
  const tracks = entities('tracks', trackConverter(buses, effectChains));
  const assets = entities('assets', asAsset);
  const clips = entities('clips', clipConverter(tracks, assets));
  const regions = entities('regions', asRegion);
  const markers = entities('markers', asMarker);
  const trackOrder = required(reading, object, at, 'trackOrder', asTrackOrder);
  if (trackOrder !== undefined && tracks !== undefined) {
    checkTrackOrder(reading, trackOrder, tracks, pathOf(at, 'trackOrder'));
  }

  if (
    effectChains === undefined ||
    buses === undefined ||
    tracks === undefined ||
    assets === undefined ||
    clips === undefined ||
    regions === undefined ||
    markers === undefined ||
    trackOrder === undefined
  ) {
    return undefined;
  }
  return { assets, tracks, buses, clips, regions, markers, effectChains, trackOrder };
}

/** Checks that the track order names every track exactly once. */
function checkTrackOrder(
  reading: Reading,
  trackOrder: readonly TrackId[],
  tracks: ReadonlyMap<TrackId, Track>,
  at: string,
): void {
  const seen = new Set<TrackId>();
  for (const [index, trackId] of trackOrder.entries()) {
    if (!tracks.has(trackId)) {
      reading.refuse(
        'project.unknown-track',
        'The track order names a track the project does not have.',
        pathOf(at, index),
      );
    } else if (seen.has(trackId)) {
      reading.refuse(
        'project.track-order-duplicate',
        'The track order names a track twice.',
        pathOf(at, index),
      );
    }
    seen.add(trackId);
  }
  for (const trackId of tracks.keys()) {
    if (!seen.has(trackId)) {
      reading.refuse(
        'project.track-order-missing-track',
        'The track order leaves out a track.',
        at,
        { trackId },
      );
    }
  }
}
