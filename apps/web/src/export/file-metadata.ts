/**
 * The metadata an exported file carries, gathered from the project (ADR-0093,
 * REQ-GAME-121, REQ-STOR-166) and kept, edited and placed at the file's rate
 * by the export's settings (`exportMetadata`).
 *
 * What is position-free comes from the file the asset was imported from, as
 * its provenance keeps it: its text, its foreign fields, its broadcast
 * description and its sampler tuning. Cover art is described in provenance
 * but never stored, so none is written. Positions come from the project as
 * the person left it, never from the source file, whose cues and loops became
 * the asset's markers and looping regions when it was imported and have moved
 * with every edit since: each marker the file spans becomes a cue, and each
 * looping region it holds whole becomes a forward, endless loop. A region's
 * file carries the region's name as its title and its own loop over the
 * asset's, and the markers inside it.
 *
 * Every position is in the frames of the span exported, from its start, at
 * the audio's rate, as `exportMetadata` takes them.
 */

import type { CuePoint, MetadataLoop, MetadataMap } from '@audiogubbins/codecs';
import {
  derivedSampleCount,
  type DomainResult,
  type PlacedMarker,
  type PlacedRegion,
  type SampleCount,
} from '@audiogubbins/domain';
import { exportMetadata, type ExportSettings, type PlannedFile } from '@audiogubbins/import-export';
import type { KeptMetadata } from '@audiogubbins/project-format';

import type { EditorAsset } from '../assets/editor-asset.js';

/** The frames of a span: where it starts in the audio it is of, and how long it is. */
interface Window {
  readonly start: SampleCount;
  readonly length: SampleCount;
}

/** Whether `position` lies in the window, its end included, where a cue may mark the last frame's end. */
function within(position: number, window: Window): boolean {
  return position >= window.start && position <= window.start + window.length;
}

/** Each marker inside the window, as a cue from the window's start. */
function cuesIn(markers: readonly PlacedMarker[], window: Window): readonly CuePoint[] {
  return markers
    .filter((marker) => within(marker.position, window))
    .map((marker) => ({
      position: derivedSampleCount(marker.position - window.start),
      name: marker.displayName,
    }));
}

/** A region's loop, from `origin` in the frames it is written in. */
function loopOf(region: PlacedRegion, origin: number): MetadataLoop | undefined {
  const { loop } = region;
  if (loop === undefined) return undefined;
  return {
    start: derivedSampleCount(origin + loop.loopStart),
    length: derivedSampleCount(loop.loopEnd - loop.loopStart),
    playCount: 'endless',
    direction: 'forward',
    name: region.displayName,
  };
}

/** The loop of each looping region the window holds whole, from the window's start. */
function loopsIn(regions: readonly PlacedRegion[], window: Window): readonly MetadataLoop[] {
  return regions.flatMap((region) => {
    const whole =
      region.start >= window.start && region.start + region.length <= window.start + window.length;
    const loop = whole ? loopOf(region, region.start - window.start) : undefined;
    return loop === undefined ? [] : [loop];
  });
}

/** The position-free parts of the source file's metadata, its broadcast reference moved by `offset`. */
function sourceParts(kept: KeptMetadata | undefined, offset: number): MetadataMap {
  if (kept === undefined) return {};
  const { text, foreign, broadcast, tuning } = kept;
  return {
    ...(text === undefined ? {} : { text }),
    ...(foreign === undefined ? {} : { foreign }),
    ...(broadcast === undefined
      ? {}
      : {
          broadcast: {
            ...broadcast,
            timeReference: derivedSampleCount(broadcast.timeReference + offset),
          },
        }),
    ...(tuning === undefined ? {} : { tuning }),
  };
}

/** What the file of `file` is given to carry, before the export's settings keep and edit it. */
export interface MetadataSources {
  /** The asset exported, as its view places its markers and regions. */
  readonly asset: EditorAsset;

  /** The region the file is of, as its own view places its markers, where it is a region's. */
  readonly region: EditorAsset | undefined;

  /** The metadata of the file the asset was imported from, as provenance keeps it. */
  readonly kept: KeptMetadata | undefined;
}

/**
 * The metadata the file `file` of an export as `settings` set it carries, at
 * the file's rate, or why its positions cannot be placed there.
 */
export function fileMetadata(
  file: PlannedFile,
  settings: ExportSettings,
  sources: MetadataSources,
): DomainResult<MetadataMap> {
  const { span } = file;
  const { asset, region, kept } = sources;
  const placed =
    span.region === undefined ? undefined : asset.regions.find((one) => one.id === span.region?.id);
  const rates = { from: span.audio.sampleRate, to: file.render.sampleRate };
  if (placed === undefined || region === undefined) {
    const window = { start: span.start, length: span.length };
    const project: MetadataMap = {
      ...sourceParts(kept, span.start),
      cues: cuesIn(asset.markers, window),
      loops: loopsIn(asset.regions, window),
    };
    return exportMetadata(project, undefined, settings.metadata, rates);
  }
  // The region's own audio, from its first frame: its view's markers are there already.
  const own = { start: span.start, length: span.length };
  const loop = loopOf(placed, 0);
  const project: MetadataMap = {
    ...sourceParts(kept, placed.start),
    cues: cuesIn(region.markers, own),
  };
  const regional: MetadataMap = {
    text: { title: placed.displayName },
    loops: loop === undefined ? [] : [loop],
  };
  return exportMetadata(project, regional, settings.metadata, rates);
}
