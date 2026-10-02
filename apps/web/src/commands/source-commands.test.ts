import { describe, expect, it } from 'vitest';

import type { AssetId } from '@audiogubbins/domain';

import { addLinkedAsset, linkedFile } from '../testing/linked-assets.js';
import { projectWorld, type ProjectWindow } from '../testing/project-context.js';

/** A window whose open project links one asset, keeping no copy of its file. */
async function withLinkedAsset(): Promise<{
  readonly window: ProjectWindow;
  readonly asset: AssetId;
}> {
  const window = await projectWorld().window();
  await window.runAndHear('file.create-project', { name: 'Harbour' });
  const asset = await addLinkedAsset(window, linkedFile('kick.wav', 'kept-1'), { name: 'Kick' });
  return { window, asset };
}

/** The policy the open project's asset has. */
function policyOf(window: ProjectWindow, asset: AssetId): string | undefined {
  const open = window.projects.project.get();
  const media =
    open.kind === 'open' ? open.snapshot.model.state.sources.get(asset)?.media : undefined;
  return media?.kind === 'external' ? media.policy : undefined;
}

describe('what a linked asset does when its file changes', () => {
  it('is set for one asset by command, as a change undo reverses', async () => {
    const { window, asset } = await withLinkedAsset();

    expect(await window.runAndHear('source.set-policy', { asset, policy: 'adopt' })).toBe(
      'The new version is used the next time its file changes.',
    );
    expect(policyOf(window, asset)).toBe('adopt');
    await window.runAndHear('edit.undo');
    expect(policyOf(window, asset)).toBe('prompt');
  });

  it('refuses to keep the version the project used where no copy of it is kept', async () => {
    const { window, asset } = await withLinkedAsset();

    expect(await window.runAndHear('source.set-policy', { asset, policy: 'freeze' })).toBe(
      '“Kick” has no retained copy of its file, so there is no version to keep playing.',
    );
    expect(policyOf(window, asset)).toBe('prompt');
    expect(window.run('source.set-policy', { asset, policy: 'sometimes' }).kind).toBe('refused');
  });
});
