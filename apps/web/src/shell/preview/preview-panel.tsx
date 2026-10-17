/**
 * The Game preview panel (ADR-0104, the plan's section 11): the scenario picker
 * and editor, the listener-and-emitter pad, Run, Stop and the triggers, the
 * rules each emitter plays by and where they come from, the bus levels, the
 * seed, the event log, the voices sounding against each limit and the voice
 * budget, and how late a hand trigger is heard.
 *
 * It reads the stores and runs commands; the scenario set up is the session's
 * and changes in its store until it is kept (`game-preview-store.ts`), and no
 * control here writes the project.
 */

import { useMemo, useSyncExternalStore, type ReactNode } from 'react';

import {
  ButtonTone,
  EmptyState,
  Hint,
  PanelHeader,
  type IconName,
} from '@audiogubbins/design-system';
import type { IdGenerator } from '@audiogubbins/domain';
import type { PreviewEmitterId } from '@audiogubbins/game-audio';
import type { ProjectState } from '@audiogubbins/project-format';

import type { GamePreviewParts } from '../../audio/preview-runner.js';
import { PreviewCommand } from '../../commands/preview-run-commands.js';
import { PREVIEW_PANEL } from '../../input/use-shortcuts.js';
import type { AudioSettings } from '../../state/audio-settings-store.js';
import {
  draftChanged,
  type GamePreviewState,
  type ScenarioDraft,
} from '../../state/game-preview-store.js';
import type { Observable } from '../../state/observable.js';
import type { OpenProjectState } from '../../state/open-project-store.js';
import type { ProjectStores } from '../../state/project-stores.js';
import { CommandButton, type PanelCommands } from '../command-button.js';
import { ChoiceField, type Choice } from '../export/setting-fields.js';
import { EventLog } from './event-log.js';
import { PreviewPad } from './preview-pad.js';
import { EmitterList, ScenarioProblems, ScenarioSettings } from './scenario-editor.js';

/** What the panel reads of the panel context, and how its controls run commands. */
export interface PreviewPanelContext extends PanelCommands {
  readonly gamePreview: GamePreviewParts;
  readonly projects: Pick<ProjectStores, 'project'> | undefined;
  readonly audioSettings: Observable<AudioSettings>;
  readonly ids: IdGenerator;
}

const NOTHING: Observable<undefined> = { get: () => undefined, subscribe: () => () => undefined };

/** The project open in this tab, where one is. */
function useOpenState(project: Observable<OpenProjectState> | undefined): ProjectState | undefined {
  const read: Observable<OpenProjectState | undefined> = project ?? NOTHING;
  const open = useSyncExternalStore(read.subscribe, read.get);
  return open?.kind === 'open' ? open.snapshot.model.state : undefined;
}

/** A command over the scenario set up: its id, its words, its glyph and its tone. */
interface ScenarioAction {
  readonly id: string;
  readonly label: string;
  readonly icon?: IconName;
  readonly tone?: ButtonTone;
}

const SCENARIO_ACTIONS: readonly ScenarioAction[] = [
  { id: PreviewCommand.NewScenario, label: 'New scenario', icon: 'add' },
  { id: PreviewCommand.KeepScenario, label: 'Keep in the project' },
  { id: PreviewCommand.DeleteScenario, label: 'Delete', icon: 'delete', tone: ButtonTone.Quiet },
  { id: PreviewCommand.NewSeed, label: 'New seed', icon: 'new-seed' },
];

const RUN_ACTIONS: readonly ScenarioAction[] = [
  { id: PreviewCommand.Run, label: 'Run', icon: 'play' },
  { id: PreviewCommand.Stop, label: 'Stop', icon: 'stop', tone: ButtonTone.Destructive },
];

/** A command's button, its reason opened on hover or focus. */
function ActionButton({
  action,
  commands,
}: {
  readonly action: ScenarioAction;
  readonly commands: PanelCommands;
}): ReactNode {
  return (
    <CommandButton
      id={action.id}
      label={action.label}
      {...(action.icon === undefined ? {} : { icon: action.icon })}
      {...(action.tone === undefined ? {} : { tone: action.tone })}
      commands={commands}
      compact
    />
  );
}

