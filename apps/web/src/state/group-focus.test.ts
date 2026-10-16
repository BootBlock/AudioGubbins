import { describe, expect, it } from 'vitest';

import { unsafeBrandId } from '@audiogubbins/domain';
import type { GameAssetGroupId } from '@audiogubbins/game-audio';
import { PanelKinds } from '@audiogubbins/workspace';

import { buildShellContext } from '../testing/shell-context.js';

const FOOTSTEPS: GameAssetGroupId = unsafeBrandId('group-footsteps');

describe('the asset group chosen (ADR-0101)', () => {
  it('is described while other panels are used, and gives the Inspector to an editor brought into use, staying chosen', () => {
    const { context } = buildShellContext();
    const { workspace, groups } = context;
    expect(workspace.openPanel(PanelKinds.Editor)).toBeUndefined();

    groups.choose(FOOTSTEPS);
    expect(workspace.openPanel(PanelKinds.AssetBrowser)).toBeUndefined();
    expect(groups.chosen.get()).toEqual({ group: FOOTSTEPS, inspected: true });

    expect(workspace.openPanel(PanelKinds.Editor)).toBeUndefined();
    expect(groups.chosen.get()).toEqual({ group: FOOTSTEPS, inspected: false });
  });

  it('gives the Inspector to recording claiming it, and to an export asked to be described', () => {
    const { context } = buildShellContext();
    const { workspace, groups, recording, exportFocus } = context;
    expect(workspace.openPanel(PanelKinds.Recording)).toBeUndefined();

    groups.choose(FOOTSTEPS);
    recording.inspect(undefined);
    expect(groups.chosen.get()?.inspected).toBe(false);

    groups.choose(FOOTSTEPS);
    exportFocus.inspect({ kind: 'batch' });
    expect(groups.chosen.get()?.inspected).toBe(false);
  });

  it('chooses nothing once forgotten, as a deleted group is', () => {
    const { context } = buildShellContext();
    context.groups.choose(FOOTSTEPS);

    context.groups.forget();

    expect(context.groups.chosen.get()).toBeUndefined();
  });
});
