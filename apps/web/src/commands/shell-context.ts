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
 * Note what is absent: no project state to write. A shell command reaches an
 * open project only through its session, whose every change is a project
 * command run through the project's own bus and kept in its history
 * (REQ-STOR-021), so a shell command cannot change a project by any other
 * route: the dependency direction REQ-EXEC-136.4 asks for rather than a rule to
 * remember. The audio engine is here as the transport and the test signal's
 * renderer. The editor opens the project's assets and regions, whose markers,
 * regions and edits are the project's and change only through its commands
 * (ADR-0047, ADR-0051); their selections and playheads, and the views of them,
 * are the session's, and the reference picture is reference media, never
 * project state.
 */

import type { CapabilityRegistry, StorageCapabilityAbsence } from '@audiogubbins/capabilities';
import type { KeyboardConvention } from '@audiogubbins/commands';
import type {
  Clock,
  DiagnosticCentre,
  EnvironmentSummary,
  LogStore,
} from '@audiogubbins/diagnostics';

import type { IdGenerator } from '@audiogubbins/domain';

import type { DetectionControl } from '../analysis/detection-control.js';
import type { ModelGate } from '../assets/model-gate.js';
import type { PlaybackControl } from '../audio/playback-control.js';
import type { PictureSoundDecoder } from '../picture/picture-sound.js';
import type { ReferencePicture } from '../picture/reference-picture.js';
import type { AssetCatalogue } from '../state/asset-catalogue.js';
import type { ChosenFiles } from '../state/chosen-files.js';
import type { ClipboardStore } from '../state/clipboard-store.js';
import type { Observable } from '../state/observable.js';
import type { CueStore } from '../state/cue-store.js';
import type { EditorViewStore } from '../state/editor-view-store.js';
import type { SelectionStore } from '../state/selection-store.js';
import type { RenderControl } from '../audio/render-control.js';
import type { TextFiles } from '../io/text-files.js';
import type { ProjectStores } from '../state/project-stores.js';
import type { StorageRootStore } from '../state/storage-root-store.js';
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

  /**
   * Whether projects can be kept and read at all: whether this browser can keep
   * them, and whether the stored data is of this build's schema (REQ-STOR-052).
   */
  readonly storageRoot: StorageRootStore;

  /** The project system's stores, absent where this browser cannot keep projects. */
  readonly projects: ProjectStores | undefined;

  /** What this browser lacks for keeping projects, and what that costs (REQ-EXEC-216). */
  readonly storageAbsences: readonly StorageCapabilityAbsence[];

  /** What the audio engine is doing. */
  readonly audio: AudioViewStore;

  /**
   * How the person has set the audio engine up: the performance profile, the
   * Custom profile's settings, the background priority and the render mode.
   */
  readonly audioSettings: AudioSettingsStore;

  /** How the latest render was planned, and what the last one measured. */
  readonly renderStrategy: RenderStrategyStore;

  /** Plays, pauses, stops and moves the transport, over an asset or the test signal. */
  readonly playback: PlaybackControl;

  /** Renders the test signal offline. */
  readonly rendering: RenderControl;

  /** The assets an editor view can open this session. */
  readonly assets: AssetCatalogue;

  /** What is selected in each asset. */
  readonly selections: SelectionStore;

  /** Where each asset's playhead is parked. */
  readonly cues: CueStore;

  /** Each editor panel's asset and presentation. */
  readonly editorViews: EditorViewStore;

  /** New identities, for the markers a person adds. */
  readonly ids: IdGenerator;

  /** The reference picture, and the decoding of its sound. */
  readonly picture: ReferencePicture;
  readonly pictureSound: PictureSoundDecoder;

  /** Files the person chose, held for the command that opens each. */
  readonly chosenFiles: ChosenFiles;

  /** What the last copy or cut took, for the session. */
  readonly clipboard: ClipboardStore;

  /**
   * Why a processor cannot run for want of its model, as the page knows now
   * (ADR-0062), which every entry of the project is made with.
   */
  readonly modelGate: Observable<ModelGate>;

  /**
   * What the assistants were asked to analyse this session and what they
   * found, which only a recommendation applied through the project's
   * commands acts on.
   */
  readonly detection: DetectionControl;
}
