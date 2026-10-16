/**
 * The one view of the shell each panel is handed (`panels.tsx` draws them):
 * what every panel reads, its stores read alone, and the commands its controls
 * run, made from the shell's context.
 */

import type { CapabilityRegistry, StorageCapabilityAbsence } from '@audiogubbins/capabilities';
import type { LogStore } from '@audiogubbins/diagnostics';
import type { IdGenerator } from '@audiogubbins/domain';
import type { NodeId } from '@audiogubbins/audio-graph';
import type { CodecEnvironment } from '@audiogubbins/codecs';
import type { MeterLevels } from '@audiogubbins/audio-runtime';

import type { Detections } from '../analysis/detection-control.js';
import type { Auditioning } from '../audio/loop-audition.js';
import type { GamePreviewParts } from '../audio/preview-runner.js';
import type { ModelGate } from '../assets/model-gate.js';
import type { ShellContext } from '../commands/shell-context.js';
import type { EditorPanelParts } from '../editor/panel-parts.js';
import type { ExportSubject } from '../export/export-focus.js';
import type { ExportRunState } from '../export/export-types.js';
import type { PackManagerView } from '../ml/pack-manager.js';
import type { RecordingParts } from '../recording/recording-part.js';
import type { AudioSettings } from '../state/audio-settings-store.js';
import type { AudioView } from '../state/audio-view-store.js';
import type { GroupChoice } from '../state/group-focus.js';
import type { Hearing } from '../state/hearing-store.js';
import type { LogViewStore } from '../state/log-view-store.js';
import type { LoopAnalyses } from '../state/loop-analysis-store.js';
import type { LoudnessReadings } from '../state/loudness-store.js';
import type { Observable } from '../state/observable.js';
import type { UserPreferences } from '../state/preferences-store.js';
import type { RenderStrategyView } from '../state/render-strategy-store.js';
import type { ProjectPanelContext } from './project-panels.js';
import type { RunCommand } from './settings/section.js';

/** What a panel needs to draw itself. */
export interface PanelContext extends ProjectPanelContext {
  readonly capabilities: CapabilityRegistry;
  readonly logs: LogStore;
  readonly logViews: LogViewStore;
  readonly diagnosticModeActive: boolean;
  readonly announcement?: { readonly text: string; readonly urgent: boolean };

  /** What this browser lacks for keeping projects. */
  readonly storageAbsences: readonly StorageCapabilityAbsence[];

  /**
   * What the audio engine is doing, which the Transport panel shows. Read
   * alone, as the next two are: a panel changes them only through the commands
   * it runs, never by writing a store (`CLAUDE.md` G2).
   */
  readonly audio: Observable<AudioView>;

  /** The person's audio settings, and how the latest render was planned, which it shows too. */
  readonly audioSettings: Observable<AudioSettings>;
  readonly renderStrategy: Observable<RenderStrategyView>;

  /** The frame the listener hears now, at the context's rate. */
  readonly playhead: () => number | undefined;

  /** Each meter's latest levels, which the Transport panel reads once a display frame. */
  readonly meters: () => ReadonlyMap<NodeId, MeterLevels>;

  /** The frames the running render has reached, which the Transport panel reads likewise. */
  readonly framesRendered: () => number;

  /** What the Editor and Picture panels are given. */
  readonly editor: EditorPanelParts;

  /** What the assistants found this session, which the Analysis panel shows. */
  readonly detection: Observable<Detections>;

  /** The loop analyses of the session, and the loop audition playing, which the Loop panel shows. */
  readonly loopAnalyses: Observable<LoopAnalyses>;
  readonly loopAudition: Observable<Auditioning | undefined>;

  /** The model packs kept here and offered, which the Model packs panel shows. */
  readonly packs: PackManagerView;

  /** Why a processor cannot run for want of its model, which the Effects rack shows. */
  readonly modelGate: Observable<ModelGate>;

  /** Whether an asset is heard processed or as its original, which the rack and transport show. */
  readonly hearing: Observable<Hearing>;

  /** The input, monitoring and latency calibration, which the Recording panel shows. */
  readonly recording: RecordingParts;

  /** The page's export, absent where this browser keeps no projects, which the Inspector describes. */
  readonly exports: Observable<ExportRunState> | undefined;

  /** The export the Inspector describes, while one is its subject. */
  readonly exportSubject: Observable<ExportSubject | undefined>;

  /** The person's preferences, whose pressure choice the Spectral panel shows. */
  readonly preferences: Observable<UserPreferences>;

  /** The Game preview's scenario set up and its run, which the Game preview panel shows. */
  readonly gamePreview: GamePreviewParts;

  /** New identities, for the emitters the Game preview panel adds. */
  readonly ids: IdGenerator;

  /** The asset group chosen, which the Asset groups panel and the Inspector show. */
  readonly groups: Observable<GroupChoice | undefined>;

  /** The loudness of the members measured this session, which the Asset groups panel shows. */
  readonly loudness: Observable<LoudnessReadings>;

  /** The codecs as this browser serves them, which a group's export is planned against. */
  readonly codecs: Observable<CodecEnvironment>;
}

/**
 * What a panel reads, from the shell's context, and how its controls run a
 * command and ask why one cannot run: as every other surface does, so a panel's
 * button and the palette entry of the same name are one action.
 */
export function panelContextOf(
  {
    context,
    editorPanels,
  }: { readonly context: ShellContext; readonly editorPanels: EditorPanelParts },
  run: RunCommand,
  unavailableReason: (id: string) => string | undefined,
): PanelContext {
  return {
    editor: editorPanels,
    capabilities: context.capabilities,
    logs: context.logs,
    logViews: context.logViews,
    diagnosticModeActive: context.diagnostics.isDiagnosticModeActive(),
    storageAbsences: context.storageAbsences,
    projects: context.projects,
    projectsUnavailable: unavailableReason('file.projects'),
    audio: context.audio,
    audioSettings: context.audioSettings,
    renderStrategy: context.renderStrategy,
    playhead: () => context.playback.audiblePosition(),
    meters: () => context.playback.meters(),
    framesRendered: () => context.rendering.framesRendered(),
    detection: context.detection,
    loopAnalyses: context.loopAnalysis.analyses,
    loopAudition: context.loopAudition,
    packs: context.packs,
    modelGate: context.modelGate,
    hearing: context.hearing,
    recording: context.recording,
    exports: context.exports,
    exportSubject: context.exportFocus.subject,
    preferences: context.preferences,
    gamePreview: context.gamePreview,
    ids: context.ids,
    groups: context.groups.chosen,
    loudness: context.loudness.readings,
    codecs: context.codecs.environment,
    run,
    unavailableReason,
    labelFor: editorPanels.labelFor,
  };
}
