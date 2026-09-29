/**
 * The public contract of the AudioGubbins project commands.
 *
 * The typed commands that change a project (ADR-0020): naming it, adding,
 * removing and naming its assets, and changing where an asset's bytes come
 * from. Each is undoable through an inverse invocation and deterministic under
 * replay, so the history can keep a journal of invocations rather than of
 * states (REQ-EDIT-073, REQ-STOR-101). The commands run through
 * `createCommandBus` from `@audiogubbins/commands`, over a registry holding
 * {@link projectCommands}.
 *
 * Everything absent from this list is internal and may change without being a
 * contract change (REQ-REPO-186).
 */

export { projectCommands } from './project-commands.js';

export { ProjectCommandId } from './project-command.js';

export {
  addAssetInvocation,
  adoptSourceVersionInvocation,
  relinkSourceInvocation,
  setAssetMediaInvocation,
} from './project-invocations.js';
