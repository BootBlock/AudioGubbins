/**
 * The identifiers of the guided workflows' commands (ADR-0105), named once
 * for the commands, the menus, the shortcuts and the dialog that run them.
 */

import type { WorkflowKey } from '@audiogubbins/guided-workflows';

/** Every workflow, in the order the menus list them. */
export const WORKFLOW_KEYS: readonly WorkflowKey[] = [
  'cut-into-sounds',
  'prepare-one-shot',
  'create-seamless-loop',
  'normalise-game-sfx',
  'clean-dialogue',
  'export-for-godot',
];

/** The command that opens each workflow's dialog. */
export const WORKFLOW_OPENING: Readonly<Record<WorkflowKey, string>> = {
  'cut-into-sounds': 'workflow.cut-into-sounds',
  'prepare-one-shot': 'workflow.prepare-one-shot',
  'create-seamless-loop': 'workflow.create-seamless-loop',
  'normalise-game-sfx': 'workflow.normalise-game-sfx',
  'clean-dialogue': 'workflow.clean-dialogue',
  'export-for-godot': 'workflow.export-for-godot',
};

/** The commands of an open workflow dialog. */
export const WorkflowCommand = {
  /** Runs the analyses the workflow needs that are not current. */
  Analyse: 'workflow.analyse',
  CancelAnalysis: 'workflow.cancel-analysis',
  /** Leaves the items the plan refused out of the run, and plans the rest. */
  LeaveOutRefused: 'workflow.leave-out-refused',
  /** Runs the plan as one history step. */
  Apply: 'workflow.apply',
  Close: 'workflow.close',
} as const;

/**
 * The Asset groups' commands that follow a step: exporting members, which is
 * never inside an undoable step (ADR-0092), and measuring their loudness for
 * conformance. Each takes the members as `members`, their keys (`memberKey`)
 * separated by commas.
 */
export const FollowUpCommand = {
  ExportMembers: 'game.export-members',
  MeasureLoudness: 'game.measure-loudness',
} as const;
