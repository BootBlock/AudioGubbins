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

import type { IdGenerator } from '@audiogubbins/domain';
import type { PreviewEmitterId } from '@audiogubbins/game-audio';
import type { ProjectState } from '@audiogubbins/project-format';

import type { GamePreviewParts } from '../../audio/preview-runner.js';
import { PreviewCommand } from '../../commands/preview-run-commands.js';
import type { AudioSettings } from '../../state/audio-settings-store.js';
import {
  draftChanged,
  type GamePreviewState,
  type ScenarioDraft,
} from '../../state/game-preview-store.js';
import type { Observable } from '../../state/observable.js';
import type { OpenProjectState } from '../../state/open-project-store.js';
import type { ProjectStores } from '../../state/project-stores.js';
import { CommandButton, useCommandReasons, type PanelCommands } from '../command-button.js';
import { ChoiceField, type Choice } from '../export/setting-fields.js';
import { EventLog } from './event-log.js';
import { PreviewPad } from './preview-pad.js';
import { ScenarioEditor } from './scenario-editor.js';

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

const SCENARIO_BUTTONS: readonly (readonly [string, string])[] = [
  [PreviewCommand.NewScenario, 'New scenario'],
  [PreviewCommand.KeepScenario, 'Keep in the project'],
  [PreviewCommand.DeleteScenario, 'Delete'],
  [PreviewCommand.NewSeed, 'New seed'],
];

const RUN_BUTTONS: readonly (readonly [string, string])[] = [
  [PreviewCommand.Run, 'Run'],
  [PreviewCommand.Stop, 'Stop'],
];

/** A row of command buttons, their reasons said once above them. */
function CommandRow({
  buttons,
  commands,
  children,
}: {
  readonly buttons: readonly (readonly [string, string])[];
  readonly commands: PanelCommands;
  readonly children?: ReactNode;
}): ReactNode {
  const shared = useCommandReasons(
    commands,
    buttons.map(([id]) => id),
  );
  return (
    <div className="ag-preview-actions">
      {children}
      {buttons.map(([id, label]) => (
        <CommandButton key={id} id={id} label={label} commands={commands} shared={shared} compact />
      ))}
    </div>
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
    <CommandRow buttons={SCENARIO_BUTTONS} commands={commands}>
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
    </CommandRow>
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

/** What a run says of itself: what is heard at once, the budget and how late a trigger is. */
function runWords(run: GamePreviewState['run'], feedAhead: number): string | undefined {
  if (run.kind === 'ended') return run.reasons.join(' ');
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

/** The scenario set up: its run, its pad, its editor and what its run played. */
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
  const settings = useSyncExternalStore(context.audioSettings.subscribe, context.audioSettings.get);
  const { run } = state;
  const played =
    run.kind !== 'idle' && run.stats.scenario === draft.scenario.id ? run.stats : undefined;
  const names = useMemo(
    () =>
      new Map<PreviewEmitterId, string>(draft.scenario.emitters.map((one) => [one.id, one.name])),
    [draft],
  );
  const said = runWords(run, settings.chosen.settings.feedAheadMilliseconds);
  const preparing = rendersWords(state.renders);
  const edit = (scenario: ScenarioDraft['scenario']): void => {
    store.edit(() => scenario);
  };
  return (
    <>
      <CommandRow buttons={RUN_BUTTONS} commands={commands} />
      {preparing === undefined ? null : <p className="ag-panel-note">{preparing}</p>}
      {said === undefined ? null : <p className="ag-panel-note">{said}</p>}
      <PreviewPad scenario={draft.scenario} onScenario={edit} />
      <ScenarioEditor
        scenario={draft.scenario}
        parts={{
          project: project.project,
          game: project.gameAudio,
          ids: context.ids,
          commands,
          voices: run.kind === 'running' ? played?.voices : undefined,
        }}
        onScenario={edit}
      />
      {played === undefined ? null : (
        <EventLog
          events={played.recent}
          counts={played.counts}
          rate={project.project.settings.sampleRate}
          project={project.project}
          emitterNames={names}
        />
      )}
    </>
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
    <section className="ag-panel">
      <h2 className="ag-panel-title">{title}</h2>
      {project === undefined ? (
        <p className="ag-panel-note">
          Open a project to preview its asset groups as a game would play them.
        </p>
      ) : (
        <>
          <ScenarioBar draft={draft} project={project} commands={context} />
          {draft === undefined ? (
            <p className="ag-panel-note">
              Set up a scenario: a new one, or one the project keeps. A run never changes the
              project.
            </p>
          ) : (
            <ScenarioWork state={state} draft={draft} project={project} context={context} />
          )}
        </>
      )}
    </section>
  );
}
