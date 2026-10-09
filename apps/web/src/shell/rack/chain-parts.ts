/**
 * What every slot of a chain in the Effects rack is drawn with, and how its
 * controls name a place in the chain to the commands they run.
 */

import type { EffectChainId, ProcessorId, SlotPlace } from '@audiogubbins/domain';

import type { ModelGate } from '../../assets/model-gate.js';
import type { PanelCommands } from '../command-button.js';

/** What every slot of a chain is drawn with: the view, the chain, the selection and the gate. */
export interface ChainParts {
  readonly panel: string;
  readonly chain: EffectChainId;
  readonly selected: readonly ProcessorId[];
  readonly gate: ModelGate;
  readonly commands: PanelCommands;
}

/** The type the drag of a slot carries, its identifier. */
export const SLOT_DRAG = 'application/x-audiogubbins-slot';

/** The command arguments that name a place in the chain: a list, and an index in it. */
export function placeArgs(
  parts: ChainParts,
  group: SlotPlace['group'],
  index?: number,
): Readonly<Record<string, string | number>> {
  return {
    view: parts.panel,
    chainId: parts.chain,
    ...(group === undefined ? {} : { group: group.id, branch: group.branch }),
    ...(index === undefined ? {} : { index }),
  };
}
