/**
 * The public contract of the AudioGubbins workspace.
 *
 * REQ-UX-057 makes docking core infrastructure rather than something each panel
 * implements. These contracts are that infrastructure, and Dockview sits behind
 * them: an import of the docking engine from outside `src/adapter/` is a build
 * failure, so replacing it is a change to one file rather than to every panel.
 */

export {
  DockRegion,
  type OpenPanel,
  type PanelDescriptor,
  type PanelGroup,
  type PanelId,
  type PanelKind,
  type WorkspaceArrangement,
  type WorkspaceLayout,
  openingProblem,
  panelsIn,
  activePanelOf,
  titleOf,
  closureProblem,
  movingProblem,
  regionPhrase,
  withPanel,
  withPanelMoved,
  withoutPanel,
} from './panel.js';
export { nudgingProblem, withGroupNudged } from './panel-nudging.js';
export { reorderingProblem, withPanelReordered } from './panel-ordering.js';
export { resizingProblem, withGroupResized } from './panel-sizing.js';
export { sameArrangement, sameLayout } from './same-arrangement.js';

export {
  BUILT_IN_IS_NOT_DELETABLE,
  type LayoutRemoval,
  type LayoutStore,
  type SavingProblem,
  createLayoutStore,
  noWorkspaceWith,
} from './layout-store.js';

export {
  type LayoutProblem,
  type LayoutReading,
  LayoutSource,
  type ResolvedLayout,
  readLayout,
  resolveStoredLayout,
} from './layout-reading.js';

export { LONGEST_WORKSPACE_NAME, listedName } from './workspace-name.js';

export { type PlacedLayouts, placedLayouts } from './held-layouts.js';

export { DEFAULT_PRESET_ID, PanelKinds, buildPresets } from './presets.js';

export { DockHost, type DockHostProps, type PanelRenderer } from './adapter/dockview-adapter.js';
export { type DockMemory, createDockMemory } from './adapter/dock-memory.js';
