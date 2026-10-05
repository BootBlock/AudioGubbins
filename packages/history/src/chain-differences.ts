/**
 * How two versions of each effect chain differ (REQ-STOR-195): which slots
 * were added, removed, moved or changed, and for a processor which of its
 * parameters changed.
 *
 * A chain is a tree of slots (ADR-0060): a slot sits at an index of the
 * chain's own list or of a branch of a group. A slot moved where it changed
 * list, or where it left its order among the slots kept in its list; one
 * shifted only because another was added or removed beside it did not move
 * (`order-changes.ts`). Everything is in a fixed order, so the same two
 * states always give the same difference.
 */

import type {
  ChainSlot,
  EffectChain,
  EffectChainId,
  ParameterId,
  ParameterValue,
  ProcessorGroupId,
  ProcessorId,
  ProcessorStateVersion,
} from '@audiogubbins/domain';
import { compareCodeUnits } from '@audiogubbins/project-format';

import { unmovedPositions } from './order-changes.js';

/** A parameter whose value differs; a side is absent where it had no value. */
export interface ParameterChange {
  readonly id: ParameterId;
  readonly before?: ParameterValue;
  readonly after?: ParameterValue;
}

/** Where a slot sits: at `index` of the chain's list, or of branch `branch` of the group `group`. */
export interface SlotPosition {
  readonly group?: { readonly id: ProcessorGroupId; readonly branch: number };
  readonly index: number;
}

/** A setting of a slot other than a parameter's value. */
export type SlotField =
  'typeKey' | 'enabled' | 'soloed' | 'mix' | 'version' | 'state' | 'summing' | 'branches';

/** How one slot differs between the two versions of its chain. */
export interface SlotDifference {
  readonly id: ProcessorId | ProcessorGroupId;
  readonly kind: ChainSlot['kind'];
  readonly change: 'added' | 'removed' | 'changed';

  /** A processor's type, after where it is present after, before otherwise. */
  readonly typeKey?: string;

  /** Where it sat before and sits after, where it did. */
  readonly before?: SlotPosition;
  readonly after?: SlotPosition;

  /** Whether a person moved it: to another list, or out of its order in its own. */
  readonly moved: boolean;
  readonly fields: readonly SlotField[];
  readonly parameters: readonly ParameterChange[];
}

/** How one effect chain differs. */
export interface ChainDifference {
  readonly id: EffectChainId;
  readonly change: 'added' | 'removed' | 'changed';

  /** Depth first in the chain's order after, then those removed in the order before. */
  readonly slots: readonly SlotDifference[];
}

/** A slot as it sits in a chain, and the key of the list it sits in. */
interface PlacedSlot {
  readonly slot: ChainSlot;
  readonly position: SlotPosition;
  readonly list: string;
}

/** Every slot of `slots`, depth first in signal order. */
function placed(
  slots: readonly ChainSlot[],
  group: SlotPosition['group'],
  into: PlacedSlot[] = [],
): PlacedSlot[] {
  const list = group === undefined ? '' : `${group.id}/${String(group.branch)}`;
  for (const [index, slot] of slots.entries()) {
    into.push({ slot, list, position: group === undefined ? { index } : { group, index } });
    if (slot.kind === 'group') {
      for (const [branch, inner] of slot.branches.entries()) {
        placed(inner.slots, { id: slot.id, branch }, into);
      }
    }
  }
  return into;
}

function sameVersion(left: ProcessorStateVersion, right: ProcessorStateVersion): boolean {
  return (
    left.implementation === right.implementation &&
    left.parameters === right.parameters &&
    left.resampler === right.resampler &&
    left.model?.pack === right.model?.pack &&
    left.model?.version === right.model?.version &&
    left.model?.modelHash === right.model?.modelHash &&
    left.model?.runtimeHash === right.model?.runtimeHash
  );
}

function sameNumbers(left: readonly number[], right: readonly number[]): boolean {
  return (
    left.length === right.length && left.every((value, index) => Object.is(value, right[index]))
  );
}

function slotFields(before: ChainSlot, after: ChainSlot): readonly SlotField[] {
  const fields: SlotField[] = [];
  if (before.enabled !== after.enabled) fields.push('enabled');
  if (before.soloed !== after.soloed) fields.push('soloed');
  if (!Object.is(before.mix, after.mix)) fields.push('mix');
  if (before.kind === 'processor' && after.kind === 'processor') {
    if (before.typeKey !== after.typeKey) fields.unshift('typeKey');
    if (!sameVersion(before.version, after.version)) fields.push('version');
    const was = before.state;
    const is = after.state;
    if (was?.kind !== is?.kind || !sameNumbers(was?.values ?? [], is?.values ?? [])) {
      fields.push('state');
    }
  } else if (before.kind === 'group' && after.kind === 'group') {
    if (before.summing !== after.summing) fields.push('summing');
    if (before.branches.length !== after.branches.length) fields.push('branches');
  }
  return fields;
}

