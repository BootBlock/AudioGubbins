/**
 * What differs between the two sides of an A/B comparison, said entity by
 * entity: each track, bus, clip, region, marker and asset only one side holds,
 * each one both hold and what of it differs, and each effect chain processor
 * by processor (REQ-STOR-195).
 *
 * Plain language and nothing of the data model: an entity is called by its
 * name and a field by what a person calls it, from tables whose types demand
 * every field, so a field added to an entity fails to compile here until it
 * has words. An entity one side holds alone is said to be in that side only,
 * since neither side need be the earlier.
 */

import type {
  Asset,
  AssetId,
  Bus,
  Clip,
  Marker,
  ParameterValue,
  Region,
  Track,
} from '@audiogubbins/domain';
import type {
  ChainDifference,
  ChainOwner,
  DifferenceNames,
  EntityDifferences,
  FieldOf,
  SlotDifference,
  SlotField,
  StateDifference,
} from '@audiogubbins/history';
import { PROCESSOR_CATALOGUE } from '@audiogubbins/processors';
import type { AssetSource } from '@audiogubbins/project-format';
import { quoted } from '@audiogubbins/text';

/** What a person calls each field of an entity. */
type FieldWords<TEntity> = Readonly<Record<FieldOf<TEntity>, string>>;

const ASSET_WORDS: FieldWords<Asset> = {
  id: 'identity',
  displayName: 'name',
  origin: 'origin',
  sampleRate: 'sample rate',
  channelLayout: 'channels',
  length: 'length',
  storageKey: 'where its audio is kept',
  edits: 'edits',
  rack: 'rack',
};

const SOURCE_WORDS: FieldWords<AssetSource> = {
  media: 'file',
  provenance: 'record of where it came from',
};

const TRACK_WORDS: FieldWords<Track> = {
  id: 'identity',
  displayName: 'name',
  channelLayout: 'channels',
  gain: 'gain',
  pan: 'pan',
  muted: 'mute',
  soloed: 'solo',
  output: 'output',
  effectChainId: 'effects',
  paletteKey: 'colour',
};

const BUS_WORDS: FieldWords<Bus> = {
  id: 'identity',
  displayName: 'name',
  channelLayout: 'channels',
  gain: 'gain',
  muted: 'mute',
  output: 'output',
  effectChainId: 'effects',
};

const CLIP_WORDS: FieldWords<Clip> = {
  id: 'identity',
  trackId: 'track',
  displayName: 'name',
  source: 'part of the asset it plays',
  timelineStart: 'start',
  timelineLength: 'length',
  gain: 'gain',
  fadeInLength: 'fade in',
  fadeOutLength: 'fade out',
  muted: 'mute',
};

/**
 * A region's boundaries are stated at a basis, the edits that existed when
 * they were set, so a person calls the three of them its boundaries; a
 * marker's basis is part of its position the same way.
 */
const REGION_WORDS: FieldWords<Region> = {
  id: 'identity',
  assetId: 'asset',
  displayName: 'name',
  basis: 'boundaries',
  start: 'boundaries',
  end: 'boundaries',
  loop: 'loop',
  tags: 'tags',
  operations: 'processing',
  rack: 'rack',
};

const MARKER_WORDS: FieldWords<Marker> = {
  id: 'identity',
  assetId: 'asset',
  displayName: 'name',
  basis: 'position',
  position: 'position',
  paletteKey: 'colour',
};

/** The project's own fields, as a person calls them. */
const PROJECT_WORDS: Readonly<Record<StateDifference['project'][number], string>> = {
  displayName: 'name',
  sampleRate: 'sample rate',
  channelLayout: 'channels',
  trackOrder: 'order of its tracks',
};

