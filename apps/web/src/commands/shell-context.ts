/**
 * What a shell command can read and change.
 *
 * REQ-EDIT-073 requires every meaningful action to take one typed route,
 * whichever surface started it. The command layer supplies the machinery and
 * leaves the context to the subsystem, so this is the shell's context: the
 * stores it owns, and nothing else.
 *
 * The stores are passed rather than imported as singletons. A command reaching
 * for a module-level store would be the hidden global state REQ-EXEC-136.6
 * prohibits, and it would make every command untestable without the whole
 * application being constructed first.
 *
 * Note what is absent: no project. A shell command cannot mutate project state
 * because it has no route to it, which is the dependency direction
 * REQ-EXEC-136.4 asks for rather than a rule to remember. The audio engine is
 * here as the test signal's transport and renderer, which play and render a
 * signal of their own and no project's audio.
 */

import type { CapabilityRegistry } from '@audiogubbins/capabilities';
import type { KeyboardConvention } from '@audiogubbins/commands';
import type {
  Clock,
  DiagnosticCentre,
  EnvironmentSummary,
  LogStore,
} from '@audiogubbins/diagnostics';

import type { PlaybackControl } from '../audio/playback-control.js';
import type { RenderControl } from '../audio/render-control.js';
import type { TextFiles } from '../io/text-files.js';
import type { AudioSettingsStore } from '../state/audio-settings-store.js';
import type { AudioViewStore } from '../state/audio-view-store.js';
import type { InteractionStore } from '../state/interaction-store.js';
import type { KeyboardLayoutStore } from '../state/keyboard-layout-store.js';
import type { LogViewStore } from '../state/log-view-store.js';
import type { PreferencesStore } from '../state/preferences-store.js';
import type { RenderStrategyStore } from '../state/render-strategy-store.js';
import type { ShortcutStore } from '../state/shortcut-store.js';
import type { VerbosityStore } from '../state/verbosity-store.js';
import type { WorkspaceStore } from '../state/workspace-store.js';

/** What a shell command acts on. */
export interface ShellContext {
  readonly preferences: PreferencesStore;
  readonly workspace: WorkspaceStore;
  readonly interaction: InteractionStore;

  /** What a reader chose to see in each open log panel, which outlives the dock. */
  readonly logViews: LogViewStore;
  readonly capabilities: CapabilityRegistry;
  readonly diagnostics: DiagnosticCentre;
  readonly logs: LogStore;

  /** How much the log records, as the user chose it (REQ-PRIV-165). */
  readonly verbosity: VerbosityStore;

  /**
   * The browser and operating system, read once at start-up.
   *
   * Read by the composition root rather than by a command, because a command
   * has no browser to read and must stay testable without one.
   */
  readonly environment: EnvironmentSummary;

  /** The time, supplied rather than read, so a report's timestamp is testable. */
  readonly clock: Clock;

  /** The shortcut profiles, and which one is in force (REQ-UX-066). */
  readonly shortcuts: ShortcutStore;

  /** How shortcuts are written on this platform, for anything a command says. */
  readonly convention: KeyboardConvention;

  /**
   * What the user's keyboard layout types on each key, as far as it is known,
   * which decides how a shortcut is written and what the browser takes.
   */
  readonly keyboardLayout: KeyboardLayoutStore;

  /** Where text the user asked to keep is offered as a file. */
  readonly files: TextFiles;

  /** What the audio engine is doing. */
  readonly audio: AudioViewStore;

  /**
   * How the person has set the audio engine up: the performance profile, the
   * Custom profile's settings, the background priority and the render mode.
   */
  readonly audioSettings: AudioSettingsStore;

  /** How the latest render was planned, and what the last one measured. */
  readonly renderStrategy: RenderStrategyStore;

  /** Plays, pauses and stops the test signal. */
  readonly playback: PlaybackControl;

  /** Renders the test signal offline. */
  readonly rendering: RenderControl;
}
