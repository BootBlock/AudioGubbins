/**
 * Writing and reading one history node as JSON (REQ-STOR-193, REQ-EXEC-136.12).
 *
 * A node is its own value, because the journal keeps one record per change and
 * the unpacked tree one file per node, and the whole history's document holds a
 * list of them. Every node is read through the same validation wherever it is
 * kept.
 *
 * The bounds here and in `invocation-json.ts` are what the history holds a node
 * to before recording it, by writing and reading it back, so no change is ever
 * recorded that its project could not read again.
 */

import type { JsonObject, JsonValue } from './canonical-json.js';
import {
  anyObjectOf,
  checkMembers,
  listConverter,
  objectOf,
  optional,
  pathOf,
  required,
  type Converter,
  type Reading,
} from './document-reading.js';
import { presentMembers } from './document-writing.js';
import { readInvocations, writeInvocation } from './invocation-json.js';
import type {
  AffectedEntities,
  ChangeNodeRecord,
  HistoryNodeRecord,
  OriginNodeRecord,
  ProjectOrigin,
} from './history-record.js';
import {
  asBoolean,
  asId,
  asStateFingerprint,
  oneOfConverter,
  textConverter,
} from './scalar-reading.js';
import { MAXIMUM_ENTITIES, asWholeQuantity } from './value-reading.js';

/** The longest description of a change, in UTF-16 code units. */
export const LONGEST_CHANGE_DESCRIPTION = 4_096;

const NODE_KINDS = ['origin', 'change'] as const;
const ORIGIN_KINDS = ['new', 'import', 'fork'] as const;

const ORIGIN_NODE_MEMBERS: ReadonlySet<string> = new Set([
  'kind',
  'id',
  'at',
  'origin',
  'stateFingerprint',
]);
const CHANGE_NODE_MEMBERS: ReadonlySet<string> = new Set([
  'kind',
  'id',
  'parent',
  'at',
  'description',
  'forward',
  'inverse',
  'affects',
  'stateFingerprint',
]);
const PLAIN_ORIGIN_MEMBERS: ReadonlySet<string> = new Set(['kind']);
const FORK_ORIGIN_MEMBERS: ReadonlySet<string> = new Set(['kind', 'project', 'node']);
const AFFECTED_MEMBERS: ReadonlySet<string> = new Set([
  'assets',
  'tracks',
  'buses',
  'clips',
  'regions',
  'markers',
  'effectChains',
  'project',
]);

const asNodeKind = oneOfConverter(NODE_KINDS);
const asOriginKind = oneOfConverter(ORIGIN_KINDS);
const asDescription = textConverter({ maximumLength: LONGEST_CHANGE_DESCRIPTION });

/** Writes a history node. */
export function writeHistoryNodeRecord(node: HistoryNodeRecord): JsonObject {
  if (node.kind === 'origin') {
    return presentMembers({
      kind: node.kind,
      id: node.id,
      at: node.at,
      origin: writeOrigin(node.origin),
      stateFingerprint: node.stateFingerprint,
    });
  }
  return presentMembers({
    kind: node.kind,
    id: node.id,
    parent: node.parent,
    at: node.at,
    description: node.description,
    forward: node.forward.map(writeInvocation),
    inverse: node.inverse.map(writeInvocation),
    affects: writeAffected(node.affects),
    stateFingerprint: node.stateFingerprint,
  });
}

function writeOrigin(origin: ProjectOrigin): JsonObject {
  return origin.kind === 'fork'
    ? { kind: origin.kind, project: origin.project, node: origin.node }
    : { kind: origin.kind };
}

/** Writes each list that has an entry, so a node that touched little is small. */
function writeAffected(affects: AffectedEntities): JsonObject {
  const listed = (ids: readonly string[]): JsonValue | undefined =>
    ids.length === 0 ? undefined : [...ids];
  return presentMembers({
    assets: listed(affects.assets),
    tracks: listed(affects.tracks),
    buses: listed(affects.buses),
    clips: listed(affects.clips),
    regions: listed(affects.regions),
    markers: listed(affects.markers),
    effectChains: listed(affects.effectChains),
    project: affects.project ? true : undefined,
  });
}

/** Reads a history node. */
export const readHistoryNodeRecord: Converter<HistoryNodeRecord> = (
  reading,
  value,
  parent,
  key,
) => {
  const object = anyObjectOf(reading, value, parent, key);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const kind = required(reading, object, at, 'kind', asNodeKind);
  if (kind === undefined) return undefined;
  if (kind === 'origin') {
    checkMembers(reading, object, at, ORIGIN_NODE_MEMBERS);
    return readOriginNode(reading, object, at);
  }
  checkMembers(reading, object, at, CHANGE_NODE_MEMBERS);
  return readChangeNode(reading, object, at);
};

