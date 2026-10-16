import { describe, expect, it } from 'vitest';

import type { CommandInvocation } from '@audiogubbins/commands';

import { holdPlatformFiles, type AudioWindow } from '../testing/project-audio.js';
import { analysesEnded, groupOfTwo } from '../testing/workflow-projects.js';
import { WORKFLOW_KEYS, WORKFLOW_OPENING, WorkflowCommand } from './workflow-command-ids.js';

holdPlatformFiles();

/** The detections run on the worker's core in the test's own thread. */
const ANALYSING = { timeout: 120_000 };

/** How a command is brought to where it can run, its arguments, and then run twice. */
interface Case {
  readonly id: string;
  readonly before?: (audio: AudioWindow, group: string) => Promise<void> | void;
  readonly args?: (group: string) => CommandInvocation['arguments'];
}

const openOneShot = (audio: AudioWindow, group: string): void => {
  audio.window.run(WORKFLOW_OPENING['prepare-one-shot'], { group });
};

const CASES: readonly Case[] = [
  ...WORKFLOW_KEYS.map((key): Case => ({
    id: WORKFLOW_OPENING[key],
    ...(key === 'cut-into-sounds' ? {} : { args: (group: string) => ({ group }) }),
  })),
  { id: WorkflowCommand.Analyse, before: openOneShot },
  {
    id: WorkflowCommand.CancelAnalysis,
    before: (audio, group) => {
      openOneShot(audio, group);
      audio.window.run(WorkflowCommand.Analyse);
    },
  },
  { id: WorkflowCommand.LeaveOutRefused, before: openOneShot },
  {
    id: WorkflowCommand.Apply,
    before: async (audio, group) => {
      openOneShot(audio, group);
      audio.window.run(WorkflowCommand.Analyse);
      await analysesEnded(audio);
    },
  },
  { id: WorkflowCommand.Close, before: openOneShot },
];

describe('the guided workflows’ commands', () => {
  it.each(CASES.map((one) => [one.id, one] as const))(
    'refuse %s a second time, which would change nothing',
    ANALYSING,
    async (_id, { id, before, args }) => {
      // Recorded as applied while changing nothing, a second run would tell
      // the log and the person something that did not happen.
      const { audio, group } = await groupOfTwo();
      await before?.(audio, group.id);
      const given = args?.(group.id);

      expect(audio.window.run(id, given).kind).toBe('applied');
      // Each finds the dialog where its first run left it, so it changes
      // nothing a second time and says so.
      expect(audio.window.run(id, given).kind).not.toBe('applied');
    },
  );
});
