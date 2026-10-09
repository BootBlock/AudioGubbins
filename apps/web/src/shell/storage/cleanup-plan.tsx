/**
 * A cleanup planned and waiting: its steps in the order that is safest, each
 * with what it frees and what it costs, the ones to leave out, the model packs
 * to choose, and the confirmation that carries it out (REQ-STOR-106,
 * REQ-STOR-102, REQ-STOR-200, REQ-AUDIO-139).
 *
 * Each step says what it costs in a sentence, then what it takes item by item:
 * each project, backup, part of a history and model pack. A plan of caches and
 * unfinished downloads alone is carried out at a press, since nothing is lost
 * by it. A plan reaching further says how much it removes, telling what goes
 * for good from model packs that can be downloaded again, and the button that
 * carries it out says it too; the bytes it names are the ones the storage
 * checks. Every installed model pack is listed, off until the person turns it
 * on, and one the plan keeps says why and cannot be turned on. Leaving a step
 * out or choosing a pack plans again, so what is confirmed is always a plan the
 * storage made, and leaving every step out plans nothing.
 */

import { useState, type ReactNode } from 'react';

import { Button, ButtonTone, ToggleSwitch } from '@audiogubbins/design-system';
import type { ProjectId } from '@audiogubbins/domain';
import type { CleanupPlan, CleanupStep } from '@audiogubbins/storage';

import { showPanelCommandId } from '../../commands/panel-commands.js';
import { ModelPanelKinds } from '../../panel-kinds.js';
import { describeBytes } from '../../wording.js';
import type { RunCommand } from '../settings/section.js';
import { refusalSentence } from '../../cleanup-words.js';
import {
  choiceOf,
  choicesOf,
  confirmationWords,
  keptSentence,
  lossOf,
  packChoice,
  stepDetails,
  stepName,
} from './storage-words.js';

/** What the person has changed of the plan: the steps left out and the packs chosen. */
interface Changes {
  readonly leftOut: ReadonlySet<string>;
  readonly packs: ReadonlySet<string>;
}

/** The model pack versions a plan already removes, as the cleanup command names them. */
function packsPlanned(plan: CleanupPlan): ReadonlySet<string> {
  return new Set(
    plan.steps.flatMap((step) => (step.kind === 'model-packs' ? choicesOf(step) : [])),
  );
}

/** Whether a step is kept in, by the person's changes: the packs step while any of its packs is. */
function included(step: CleanupStep, changes: Changes): boolean {
  return step.kind === 'model-packs'
    ? choicesOf(step).some((choice) => changes.packs.has(choice))
    : !changes.leftOut.has(choiceOf(step));
}