/** A list in words: "a", "a and b", "a, b and c". */
function listed(words: readonly string[]): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1) ?? ''}`;
}

/** What one kind of entity differs in, a line for each entity. */
function entityLines<TId extends string, TEntity>(
  differences: EntityDifferences<TId, TEntity>,
  kind: string,
  words: FieldWords<TEntity>,
  names: DifferenceNames,
): string[] {
  const called = (id: TId): string => {
    const name = names.entities.get(id);
    return name === undefined ? `A ${kind}` : `The ${kind} ${quoted(name)}`;
  };
  return [
    ...differences.removed.map((id) => `${called(id)} is in A only.`),
    ...differences.added.map((id) => `${called(id)} is in B only.`),
    ...differences.changed.map(
      // Several fields can share their words, and each is said once.
      ({ id, fields }) =>
        `${called(id)} differs in its ${listed([...new Set(fields.map((f) => words[f]))])}.`,
    ),
  ];
}

/** A parameter's value, as a person reads it. */
function valueWords(value: ParameterValue | undefined): string {
  if (value === undefined) return 'unset';
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  return String(value);
}

/** What a person calls each setting of a slot. */
const SLOT_FIELD_WORDS: Readonly<Record<SlotField, string>> = {
  typeKey: 'its kind',
  enabled: 'whether it is on',
  soloed: 'its solo',
  mix: 'its mix',
  version: 'the version of the processing that made it',
  state: 'what it learned',
  summing: 'how its branches are added',
  branches: 'its branches',
};

/** What a slot is called: its processor's label, or a parallel group. */
function slotName(slot: SlotDifference): string {
  if (slot.kind === 'group') return 'A parallel group';
  const label =
    slot.typeKey === undefined ? undefined : PROCESSOR_CATALOGUE.get(slot.typeKey)?.label;
  return quoted(label ?? slot.typeKey ?? 'processor');
}

/** What a parameter of a slot is called, by its processor's descriptor where this build has one. */
function parameterName(slot: SlotDifference, id: string): string {
  const descriptor = slot.typeKey === undefined ? undefined : PROCESSOR_CATALOGUE.get(slot.typeKey);
  const label = descriptor?.parameters.find((parameter) => parameter.id === id)?.label;
  return label === undefined ? 'a setting' : `its ${label.toLowerCase()}`;
}

/** What differs of one slot, in a clause. */
function slotClause(slot: SlotDifference): string {
  const called = slotName(slot);
  if (slot.change === 'added') return `${called} is in B only`;
  if (slot.change === 'removed') return `${called} is in A only`;
  const parts = [
    ...(slot.moved ? ['its place'] : []),
    ...slot.fields.map((field) => SLOT_FIELD_WORDS[field]),
    ...slot.parameters.map(
      ({ id, before, after }) =>
        `${parameterName(slot, id)} (${valueWords(before)} in A, ${valueWords(after)} in B)`,
    ),
  ];
  return `${called} differs in ${listed(parts)}`;
}

/** What an effect chain is called for what names it, and the verb it takes. */
function chainCalled(owner: ChainOwner | undefined): {
  readonly called: string;
  readonly is: string;
} {
  if (owner === undefined) return { called: 'An effect chain', is: 'is' };
  const of = `the ${owner.kind} ${quoted(owner.name)}`;
  if (owner.naming === 'range') return { called: `The chain over a range of ${of}`, is: 'is' };
  return owner.kind === 'track' || owner.kind === 'bus'
    ? { called: `The effects of ${of}`, is: 'are' }
    : { called: `The rack of ${of}`, is: 'is' };
}

/** What differs of one effect chain, in a line. */
function chainLine(chain: ChainDifference, names: DifferenceNames): string {
  const { called, is } = chainCalled(names.chains.get(chain.id));
  if (chain.change === 'added') return `${called} ${is} in B only.`;
  if (chain.change === 'removed') return `${called} ${is} in A only.`;
  return `${called}: ${chain.slots.map(slotClause).join('; ')}.`;
}

/** What differs from side A to side B, a line for each entity, or one saying nothing does. */
export function differenceLines(
  difference: StateDifference,
  names: DifferenceNames,
): readonly string[] {
  const lines = [
    ...(difference.project.length === 0
      ? []
      : [`The project differs in its ${listed(difference.project.map((f) => PROJECT_WORDS[f]))}.`]),
    ...entityLines(difference.tracks, 'track', TRACK_WORDS, names),
    ...entityLines(difference.buses, 'bus', BUS_WORDS, names),
    ...entityLines(difference.clips, 'clip', CLIP_WORDS, names),
    ...entityLines(difference.regions, 'region', REGION_WORDS, names),
    ...entityLines(difference.markers, 'marker', MARKER_WORDS, names),
    ...entityLines(difference.assets, 'asset', ASSET_WORDS, names),
    ...entityLines<AssetId, AssetSource>(
      difference.sources,
      'source of the asset',
      SOURCE_WORDS,
      names,
    ),
    ...difference.effectChains.map((chain) => chainLine(chain, names)),
  ];
  return lines.length === 0 ? ['The two states are the same.'] : lines;
}
