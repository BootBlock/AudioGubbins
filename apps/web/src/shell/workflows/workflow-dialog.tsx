/**
 * A guided workflow's dialog (ADR-0105, REQ-GAME-075): what it runs on, its
 * options with their defaults and where each came from, the analyses it
 * needs with their progress, and every item of its plan with what will
 * change, before anything does; then Apply, which runs the plan as one step
 * of the history, and what follows the step.
 *
 * The dialog shows the draft its store holds and changes the options through
 * it; every action that does something, analysing, leaving refused items
 * out, applying and closing, runs a command, so the palette and a shortcut
 * reach the same action.
 */

import { useId, useSyncExternalStore, type ReactNode } from 'react';

import { Button, ButtonTone, ModalDialog } from '@audiogubbins/design-system';
import {
  CLEAN_DIALOGUE,
  CREATE_SEAMLESS_LOOP,
  CUT_INTO_SOUNDS,
  EXPORT_FOR_GODOT,
  NORMALISE_GAME_SFX,
  PREPARE_ONE_SHOT,
  type WorkflowKey,
} from '@audiogubbins/guided-workflows';
import type { ProjectState } from '@audiogubbins/project-format';

import type { ShellContext } from '../../commands/shell-context.js';
import { WorkflowCommand } from '../../commands/workflow-command-ids.js';
import {
  readWorkflow,
  refusedTargets,
  type WorkflowReading,
} from '../../commands/workflow-planning.js';
import type { WorkflowAnalysisState } from '../../analysis/workflow-analysing.js';
import { WORKFLOW_DIALOG } from '../../input/use-shortcuts.js';
import type { ProjectStores } from '../../state/project-stores.js';
import type { OpenWorkflowDialog, WorkflowDraftStore } from '../../state/workflow-draft-store.js';
import type { PanelCommands } from '../command-button.js';
import { NotedButton } from '../settings/reasoned-button.js';
import type { RunCommand } from '../settings/section.js';
import { LoopChoices } from './loop-choices.js';
import { WorkflowAnalysisStatus } from './workflow-analysis-status.js';
import { WorkflowFollowUps } from './workflow-follow-ups.js';
import { WorkflowItems } from './workflow-items.js';
import { WorkflowOptions } from './workflow-options.js';
import { WorkflowSubject } from './workflow-subject.js';
import { WORKFLOW_PURPOSES } from './workflow-words.js';

const TITLES: Readonly<Record<WorkflowKey, string>> = {
  'cut-into-sounds': CUT_INTO_SOUNDS.label,
  'prepare-one-shot': PREPARE_ONE_SHOT.label,
  'create-seamless-loop': CREATE_SEAMLESS_LOOP.label,
  'normalise-game-sfx': NORMALISE_GAME_SFX.label,
  'clean-dialogue': CLEAN_DIALOGUE.label,
  'export-for-godot': EXPORT_FOR_GODOT.label,
};

/** The project open in `stores`, as it is now, where one is open. */
function useProjectStateOf(stores: ProjectStores): ProjectState | undefined {
  const open = useSyncExternalStore(stores.project.subscribe, stores.project.get);
  return open.kind === 'open' ? open.snapshot.model.state : undefined;
}

/** Every store a reading of the dialog depends on, followed so it draws again as each changes. */
function useReadingSources(context: ShellContext): void {
  useSyncExternalStore(context.detection.subscribe, context.detection.get);
  const { analyses } = context.loopAnalysis;
  useSyncExternalStore(analyses.subscribe, analyses.get);
  useSyncExternalStore(context.packs.availability.subscribe, context.packs.availability.get);
  useSyncExternalStore(context.assets.subscribe, context.assets.get);
  useSyncExternalStore(context.audioSettings.subscribe, context.audioSettings.get);
}

/** What the open dialog holds while it is being set up. */
function Setting({
  open,
  store,
  state,
  reading,
  running,
  commands,
}: {
  readonly open: OpenWorkflowDialog;
  readonly store: WorkflowDraftStore;
  readonly state: ProjectState;
  readonly reading: WorkflowReading;
  readonly running: WorkflowAnalysisState;
  readonly commands: PanelCommands;
}): ReactNode {
  const { draft } = open;
  const statuses = reading.needs.ok ? reading.needs.value : [];
  return (
    <>
      <WorkflowSubject
        targets={open.targets}
        sound={open.sound}
        state={state}
        onTargets={(targets) => {
          store.chooseTargets(targets, state);
        }}
      />
      <section className="ag-workflow-section ag-workflow-options" aria-label="Options">
        <WorkflowOptions draft={draft} state={state} onDraft={store.edit} />
      </section>
      <WorkflowAnalysisStatus
        needs={reading.needs}
        running={running}
        state={state}
        commands={commands}
      />
      {draft.key === 'create-seamless-loop' && (
        <LoopChoices draft={draft} statuses={statuses} state={state} onDraft={store.edit} />
      )}
      <WorkflowItems plan={reading.plan} state={state} />
    </>
  );
}

