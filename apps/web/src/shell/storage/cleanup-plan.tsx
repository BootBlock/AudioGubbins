/**
 * A cleanup planned and waiting: its steps in the order that is safest, each
 * with what it frees and what it costs, the ones to leave out, and the
 * confirmation that carries it out (REQ-STOR-106, REQ-STOR-102, REQ-STOR-200).
 *
 * A plan of caches alone is carried out at a press, since nothing is lost by
 * it. A plan reaching past the caches says how much it removes for good, and
 * the button that carries it out says it too; the bytes it names are the ones
 * the storage checks. Leaving a step out plans again with the others, so what
 * is confirmed is always a plan the storage made.
 */

import { useState, type ReactNode } from 'react';

import { Button, ButtonTone, ToggleSwitch } from '@audiogubbins/design-system';
import type { CleanupPlan } from '@audiogubbins/storage';

import { describeBytes } from '../../wording.js';
import type { RunCommand } from '../settings/section.js';
import { choiceOf, lossOf, refusalSentence, stepName } from './storage-words.js';

/** The steps, each with what it frees and costs, and whether it is left out. */
function Steps({
  plan,
  leftOut,
  onLeaveOut,
}: {
  readonly plan: CleanupPlan;
  readonly leftOut: ReadonlySet<string>;
  readonly onLeaveOut: (choice: string, out: boolean) => void;
}): ReactNode {
  if (plan.steps.length === 0) return <p>There is nothing to clean up.</p>;
  return (
    <ol className="ag-cleanup-steps">
      {plan.steps.map((step) => {
        const choice = choiceOf(step);
        return (
          <li key={choice} className="ag-cleanup-step">
            <ToggleSwitch
              label={`${stepName(step)}: ${describeBytes(step.bytes)}`}
              description={lossOf(step)}
              checked={!leftOut.has(choice)}
              onCheckedChange={(included) => {
                onLeaveOut(choice, !included);
              }}
            />
          </li>
        );
      })}
    </ol>
  );
}

/**
 * What carries the plan out: planning again without the steps left out, or the
 * confirmation that names what goes for good, or clearing what is made again.
 */
function Decision({
  plan,
  leftOut,
  run,
}: {
  readonly plan: CleanupPlan;
  readonly leftOut: ReadonlySet<string>;
  readonly run: RunCommand;
}): ReactNode {
  const total = describeBytes(plan.steps.reduce((sum, step) => sum + step.bytes, 0));
  const lastingly = describeBytes(plan.confirmationBytes);
  if (leftOut.size > 0) {
    const kept = plan.steps.map(choiceOf).filter((choice) => !leftOut.has(choice));
    return (
      <Button compact onClick={() => run('storage.plan-cleanup', { choices: kept.join(',') })}>
        Plan again without what is left out
      </Button>
    );
  }
  if (plan.confirmationBytes > 0) {
    return (
      <>
        <p data-ag-status="unavailable">
          {`This frees ${total}, of which ${lastingly} cannot be made again and goes for good.`}
        </p>
        <Button
          compact
          tone={ButtonTone.Destructive}
          onClick={() => run('storage.clean-up', { bytes: plan.confirmationBytes })}
        >
          {`Remove ${lastingly} for good`}
        </Button>
      </>
    );
  }
  return plan.steps.length === 0 ? null : (
    <Button compact tone={ButtonTone.Primary} onClick={() => run('storage.clean-up')}>
      {`Clear ${total}`}
    </Button>
  );
}

/** The plan (see the module comment). */
export function CleanupPlanView({
  plan,
  run,
}: {
  readonly plan: CleanupPlan;
  readonly run: RunCommand;
}): ReactNode {
  const [leftOut, setLeftOut] = useState<ReadonlySet<string>>(new Set());
  const leaveOut = (choice: string, out: boolean): void => {
    const next = new Set(leftOut);
    if (out) next.add(choice);
    else next.delete(choice);
    setLeftOut(next);
  };
  return (
    <div role="group" className="ag-cleanup-plan" aria-label="The planned cleanup">
      <h3 className="ag-section-heading">Cleanup, safest first</h3>
      {plan.mediaRefused !== undefined && (
        <p data-ag-status="reduced">{refusalSentence(plan.mediaRefused)}</p>
      )}
      <Steps plan={plan} leftOut={leftOut} onLeaveOut={leaveOut} />
      <div className="ag-settings-row">
        <Decision plan={plan} leftOut={leftOut} run={run} />
        <Button compact onClick={() => run('storage.dismiss-cleanup')}>
          Put the plan away
        </Button>
      </div>
    </div>
  );
}
