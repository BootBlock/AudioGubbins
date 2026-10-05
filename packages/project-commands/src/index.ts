/**
 * The public contract of the AudioGubbins project commands.
 *
 * The typed commands that change a project (ADR-0020): naming it, adding,
 * removing and naming its assets, changing where an asset's bytes come from,
 * and editing them: an asset's chain of edits, its markers, and its regions
 * with their own processing (ADR-0051). Each is undoable through an inverse
 * invocation and deterministic under replay, so the history can keep a journal
 * of invocations rather than of states (REQ-EDIT-073, REQ-STOR-101), and each
 * declares which of its arguments hold provenance, which
 * {@link commandProvenance} makes the port a whole history is stripped through
 * (REQ-STOR-166). The commands run through `createCommandBus` from
 * `@audiogubbins/commands`, over a registry holding {@link projectCommands}.
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

export { applyInvocation } from './editing/edit-commands.js';
export {
  addMarkerInvocation,
  removeMarkerInvocation,
  setMarkerInvocation,
} from './editing/marker-commands.js';
export {
  addRegionInvocation,
  applyRegionEditInvocation,
  removeRegionInvocation,
  setRegionInvocation,
} from './editing/region-commands.js';
