/**
 * What another package's tests may take from the guided workflows' test
 * support: a project with asset groups made through the project's commands, a
 * bus that runs them, and assistants' answers written by hand, so the
 * application's tests of the workflow dialog plan over the states and answers
 * the planners' own tests do.
 *
 * Apart from the package's entry point, because none of it is production
 * code.
 */

export {
  type WorkflowWorld,
  applied,
  stateText,
  workflowBus,
  workflowWorld,
} from './workflow-states.js';
export {
  REPAIR_KEY,
  RESTORATION_KEY,
  frames,
  repairReport,
  restorationReport,
  silenceReport,
  wholeAnalysis,
} from './assistant-reports.js';