function parameterChanges(
  before: ReadonlyMap<ParameterId, ParameterValue>,
  after: ReadonlyMap<ParameterId, ParameterValue>,
): readonly ParameterChange[] {
  if (before === after) return [];
  const ids = new Set([...before.keys(), ...after.keys()]);
  const changes: ParameterChange[] = [];
  for (const id of [...ids].sort(compareCodeUnits)) {
    const was = before.get(id);
    const is = after.get(id);
    if (Object.is(was, is)) continue;
    changes.push({
      id,
      ...(was === undefined ? {} : { before: was }),
      ...(is === undefined ? {} : { after: is }),
    });
  }
  return changes;
}

const NO_VALUES = new Map<ParameterId, ParameterValue>();

function valuesOf(slot: ChainSlot): ReadonlyMap<ParameterId, ParameterValue> {
  return slot.kind === 'processor' ? slot.values : NO_VALUES;
}

/** A slot only one version of the chain holds, with every parameter value it had or has. */
function alone(placement: PlacedSlot, change: 'added' | 'removed'): SlotDifference {
  const { slot, position } = placement;
  return {
    id: slot.id,
    kind: slot.kind,
    change,
    ...(slot.kind === 'processor' ? { typeKey: slot.typeKey } : {}),
    ...(change === 'added' ? { after: position } : { before: position }),
    moved: false,
    fields: [],
    parameters:
      change === 'added'
        ? parameterChanges(NO_VALUES, valuesOf(slot))
        : parameterChanges(valuesOf(slot), NO_VALUES),
  };
}

/** The slots that a person did not move: kept in the same list and in order among those kept there. */
function unmovedSlots(
  before: ReadonlyMap<string, PlacedSlot>,
  after: readonly PlacedSlot[],
): ReadonlySet<string> {
  const lists = new Map<string, PlacedSlot[]>();
  for (const placement of after) {
    const was = before.get(placement.slot.id);
    if (was?.list !== placement.list) continue;
    lists.set(placement.list, [...(lists.get(placement.list) ?? []), placement]);
  }
  const unmoved = new Set<string>();
  for (const kept of lists.values()) {
    const order = kept.map((placement) => before.get(placement.slot.id)?.position.index ?? 0);
    for (const position of unmovedPositions(order)) {
      const placement = kept[position];
      if (placement !== undefined) unmoved.add(placement.slot.id);
    }
  }
  return unmoved;
}

function slotDifferences(
  before: readonly ChainSlot[],
  after: readonly ChainSlot[],
): readonly SlotDifference[] {
  const was = placed(before, undefined);
  const is = placed(after, undefined);
  const byId = new Map(was.map((placement) => [placement.slot.id, placement]));
  const unmoved = unmovedSlots(byId, is);
  const differences: SlotDifference[] = [];
  for (const placement of is) {
    const previous = byId.get(placement.slot.id);
    if (previous?.slot.kind !== placement.slot.kind) {
      if (previous !== undefined) differences.push(alone(previous, 'removed'));
      differences.push(alone(placement, 'added'));
      continue;
    }
    const moved = !unmoved.has(placement.slot.id);
    const fields = slotFields(previous.slot, placement.slot);
    const parameters = parameterChanges(valuesOf(previous.slot), valuesOf(placement.slot));
    if (!moved && fields.length === 0 && parameters.length === 0) continue;
    const { slot } = placement;
    differences.push({
      id: slot.id,
      kind: slot.kind,
      change: 'changed',
      ...(slot.kind === 'processor' ? { typeKey: slot.typeKey } : {}),
      before: previous.position,
      after: placement.position,
      moved,
      fields,
      parameters,
    });
  }
  const present = new Set(is.map((placement) => placement.slot.id));
  for (const placement of was) {
    if (!present.has(placement.slot.id)) differences.push(alone(placement, 'removed'));
  }
  return differences;
}

/**
 * How the chains of two states differ, sorted by identifier. A map or a chain
 * the two share is skipped by identity, and a chain whose slots compare equal
 * is left out.
 */
export function chainDifferences(
  before: ReadonlyMap<EffectChainId, EffectChain>,
  after: ReadonlyMap<EffectChainId, EffectChain>,
): readonly ChainDifference[] {
  if (before === after) return [];
  const differences: ChainDifference[] = [];
  const ids = new Set([...before.keys(), ...after.keys()]);
  for (const id of [...ids].sort(compareCodeUnits)) {
    const was = before.get(id);
    const is = after.get(id);
    if (was === is) continue;
    const slots = slotDifferences(was?.slots ?? [], is?.slots ?? []);
    if (was !== undefined && is !== undefined && slots.length === 0) continue;
    const change = was === undefined ? 'added' : is === undefined ? 'removed' : 'changed';
    differences.push({ id, change, slots });
  }
  return differences;
}
