/**
 * The public contract of the AudioGubbins project commands.
 *
 * The typed commands that change a project (ADR-0020): naming it, adding,
 * removing and naming its assets, changing where an asset's bytes come from,
 * and editing them: an asset's chain of edits, its markers, and its regions
 * with their own processing (ADR-0051); and its racks, the chains of processors
 * that assets, regions and ranges name, slot by slot, each chain entering and
 * leaving the project with what names it (ADR-0060, ADR-0061), with the
 * builders of the changes the interface makes of them. Each is undoable through
 * an inverse invocation and deterministic under replay, so the history can keep
 * a journal of invocations rather than of states (REQ-EDIT-073, REQ-STOR-101),
 * and each declares which of its arguments hold provenance, which
 * `commandProvenance` makes the port a whole history is stripped through
 * (REQ-STOR-166). The commands run through `createCommandBus` from
 * `@audiogubbins/commands`, over a registry holding `projectCommands`.
 *
 * Everything absent from this list is internal and may change without being a
 * contract change (REQ-REPO-186).
 */

export { commandProvenance, projectCommands } from './project-commands.js';

export { ProjectCommandId, type ProjectCommand } from './project-command.js';

export {
  addAssetInvocation,
  adoptSourceVersionInvocation,
  relinkSourceInvocation,
  setAssetMediaInvocation,
} from './project-invocations.js';

export { applyInvocation, withdrawInvocation } from './editing/edit-commands.js';
export {
  addMarkerInvocation,
  removeMarkerInvocation,
  setMarkerInvocation,
} from './editing/marker-commands.js';
export {
  addRegionInvocation,
  addRegionWithProcessing,
  changeRegionInvocations,
  removeRegionInvocation,
  setRegionInvocation,
  withdrawRegionEditInvocation,
} from './editing/region-invocations.js';
export { processTargetInvocation, rackRangeInvocation } from './editing/target-invocations.js';
export { setProcessorInvocation } from './processing/processor-commands.js';
export {
  type RackTarget,
  extendedRackInvocation,
  independentChainInvocations,
  rackEachInvocations,
  setRackInvocation,
  targetChains,
} from './processing/rack-commands.js';
export { type SlotControl } from './processing/slot-arguments.js';
export {
  addSlotInvocation,
  moveSlotInvocation,
  removeSlotsInvocations,
  setSlotControlInvocation,
} from './processing/slot-commands.js';
