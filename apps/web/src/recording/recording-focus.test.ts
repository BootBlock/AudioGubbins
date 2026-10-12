import { describe, expect, it } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';
import { activePanelOf, PanelKinds } from '@audiogubbins/workspace';

import { buildShellContext } from '../testing/shell-context.js';
import { everythingQueued } from '../testing/waiting.js';

/** The panel in use in the context's workspace, which a test needs to be one. */
function activeId(context: ReturnType<typeof buildShellContext>['context']): string {
  const panel = activePanelOf(context.workspace.get().layout);
  if (panel === undefined) throw new Error('No panel is in use.');
  return panel.id;
}

describe("recording's claim on the Inspector (REQ-EDIT-072)", () => {
  it('counts each time a Recording panel is brought into use, and only then', () => {
    const { context } = buildShellContext();
    const { recording, workspace } = context;
    const before = recording.claimed.get();

    expect(workspace.openPanel(PanelKinds.Recording)).toBeUndefined();
    expect(recording.focus.get()).toBe(true);
    expect(recording.claimed.get()).toBe(before + 1);

    // A change of the workspace that brings no other panel into use is no claim.
    expect(workspace.resizeGroup(activeId(context), 1)).toBeUndefined();
    expect(recording.claimed.get()).toBe(before + 1);

    expect(workspace.openPanel(PanelKinds.Editor)).toBeUndefined();
    expect(recording.focus.get()).toBe(false);
    expect(workspace.openPanel(PanelKinds.Recording)).toBeUndefined();
    expect(recording.claimed.get()).toBe(before + 2);
  });

  it('counts a take or the configuration inspected while recording is the subject already', () => {
    const { context } = buildShellContext();
    const { recording, workspace } = context;
    expect(workspace.openPanel(PanelKinds.Recording)).toBeUndefined();
    const claimed = recording.claimed.get();

    recording.inspect(undefined);
    recording.inspect(undefined);

    expect(recording.focus.get()).toBe(true);
    expect(recording.claimed.get()).toBe(claimed + 2);
  });

  it('counts an input armed, wherever it was armed from', async () => {
    const { context } = buildShellContext();
    const { recording } = context;
    const claimed = recording.claimed.get();

    expectSuccess(
      recording.input.arm({ purpose: { kind: 'new-stack' }, holdsWriteLease: () => true }),
    );
    await everythingQueued();

    expect(recording.focus.get()).toBe(true);
    expect(recording.claimed.get()).toBe(claimed + 1);
  });
});