/** The scenarios to choose from: the one set up, where it was never kept, then the project's. */
function scenarioChoices(
  draft: ScenarioDraft | undefined,
  project: ProjectState,
): readonly Choice<string>[] {
  const kept = [...(project.gameAudio?.scenarios.values() ?? [])].map((one) => ({
    value: one.id,
    label:
      draft?.scenario.id === one.id && draftChanged(draft) ? `${one.name} (changed)` : one.name,
  }));
  if (draft === undefined)
    return kept.length === 0 ? [] : [{ value: '', label: 'None set up' }, ...kept];
  return draft.kept === undefined
    ? [{ value: draft.scenario.id, label: `${draft.scenario.name} (not kept)` }, ...kept]
    : kept;
}

/** The scenario picker and the commands over the scenario set up. */
function ScenarioBar({
  draft,
  project,
  commands,
}: {
  readonly draft: ScenarioDraft | undefined;
  readonly project: ProjectState;
  readonly commands: PanelCommands;
}): ReactNode {
  const choices = scenarioChoices(draft, project);
  return (
    <div className="ag-control-row ag-preview-bar">
      {choices.length === 0 ? null : (
        <ChoiceField
          label="Scenario"
          value={draft?.scenario.id ?? ''}
          choices={choices}
          onChoose={(id) => {
            if (id !== '' && id !== draft?.scenario.id) {
              commands.run(PreviewCommand.ChooseScenario, { scenario: id });
            }
          }}
        />
      )}
      {SCENARIO_ACTIONS.map((action) => (
        <ActionButton key={action.id} action={action} commands={commands} />
      ))}
    </div>
  );
}

/** What the renders the members are heard from say: how far they have come, and any not kept. */
function rendersWords(renders: GamePreviewState['renders']): string | undefined {
  const { needed, made, declined } = renders;
  if (needed === 0) return undefined;
  const progress =
    made < needed
      ? `Preparing the sound of members whose processing measures its whole input: ${String(made)} of ${String(needed)} made; Run waits for them.`
      : `The sound of ${String(needed)} members whose processing measures its whole input is prepared.`;
  return declined.length === 0
    ? progress
    : `${progress} Not kept, so heard as it is worked out: ${declined.join(' ')}`;
}

/** Why a run ended, where the last one did. */
function endedWords(run: GamePreviewState['run']): string | undefined {
  return run.kind === 'ended' ? run.reasons.join(' ') : undefined;
}

/** What a running run says of itself: what is heard at once, the budget and how late a trigger is. */
function runningWords(run: GamePreviewState['run'], feedAhead: number): string | undefined {
  if (run.kind !== 'running') return undefined;
  const { budget, latencyMilliseconds } = run.stats;
  const latency =
    latencyMilliseconds === undefined
      ? `A hand trigger is heard after at least the ${String(feedAhead)} ms your performance profile feeds ahead.`
      : `The last hand trigger was heard ${String(Math.round(latencyMilliseconds))} ms after it was pressed.`;
  return [
    'While it runs, moving a still emitter or the listener, the panning and the bus levels are heard at once; any other change is heard from the next run.',
    `It plays at most ${String(budget)} voices at once at your preview quality; past that a voice is stolen or refused, as a game engine's virtual voices are.`,
    latency,
  ].join(' ');
}

/** The voices a running run sounds, by emitter. */
type Voices = ReadonlyMap<PreviewEmitterId, { readonly sounding: number; readonly limit: number }>;

/**
 * Each emitter's name and place, which its events are shown by, and the
 * emitters a running run is sounding, which the pad rings.
 */
function useEmittersShown(draft: ScenarioDraft, voices: Voices | undefined) {
  const emitters = useMemo(
    () =>
      new Map<PreviewEmitterId, { readonly name: string; readonly place: number }>(
        draft.scenario.emitters.map((one, place) => [one.id, { name: one.name, place }]),
      ),
    [draft],
  );
  const sounding = useMemo(
    () =>
      new Set<string>(
        [...(voices?.entries() ?? [])]
          .filter(([, one]) => one.sounding > 0)
          .map(([emitter]) => emitter),
      ),
    [voices],
  );
  return { emitters, sounding };
}

