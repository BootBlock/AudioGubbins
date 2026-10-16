import { describe, expect, it } from 'vitest';

import {
  canonicalJson,
  writeProjectDocument,
  type ProjectState,
} from '@audiogubbins/project-format';

import { holdPlatformFiles, windowWithAudio, type AudioWindow } from '../testing/project-audio.js';
import {
  RATE,
  analysesEnded,
  groupOfTwo,
  inTheEditor,
  stateOf,
  twoBursts,
} from '../testing/workflow-projects.js';
import { WorkflowCommand } from './workflow-command-ids.js';
import { readWorkflow } from './workflow-planning.js';

holdPlatformFiles();

/** The detections run on the worker's core in the test's own thread. */
const ANALYSING = { timeout: 120_000 };

/** A state's document, as text: equal states, equal text. */
function text(state: ProjectState): string {
  return canonicalJson(writeProjectDocument(state));
}

/** The open dialog's plan, as it shows it now. */
function shownPlan(audio: AudioWindow) {
  const { context, projects } = audio.window;
  const open = projects.workflowDraft.get();
  if (open.kind !== 'open') throw new Error('The workflow is not open.');
  return readWorkflow(context, open, stateOf(audio), projects.workflowDraft.planned).plan;
}

/** Runs the workflow's analyses and waits for every one to answer. */
async function analysed(audio: AudioWindow): Promise<void> {
  expect(audio.window.run(WorkflowCommand.Analyse).kind).toBe('applied');
  await analysesEnded(audio);
}

/** Waits for the open dialog's step to settle. */
async function settled(audio: AudioWindow): Promise<string> {
  const store = audio.window.projects.workflowDraft;
  await expect
    .poll(
      () => {
        const open = store.get();
        return open.kind === 'open' ? open.step.kind : 'closed';
      },
      { timeout: 10_000 },
    )
    .not.toBe('applying');
  const open = store.get();
  return open.kind === 'open' ? open.step.kind : 'closed';
}

describe('running a guided workflow', () => {
  it(
    'dispatches nothing while an item is refused, and nothing once every item is left out',
    ANALYSING,
    async () => {
      const { audio, group } = await groupOfTwo();
      const before = text(stateOf(audio));

      expect(audio.window.run('workflow.prepare-one-shot', { group: group.id }).kind).toBe(
        'applied',
      );
      const plan = shownPlan(audio);
      expect(plan.ok && plan.value.items.map((item) => item.kind)).toEqual(['refused', 'refused']);

      expect(audio.window.run(WorkflowCommand.Apply).kind).toBe('refused');
      expect(audio.window.run(WorkflowCommand.LeaveOutRefused).kind).toBe('applied');
      const after = shownPlan(audio);
      expect(after.ok && after.value.items.map((item) => item.kind)).toEqual([
        'skipped',
        'skipped',
      ]);
      expect(audio.window.run(WorkflowCommand.Apply).kind).toBe('refused');

      expect(text(stateOf(audio))).toBe(before);
    },
  );

  it(
    'runs Prepare One-Shot on a group as one step, which one undo reverses',
    ANALYSING,
    async () => {
      const { audio, group } = await groupOfTwo();
      const before = text(stateOf(audio));
      audio.window.run('workflow.prepare-one-shot', { group: group.id });
      await analysed(audio);

      const plan = shownPlan(audio);
      expect(plan.ok && plan.value.items.map((item) => item.kind)).toEqual(['planned', 'planned']);
      expect(audio.window.run(WorkflowCommand.Apply).kind).toBe('applied');
      expect(await settled(audio)).toBe('applied');

      const state = stateOf(audio);
      expect(text(state)).not.toBe(before);
      // Ordinary regions, trimmed to their sounds: nothing marks them as a workflow's.
      for (const region of state.project.regions.values()) {
        expect(region.end - region.start).toBeLessThan(RATE / 2);
      }
      expect(audio.window.said.at(-1)).toContain('2 items changed');

      expect((await audio.session.undo()).ok).toBe(true);
      expect(text(stateOf(audio))).toBe(before);
    },
  );

  it(
    'cuts a recording into sounds in a new group, the group and the regions one step',
    ANALYSING,
    async () => {
      const audio = await windowWithAudio({ fixture: twoBursts(), name: 'Steps' });
      const { projects } = audio.window;
      inTheEditor(audio);
      const before = text(stateOf(audio));

      expect(audio.window.run('workflow.cut-into-sounds').kind).toBe('applied');
      projects.workflowDraft.edit((draft) =>
        draft.key === 'cut-into-sounds'
          ? {
              key: draft.key,
              fields: {
                ...draft.fields,
                destination: {
                  value: { kind: 'new', path: 'Footsteps/Grass' },
                  source: { kind: 'chosen' },
                },
              },
            }
          : draft,
      );
      await analysed(audio);
      expect(audio.window.run(WorkflowCommand.Apply).kind).toBe('applied');
      expect(await settled(audio)).toBe('applied');

      const game = stateOf(audio).gameAudio;
      const groups = [...(game?.groups.values() ?? [])];
      expect(groups.map((one) => one.name).toSorted()).toEqual(['Footsteps', 'Grass']);
      const grass = groups.find((one) => one.name === 'Grass');
      expect(game?.memberships.filter((one) => one.group === grass?.id)).toHaveLength(2);
      expect(stateOf(audio).project.regions.size).toBe(2);

      expect((await audio.session.undo()).ok).toBe(true);
      expect(text(stateOf(audio))).toBe(before);
    },
  );
});
