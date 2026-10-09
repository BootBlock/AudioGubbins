/**
 * The command that sets one processor of the project (ADR-0060,
 * REQ-AUDIO-086): its parameter values, versions and state, and its bypass,
 * solo and mix, as a control of a rack sets them or a preset applied gives
 * them, in one step one undo reverses.
 *
 * A processor is named by its identifier, which names one slot in the whole
 * project (`chain-checks.ts`), so the command changes that processor and
 * nothing beside it: a change made while another slot of its chain changed
 * elsewhere keeps that change, as setting the whole chain would not. It
 * reaches every operation and target that names the chain, which is what a
 * shared chain is. A processor keeps its type, since a type is what its
 * parameters are of; another type is another processor, added to the chain.
 * Whether this build can run the settings is not checked here, for the reason
 * `chain-checks.ts` gives.
 */

import {
  CommandCategory,
  refusal,
  unchanged,
  type CommandInvocation,
  type CommandOutcome,
} from '@audiogubbins/commands';
import {
  findSlot,
  withSlotReplaced,
  type ProcessorCatalogue,
  type ProcessorInstance,
} from '@audiogubbins/domain';
import {
  canonicalJson,
  readSlotAlone,
  writeProcessor,
  type ProjectState,
} from '@audiogubbins/project-format';

import { jsonArgument, readNested, refusedBy } from '../invocation-arguments.js';
import {
  NO_PROVENANCE,
  ProjectCommandId,
  applied,
  projectCommand,
  type ProjectCommand,
} from '../project-command.js';
import { chainChangeDescription } from './chain-descriptions.js';

/** The invocation that sets the processor of `processor`'s identifier to `processor`. */
export function setProcessorInvocation(processor: ProcessorInstance): CommandInvocation {
  return {
    commandId: ProjectCommandId.SetProcessor,
    arguments: { processor: canonicalJson(writeProcessor(processor)) },
  };
}

function setProcessor(
  state: ProjectState,
  invocation: CommandInvocation,
  catalogue: ProcessorCatalogue,
): CommandOutcome<ProjectState> {
  const value = jsonArgument(invocation, 'processor');
  if (!value.ok) return refusedBy(value);
  const slot = readNested(readSlotAlone, value.value, 'processor');
  if (!slot.ok) return refusedBy(slot);
  const processor = slot.value;
  if (processor.kind !== 'processor') {
    return refusal('processor.not-processor', 'The command sets one processor, not a group.');
  }
  for (const chain of state.project.effectChains.values()) {
    const changed = withSlotReplaced(chain, processor);
    if (changed === undefined) continue;
    const before = findSlot(chain, processor.id)?.slot;
    if (before?.kind !== 'processor') {
      return refusal('processor.unknown', 'That identifier names a group, not a processor.');
    }
    if (before.typeKey !== processor.typeKey) {
      return refusal(
        'processor.type-changed',
        'A processor keeps its type: add a processor of the other type to the chain instead.',
      );
    }
    if (canonicalJson(writeProcessor(before)) === canonicalJson(writeProcessor(processor))) {
      return unchanged('processor.unchanged', 'The processor is already set as asked.');
    }
    const chains = new Map([...state.project.effectChains, [chain.id, changed]]);
    return applied(
      { ...state, project: { ...state.project, effectChains: chains } },
      setProcessorInvocation(before),
      chainChangeDescription(chain, changed, catalogue),
    );
  }
  return refusal('processor.unknown', 'The project has no processor with that identifier.');
}

/** The command that sets one processor, described by `catalogue`'s names. */
export function processorCommands(catalogue: ProcessorCatalogue): readonly ProjectCommand[] {
  return [
    projectCommand({
      id: ProjectCommandId.SetProcessor,
      label: 'Set a processor',
      category: CommandCategory.Edit,
      description:
        'Sets one processor’s values, versions and state, and its bypass, solo and mix, wherever its chain is named.',
      provenance: NO_PROVENANCE,
      run: (state, invocation) => setProcessor(state, invocation, catalogue),
    }),
  ];
}
