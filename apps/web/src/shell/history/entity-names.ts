/**
 * What the History panel calls the entities a change affected: each by its
 * kind and its name in the state the project is in, so a change is found by
 * the name a person knows and said by it (REQ-STOR-196).
 *
 * A change can have affected an entity the project no longer holds, which is
 * said to be gone rather than named, since the panel names only what the
 * state it reads holds. An effect chain has no name of its own, and is called
 * by the track or bus it belongs to.
 */

import {
  affectedEntities,
  type EntityKind,
  type EntityReference,
  type HistoryNode,
} from '@audiogubbins/history';
import type { ProjectState } from '@audiogubbins/project-format';

import { quoted } from '../../wording.js';

/** The name of an entity in a state, where the state holds it. */
export type EntityNames = (entity: EntityReference) => string | undefined;

/** What a person calls an entity of each kind, and one of them. */
const KINDS: Readonly<Record<EntityKind, { readonly one: string; readonly some: string }>> = {
  asset: { one: 'asset', some: 'an asset' },
  track: { one: 'track', some: 'a track' },
  bus: { one: 'bus', some: 'a bus' },
  clip: { one: 'clip', some: 'a clip' },
  region: { one: 'region', some: 'a region' },
  marker: { one: 'marker', some: 'a marker' },
  'effect-chain': { one: 'effects of', some: 'effects' },
};

/** The names of the entities `state` holds, an effect chain by its owner's. */
export function entityNamesOf({ project }: ProjectState): EntityNames {
  const names = new Map<string, string>();
  for (const held of [project.assets, project.tracks, project.buses, project.clips]) {
    for (const [id, entity] of held) names.set(id, entity.displayName);
  }
  for (const held of [project.regions, project.markers]) {
    for (const [id, entity] of held) names.set(id, entity.displayName);
  }
  for (const owner of [...project.tracks.values(), ...project.buses.values()]) {
    if (owner.effectChainId !== undefined) names.set(owner.effectChainId, owner.displayName);
  }
  return (entity) => names.get(entity.id);
}

/** An entity as the panel says it: its kind and name, or that it is gone. */
export function describeEntity(entity: EntityReference, names: EntityNames): string {
  const name = names(entity);
  const kind = KINDS[entity.kind];
  return name === undefined
    ? `${kind.some} no longer in the project`
    : `${kind.one} ${quoted(name)}`;
}

/** Every entity a change affected, as the panel says each, the project first. */
function affectedWords(node: HistoryNode, names: EntityNames): readonly string[] {
  const said = node.kind === 'change' && node.affects.project ? ['the project'] : [];
  for (const entity of affectedEntities(node)) said.push(describeEntity(entity, names));
  return said;
}

/** How many entities a row names before it counts the rest. */
const NAMED_IN_A_ROW = 3;

/** What a change affected, in a phrase short enough for a row, or nothing. */
export function affectedPhrase(node: HistoryNode, names: EntityNames): string | undefined {
  const said = affectedWords(node, names);
  if (said.length === 0) return undefined;
  const shown = said.slice(0, NAMED_IN_A_ROW);
  const more = said.length - shown.length;
  return `Changed ${shown.join(', ')}${more > 0 ? ` and ${String(more)} more` : ''}`;
}