/** The steps, each with what it frees and costs, and whether it is left out. */
function Steps({
  plan,
  nameOf,
  changes,
  onInclude,
}: {
  readonly plan: CleanupPlan;
  readonly nameOf: (project: ProjectId) => string | undefined;
  readonly changes: Changes;
  readonly onInclude: (step: CleanupStep, include: boolean) => void;
}): ReactNode {
  if (plan.steps.length === 0) return <p>There is nothing to clean up.</p>;
  return (
    <ol className="ag-cleanup-steps">
      {plan.steps.map((step) => {
        const details = stepDetails(step, nameOf);
        return (
          <li key={choiceOf(step)} className="ag-cleanup-step">
            <ToggleSwitch
              label={`${stepName(step)}: ${describeBytes(step.bytes)}`}
              description={lossOf(step)}
              checked={included(step, changes)}
              onCheckedChange={(include) => {
                onInclude(step, include);
              }}
            />
            {details.length > 0 && (
              <ul className="ag-cleanup-lost" aria-label={`What ${stepName(step)} takes`}>
                {details.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Every installed model pack, to be chosen one by one, or kept and why. */
function InstalledPacks({
  plan,
  chosen,
  onChoose,
  run,
}: {
  readonly plan: CleanupPlan;
  readonly chosen: ReadonlySet<string>;
  readonly onChoose: (choice: string, chosen: boolean) => void;
  readonly run: RunCommand;
}): ReactNode {
  if (plan.installedPacks.length === 0) return null;
  return (
    <div role="group" aria-label="Installed model packs">
      <h4 className="ag-section-heading">Model packs you may remove</h4>
      <Button compact onClick={() => run(showPanelCommandId(ModelPanelKinds.ModelPacks))}>
        Manage model packs
      </Button>
      <ul className="ag-cleanup-steps">
        {plan.installedPacks.map((pack) => {
          const choice = packChoice(pack);
          return (
            <li key={choice} className="ag-cleanup-step">
              <ToggleSwitch
                label={`${pack.name} ${pack.ref.version}: ${describeBytes(pack.bytes)}`}
                description={
                  pack.kept === undefined
                    ? 'Removed only if you turn this on. The processors that need it cannot run until you download it again.'
                    : keptSentence(pack.kept)
                }
                checked={chosen.has(choice)}
                disabled={pack.kept !== undefined}
                onCheckedChange={(on) => {
                  onChoose(choice, on);
                }}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * What carries the plan out: planning again with the person's changes, or the
 * confirmation that names what it removes, or clearing what is made again.
 */
function Decision({
  plan,
  changes,
  run,
}: {
  readonly plan: CleanupPlan;
  readonly changes: Changes;
  readonly run: RunCommand;
}): ReactNode {
  const planned = packsPlanned(plan);
  const chosenAnew = [...changes.packs].some((choice) => !planned.has(choice));
  const packsChanged = chosenAnew || [...planned].some((choice) => !changes.packs.has(choice));
  if (changes.leftOut.size > 0 || packsChanged) {
    const kept = [
      ...plan.steps
        .filter((step) => step.kind !== 'model-packs' && included(step, changes))
        .map(choiceOf),
      ...changes.packs,
    ];
    return (
      <>
        {kept.length === 0 && <p>Every step is left out, so planning again cleans up nothing.</p>}
        <Button compact onClick={() => run('storage.plan-cleanup', { choices: kept.join(',') })}>
          {chosenAnew
            ? 'Plan again with the packs you chose'
            : 'Plan again without what is left out'}
        </Button>
      </>
    );
  }
  if (plan.confirmationBytes > 0) {
    const words = confirmationWords(plan);
    return (
      <>
        <p data-ag-status="unavailable">{words.sentence}</p>
        <Button
          compact
          tone={ButtonTone.Destructive}
          onClick={() => run('storage.clean-up', { bytes: plan.confirmationBytes })}
        >
          {words.button}
        </Button>
      </>
    );
  }
  const total = describeBytes(plan.steps.reduce((sum, step) => sum + step.bytes, 0));
  return plan.steps.length === 0 ? null : (
    <Button compact tone={ButtonTone.Primary} onClick={() => run('storage.clean-up')}>
      {`Clear ${total}`}
    </Button>
  );
}

/** The plan (see the module comment). */
export function CleanupPlanView({
  plan,
  nameOf,
  run,
}: {
  readonly plan: CleanupPlan;

  /** The name of a project a step names, where the library holds it. */
  readonly nameOf: (project: ProjectId) => string | undefined;
  readonly run: RunCommand;
}): ReactNode {
  const [changes, setChanges] = useState<Changes>(() => ({
    leftOut: new Set(),
    packs: packsPlanned(plan),
  }));
  const choosePacks = (choices: readonly string[], chosen: boolean): void => {
    const packs = new Set(changes.packs);
    for (const choice of choices) {
      if (chosen) packs.add(choice);
      else packs.delete(choice);
    }
    setChanges({ ...changes, packs });
  };
  const include = (step: CleanupStep, chosen: boolean): void => {
    if (step.kind === 'model-packs') {
      choosePacks(choicesOf(step), chosen);
      return;
    }
    const leftOut = new Set(changes.leftOut);
    if (chosen) leftOut.delete(choiceOf(step));
    else leftOut.add(choiceOf(step));
    setChanges({ ...changes, leftOut });
  };
  return (
    <div role="group" className="ag-cleanup-plan" aria-label="The planned cleanup">
      <h3 className="ag-section-heading">Cleanup, safest first</h3>
      {plan.mediaRefused !== undefined && (
        <p data-ag-status="reduced">{refusalSentence(plan.mediaRefused)}</p>
      )}
      <Steps plan={plan} nameOf={nameOf} changes={changes} onInclude={include} />
      <InstalledPacks
        plan={plan}
        chosen={changes.packs}
        onChoose={(choice, chosen) => {
          choosePacks([choice], chosen);
        }}
        run={run}
      />
      <div className="ag-settings-row">
        <Decision plan={plan} changes={changes} run={run} />
        <Button compact onClick={() => run('storage.dismiss-cleanup')}>
          Put the plan away
        </Button>
      </div>
    </div>
  );
}
