/**
 * The public contract of the AudioGubbins command layer.
 *
 * REQ-EDIT-073 makes this the one route by which a meaningful action happens,
 * whatever started it. This package holds the machinery; the commands live with
 * the subsystem they act on, because a registry that also knew every command
 * would be exactly the catch-all REQ-EXEC-136.2 prohibits.
 *
 * Like the domain, this package is compiled without the DOM type definitions. A
 * keyboard event becomes a `KeyPress` at the edge, so chord matching, conflict
 * detection and palette ranking are all testable without a browser.
 */

export {
  AVAILABLE,
  type AppliedOutcome,
  type Command,
  type CommandAvailability,
  CommandCategory,
  type CommandId,
  type CommandInvocation,
  type CommandOutcome,
  type RefusedOutcome,
  type UnchangedOutcome,
  commandId,
  isCommandId,
  refusal,
  unchanged,
  unavailable,
} from './command.js';

export {
  type AppliedExecution,
  type CommandBus,
  type CommandRegistry,
  type ExecutionResult,
  type HistoryEntry,
  UNAVAILABLE_FAILURE_CODE,
  createCommandBus,
  createCommandRegistry,
} from './registry.js';

export {
  KeyboardConvention,
  PrimaryModifier,
  type Shortcut,
  type ShortcutBinding,
  type ShortcutConflict,
  type ShortcutProfile,
  commandForShortcut,
  describePresses,
  bindingsFor,
  describeShortcut,
  findShortcutConflicts,
  keyboardPlatformFor,
  primaryModifierFor,
  primaryPress,
  shortcut,
  shortcutKey,
} from './shortcut.js';

export {
  type PlatformReservation,
  describeReservation,
  commandLayerKeyAsked,
  commandPressMayBeTaken,
  isReservedByPlatform,
  shortcutOffered,
  platformReservation,
} from './platform-reservations.js';

export { duplicateProfile, rebind, unbind } from './profile-editing.js';

export { NAMES_CANNOT_BE_COMPARED } from './profile-name.js';

export {
  type ChordAbandoned,
  type ChordOutcome,
  type ChordPassThrough,
  type ChordRunCommand,
  type ChordTracker,
  type ChordWaiting,
  createChordTracker,
} from './chord-tracker.js';

export {
  type RestoredEntry,
  type StoredProfileEntry,
  exportFileName,
  exportProfile,
  importProfile,
  parseShortcut,
  restoreProfiles,
} from './shortcut-transfer.js';

export { type ImportedProfile } from './held-profiles.js';

export {
  type PaletteOptions,
  type PaletteResult,
  resultCommandIds,
  searchCommands,
} from './palette.js';
