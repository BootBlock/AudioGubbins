/**
 * The metadata an exported file carries, by the export's policy (ADR-0093,
 * REQ-STOR-166).
 *
 * `full` carries the project's metadata with the region's over it, part by
 * part; `minimal` carries the title and the loops alone; `none` carries
 * nothing. The person's edits then set or remove text fields, in order.
 * Positions arrive in the frames of the span exported, from its start, at
 * the audio's rate, and leave at the file's rate, scaled by the domain's one
 * rounding rule for a change of rate, so a loop exported at its own rate is
 * exact (REQ-GAME-121). Nothing is added that was not given: no path, user,
 * machine or time zone.
 */

import {
  addSamples,
  combine,
  convertSampleRate,
  flatMapResult,
  mapResult,
  subtractSamples,
  succeed,
  type DomainResult,
  type SampleCount,
  type SampleRate,
} from '@audiogubbins/domain';
import type { CuePoint, MetadataLoop, MetadataMap, MetadataTextKey } from '@audiogubbins/codecs';

import type { MetadataSettings } from './export-settings.js';

/** The rates the metadata's positions are scaled between. */
export interface MetadataRates {
  readonly from: SampleRate;
  readonly to: SampleRate;
}

/** The project's map with the region's over it, each part the region states replacing the project's. */
function merged(project: MetadataMap, region: MetadataMap | undefined): MetadataMap {
  if (region === undefined) return project;
  return {
    ...project,
    ...region,
    text: { ...project.text, ...region.text },
  };
}

function kept(map: MetadataMap, policy: MetadataSettings['policy']): MetadataMap {
  switch (policy) {
    case 'full':
      return map;
    case 'minimal': {
      const title = map.text?.title;
      return {
        ...(title === undefined ? {} : { text: { title } }),
        ...(map.loops === undefined ? {} : { loops: map.loops }),
      };
    }
    case 'none':
      return {};
  }
}

/** Whether `key` is one of the map's own text keys, as `Object.entries` gives them back untyped. */
function isTextKey(key: string, map: MetadataMap): key is MetadataTextKey {
  return map.text !== undefined && Object.hasOwn(map.text, key);
}

function edited(map: MetadataMap, edits: MetadataSettings['edits']): MetadataMap {
  if (edits.length === 0) return map;
  // The last edit of a key decides it: a value set, or `undefined` for one removed.
  const decided = new Map<MetadataTextKey, string | undefined>(
    edits.map((edit) => [edit.key, edit.kind === 'set' ? edit.value : undefined]),
  );
  const text: Partial<Record<MetadataTextKey, string>> = {};
  for (const [key, value] of Object.entries(map.text ?? {})) {
    if (!isTextKey(key, map) || decided.has(key)) continue;
    text[key] = value;
  }
  for (const [key, value] of decided) if (value !== undefined) text[key] = value;
  return { ...map, text };
}

function scaled(frames: SampleCount, rates: MetadataRates): DomainResult<SampleCount> {
  return convertSampleRate(frames, rates.from, rates.to);
}

function scaledCue(cue: CuePoint, rates: MetadataRates): DomainResult<CuePoint> {
  return mapResult(scaled(cue.position, rates), (position) => ({ ...cue, position }));
}

/** A loop's start and end scaled, its length the difference of the two as the rule places them. */
function scaledLoop(loop: MetadataLoop, rates: MetadataRates): DomainResult<MetadataLoop> {
  return flatMapResult(scaled(loop.start, rates), (start) =>
    flatMapResult(addSamples(loop.start, loop.length), (end) =>
      flatMapResult(scaled(end, rates), (scaledEnd) =>
        mapResult(subtractSamples(scaledEnd, start), (length) => ({ ...loop, start, length })),
      ),
    ),
  );
}

function scaledPositions(map: MetadataMap, rates: MetadataRates): DomainResult<MetadataMap> {
  const cues = combine((map.cues ?? []).map((cue) => scaledCue(cue, rates)));
  const loops = combine((map.loops ?? []).map((loop) => scaledLoop(loop, rates)));
  const reference =
    map.broadcast === undefined ? undefined : scaled(map.broadcast.timeReference, rates);
  return flatMapResult(cues, (scaledCues) =>
    flatMapResult(loops, (scaledLoops) => {
      if (reference !== undefined && !reference.ok) return reference;
      return succeed({
        ...map,
        ...(map.cues === undefined ? {} : { cues: scaledCues }),
        ...(map.loops === undefined ? {} : { loops: scaledLoops }),
        ...(map.broadcast === undefined || reference === undefined
          ? {}
          : { broadcast: { ...map.broadcast, timeReference: reference.value } }),
      });
    }),
  );
}

/**
 * The metadata a file carries: the project's map, the region's where the file
 * is a region, kept by the policy, edited, and placed at the file's rate.
 */
export function exportMetadata(
  project: MetadataMap,
  region: MetadataMap | undefined,
  settings: MetadataSettings,
  rates: MetadataRates,
): DomainResult<MetadataMap> {
  return scaledPositions(
    edited(kept(merged(project, region), settings.policy), settings.edits),
    rates,
  );
}