function readOriginNode(
  reading: Reading,
  object: JsonObject,
  at: string,
): OriginNodeRecord | undefined {
  const id = required(reading, object, at, 'id', asId<'HistoryNodeId'>);
  const time = required(reading, object, at, 'at', asWholeQuantity);
  const origin = required(reading, object, at, 'origin', asOrigin);
  const stateFingerprint = optional(reading, object, at, 'stateFingerprint', asStateFingerprint);
  if (id === undefined || time === undefined || origin === undefined) return undefined;
  return {
    kind: 'origin',
    id,
    at: time,
    origin,
    ...(stateFingerprint === undefined ? {} : { stateFingerprint }),
  };
}

function readChangeNode(
  reading: Reading,
  object: JsonObject,
  at: string,
): ChangeNodeRecord | undefined {
  const id = required(reading, object, at, 'id', asId<'HistoryNodeId'>);
  const parent = optional(reading, object, at, 'parent', asId<'HistoryNodeId'>);
  const time = required(reading, object, at, 'at', asWholeQuantity);
  const description = required(reading, object, at, 'description', asDescription);
  const forward = required(reading, object, at, 'forward', readInvocations);
  const inverse = required(reading, object, at, 'inverse', readInvocations);
  const affects = required(reading, object, at, 'affects', asAffected);
  const stateFingerprint = optional(reading, object, at, 'stateFingerprint', asStateFingerprint);
  if (
    id === undefined ||
    time === undefined ||
    description === undefined ||
    forward === undefined ||
    inverse === undefined ||
    affects === undefined
  ) {
    return undefined;
  }
  if (parent === id) {
    reading.refuse('history.own-parent', 'A node cannot be its own parent.', pathOf(at, 'parent'));
    return undefined;
  }
  return {
    kind: 'change',
    id,
    ...(parent === undefined ? {} : { parent }),
    at: time,
    description,
    forward,
    inverse,
    affects,
    ...(stateFingerprint === undefined ? {} : { stateFingerprint }),
  };
}

const asOrigin: Converter<ProjectOrigin> = (reading, value, parent, key) => {
  const object = anyObjectOf(reading, value, parent, key);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const kind = required(reading, object, at, 'kind', asOriginKind);
  if (kind === undefined) return undefined;
  if (kind !== 'fork') {
    checkMembers(reading, object, at, PLAIN_ORIGIN_MEMBERS);
    return { kind };
  }
  checkMembers(reading, object, at, FORK_ORIGIN_MEMBERS);
  const project = required(reading, object, at, 'project', asId<'ProjectId'>);
  const node = required(reading, object, at, 'node', asId<'HistoryNodeId'>);
  return project === undefined || node === undefined ? undefined : { kind, project, node };
};

const asAssetIds = listConverter(MAXIMUM_ENTITIES, asId<'AssetId'>);
const asTrackIds = listConverter(MAXIMUM_ENTITIES, asId<'TrackId'>);
const asBusIds = listConverter(MAXIMUM_ENTITIES, asId<'BusId'>);
const asClipIds = listConverter(MAXIMUM_ENTITIES, asId<'ClipId'>);
const asRegionIds = listConverter(MAXIMUM_ENTITIES, asId<'RegionId'>);
const asMarkerIds = listConverter(MAXIMUM_ENTITIES, asId<'MarkerId'>);
const asChainIds = listConverter(MAXIMUM_ENTITIES, asId<'EffectChainId'>);

const asAffected: Converter<AffectedEntities> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, AFFECTED_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const assets = optional(reading, object, at, 'assets', asAssetIds);
  const tracks = optional(reading, object, at, 'tracks', asTrackIds);
  const buses = optional(reading, object, at, 'buses', asBusIds);
  const clips = optional(reading, object, at, 'clips', asClipIds);
  const regions = optional(reading, object, at, 'regions', asRegionIds);
  const markers = optional(reading, object, at, 'markers', asMarkerIds);
  const effectChains = optional(reading, object, at, 'effectChains', asChainIds);
  const project = optional(reading, object, at, 'project', asBoolean);
  return {
    assets: assets ?? [],
    tracks: tracks ?? [],
    buses: buses ?? [],
    clips: clips ?? [],
    regions: regions ?? [],
    markers: markers ?? [],
    effectChains: effectChains ?? [],
    project: project ?? false,
  };
};
