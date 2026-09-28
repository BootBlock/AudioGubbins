import { describe, expect, it, vi } from 'vitest';

import { commandId, refusal, unchanged, type ExecutionResult } from '@audiogubbins/commands';

import { dockRearrangement } from './dock-rearrangement.js';

/** A run that answers as the bus would, with the outcome given. */
function runAnswering(outcome: ExecutionResult<unknown>) {
  return vi.fn(() => outcome);
}

describe('an arrangement the dock reports', () => {
  it('puts the dock back when the command refuses what it drew', () => {
    const remount = vi.fn();
    const run = runAnswering(refusal('workspace.rearrange.refused', 'Nothing docked.'));

    dockRearrangement(run, remount)({ groups: [] });

    expect(run).toHaveBeenCalledWith(commandId('workspace.rearrange'), {
      arrangement: JSON.stringify({ groups: [] }),
    });
    expect(remount).toHaveBeenCalledOnce();
  });

  it('leaves the dock alone when the arrangement is taken, or changes nothing', () => {
    const remount = vi.fn();

    dockRearrangement(runAnswering({ kind: 'applied', next: {} }), remount)({ groups: [] });
    dockRearrangement(
      runAnswering(
        unchanged('panels.already-arranged', 'The panels are already arranged that way.'),
      ),
      remount,
    )({ groups: [] });

    expect(remount).not.toHaveBeenCalled();
  });
});