/** The buttons along the bottom: Close, and while setting up, leaving refused items out and Apply. */
function Actions({
  open,
  run,
  unavailableReason,
  refused,
}: {
  readonly open: OpenWorkflowDialog | undefined;
  readonly run: RunCommand;
  readonly unavailableReason: (id: string) => string | undefined;
  readonly refused: boolean;
}): ReactNode {
  const reasonId = useId();
  const applyReason = unavailableReason(WorkflowCommand.Apply);
  const setting = open?.step.kind === 'setting';
  return (
    <>
      {setting && applyReason !== undefined && (
        <p id={reasonId} className="ag-panel-note" data-ag-status="unavailable">
          {applyReason}
        </p>
      )}
      <Button
        onClick={() => {
          run(WorkflowCommand.Close);
        }}
      >
        {setting ? 'Cancel' : 'Close'}
      </Button>
      {setting && refused && (
        <Button
          onClick={() => {
            run(WorkflowCommand.LeaveOutRefused);
          }}
        >
          Leave these out
        </Button>
      )}
      {setting && (
        <NotedButton
          tone={ButtonTone.Primary}
          reasonId={applyReason === undefined ? undefined : reasonId}
          onPress={() => {
            run(WorkflowCommand.Apply);
          }}
        >
          Apply
        </NotedButton>
      )}
    </>
  );
}

/** What the open dialog holds, by where it is: being set up, applying, or applied. */
function Body({
  open,
  store,
  state,
  reading,
  running,
  commands,
}: {
  readonly open: OpenWorkflowDialog;
  readonly store: WorkflowDraftStore;
  readonly state: ProjectState;
  readonly reading: WorkflowReading | undefined;
  readonly running: WorkflowAnalysisState;
  readonly commands: PanelCommands;
}): ReactNode {
  if (open.step.kind === 'applied') {
    return <WorkflowFollowUps step={open.step} commands={commands} />;
  }
  if (open.step.kind === 'applying' || reading === undefined) {
    return <p role="status">Applying…</p>;
  }
  return (
    <Setting
      open={open}
      store={store}
      state={state}
      reading={reading}
      running={running}
      commands={commands}
    />
  );
}

/** The dialog (see the module comment). */
export function WorkflowDialog({
  context,
  stores,
  run,
  unavailableReason,
}: {
  readonly context: ShellContext;
  readonly stores: ProjectStores;
  readonly run: RunCommand;
  readonly unavailableReason: (id: string) => string | undefined;
}): ReactNode {
  const store = stores.workflowDraft;
  const shown = useSyncExternalStore(store.subscribe, store.get);
  const state = useProjectStateOf(stores);
  const open = shown.kind === 'open' ? shown : undefined;
  useReadingSources(context);
  const running = useSyncExternalStore(
    context.workflowAnalysis.subscribe,
    context.workflowAnalysis.get,
  );
  const reading =
    open?.step.kind === 'setting' && state !== undefined
      ? readWorkflow(context, open, state, store.planned)
      : undefined;
  const refused = reading?.plan.ok === true && refusedTargets(reading.plan.value).length > 0;
  return (
    <ModalDialog
      open={open !== undefined}
      onOpenChange={(isOpen) => {
        if (!isOpen) run(WorkflowCommand.Close);
      }}
      title={open === undefined ? 'Workflow' : TITLES[open.draft.key]}
      description={open === undefined ? '' : WORKFLOW_PURPOSES[open.draft.key]}
      actions={
        <Actions open={open} run={run} unavailableReason={unavailableReason} refused={refused} />
      }
    >
      {open !== undefined && state !== undefined && (
        <div className="ag-workflow" {...{ [WORKFLOW_DIALOG]: '' }}>
          <Body
            open={open}
            store={store}
            state={state}
            reading={reading}
            running={running}
            commands={{ run, unavailableReason }}
          />
        </div>
      )}
    </ModalDialog>
  );
}