/** The scenario set up: its pad beside its emitters, what its run played, and its settings. */
function ScenarioWork({
  state,
  draft,
  project,
  context,
}: {
  readonly state: GamePreviewState;
  readonly draft: ScenarioDraft;
  readonly project: ProjectState;
  readonly context: PreviewPanelContext;
}): ReactNode {
  const { store } = context.gamePreview;
  const commands = context;
  const { run } = state;
  const played =
    run.kind !== 'idle' && run.stats.scenario === draft.scenario.id ? run.stats : undefined;
  const voices = run.kind === 'running' ? played?.voices : undefined;
  const { emitters, sounding } = useEmittersShown(draft, voices);
  const preparing = rendersWords(state.renders);
  const ended = endedWords(run);
  const edit = (scenario: ScenarioDraft['scenario']): void => {
    store.edit(() => scenario);
  };
  const parts = {
    project: project.project,
    game: project.gameAudio,
    ids: context.ids,
    commands,
    voices,
  };
  return (
    <>
      {preparing === undefined ? null : <p className="ag-preview-note">{preparing}</p>}
      {ended === undefined ? null : <p className="ag-preview-note">{ended}</p>}
      <ScenarioProblems scenario={draft.scenario} />
      <div className="ag-preview-split">
        <PreviewPad scenario={draft.scenario} sounding={sounding} onScenario={edit} />
        <EmitterList scenario={draft.scenario} parts={parts} onScenario={edit} />
      </div>
      {played === undefined ? null : (
        <EventLog
          events={played.recent}
          counts={played.counts}
          rate={project.project.settings.sampleRate}
          project={project.project}
          emitters={emitters}
        />
      )}
      <ScenarioSettings scenario={draft.scenario} parts={parts} onScenario={edit} />
    </>
  );
}

/** The panel's header: its title, Run and Stop, and what a run hears at once while it runs. */
function PreviewHeader({
  title,
  run,
  context,
}: {
  readonly title: string;
  readonly run: GamePreviewState['run'];
  readonly context: PreviewPanelContext;
}): ReactNode {
  const settings = useSyncExternalStore(context.audioSettings.subscribe, context.audioSettings.get);
  const running = runningWords(run, settings.chosen.settings.feedAheadMilliseconds);
  return (
    <PanelHeader
      title={title}
      icon="game-preview"
      actions={
        <>
          {running === undefined ? null : (
            <Hint label="About the preview while it runs">{running}</Hint>
          )}
          {RUN_ACTIONS.map((action) => (
            <ActionButton key={action.id} action={action} commands={context} />
          ))}
        </>
      }
    />
  );
}

/** The Game preview panel. */
export function GamePreviewPanel({
  title,
  context,
}: {
  readonly title: string;
  readonly context: PreviewPanelContext;
}): ReactNode {
  const { store } = context.gamePreview;
  const state = useSyncExternalStore(store.subscribe, store.get);
  const project = useOpenState(context.projects?.project);
  const { draft } = state;
  return (
    <section className="ag-panel ag-stacked-panel ag-preview" {...{ [PREVIEW_PANEL]: '' }}>
      <PreviewHeader title={title} run={state.run} context={context} />
      {project === undefined ? (
        <EmptyState
          icon="game-preview"
          title="No project open"
          text="Open a project to preview its asset groups as a game would play them."
        />
      ) : (
        <>
          <ScenarioBar draft={draft} project={project} commands={context} />
          {draft === undefined ? (
            <EmptyState
              icon="game-preview"
              title="No scenario set up"
              text="Set up a scenario: a new one, or one the project keeps. A run never changes the project."
            />
          ) : (
            <ScenarioWork state={state} draft={draft} project={project} context={context} />
          )}
        </>
      )}
    </section>
  );
}
