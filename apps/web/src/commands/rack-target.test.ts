import { describe, expect, it } from 'vitest';

import { instantiateProcessor, type EffectChain, type Region } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import type { GameAssetGroup } from '@audiogubbins/game-audio';
import { PROCESSOR_CATALOGUE } from '@audiogubbins/processors';
import {
  addGroupInvocation,
  assignMemberInvocation,
  setRackInvocation,
} from '@audiogubbins/project-commands';
import { sine } from '@audiogubbins/test-fixtures';

import { holdPlatformFiles, windowWithAudio, type AudioWindow } from '../testing/project-audio.js';
import { otherUsers } from './rack-target.js';

holdPlatformFiles();

function stateOf(audio: AudioWindow) {
  return audio.session.getSnapshot().model.state;
}

function regionOf(audio: AudioWindow): Region {
  const [region] = stateOf(audio).project.regions.values();
  if (region === undefined) throw new Error('The asset has a region.');
  return region;
}

/** The tone with one region, open in the editor in use, its asset racked with a gain. */
async function racked(): Promise<{ readonly audio: AudioWindow; readonly chain: EffectChain }> {
  const audio = await windowWithAudio({
    fixture: sine(440, { length: 48_000 }),
    name: 'Tone',
    regions: [{ name: 'Step', start: 0, end: 12_000 }],
  });
  const { context } = audio.window;
  context.editorViews.open('editor', audio.asset());
  context.editorViews.measured('editor', { width: 1000, height: 300 }, audio.asset().length);
  context.editorViews.focus('editor');
  const gain = PROCESSOR_CATALOGUE.get('gain');
  if (gain === undefined) throw new Error('The build has a gain.');
  const chain: EffectChain = {
    id: context.ids.next<'EffectChainId'>(),
    slots: [instantiateProcessor(context.ids.next<'ProcessorId'>(), gain)],
  };
  const asset = stateOf(audio).project.assets.get(audio.assetId);
  if (asset === undefined) throw new Error('The asset is in the project.');
  expectSuccess(await audio.session.run(setRackInvocation({ kind: 'asset', asset }, chain)));
  return { audio, chain };
}

/** Adds the group "Footsteps", whose processing is `chain`. */
async function footsteps(audio: AudioWindow, chain: EffectChain): Promise<GameAssetGroup> {
  const group: GameAssetGroup = {
    id: audio.window.context.ids.next<'GameAssetGroupId'>(),
    name: 'Footsteps',
    policy: { processing: chain.id },
  };
  expectSuccess(await audio.session.run(addGroupInvocation(group)));
  return group;
}

describe("a rack's other users (ADR-0101)", { timeout: 30_000 }, () => {
  it("names a group whose processing is the chain, so a group's chain is said to be shared", async () => {
    const { audio, chain } = await racked();
    const asset = stateOf(audio).project.assets.get(audio.assetId);
    if (asset === undefined) throw new Error('The asset is in the project.');
    expect(otherUsers(stateOf(audio), chain.id, { kind: 'asset', asset })).toEqual([]);

    await footsteps(audio, chain);

    expect(otherUsers(stateOf(audio), chain.id, { kind: 'asset', asset })).toEqual([
      'the processing of the group “Footsteps”',
    ]);
  });

  it('keeps a chain a group names when a rack is taken away, and says the member owns its processing now', async () => {
    const { audio, chain } = await racked();
    const group = await footsteps(audio, chain);
    const region = regionOf(audio);
    expectSuccess(
      await audio.session.run(
        assignMemberInvocation({ kind: 'region', region: region.id }, group.id, 'inherit'),
      ),
    );
    expect(regionOf(audio).rack).toBe(chain.id);

    const said = await audio.window.runAndHear('rack.remove-rack', {
      target: `region:${region.id}`,
    });

    expect(said).toBe(
      'Took away the rack of “Step”. Its chain is kept, as other things use it. It has processing of its own now, so the processing of the group “Footsteps” no longer reaches it; reset its processing to inherited to follow the group again.',
    );
    const state = stateOf(audio);
    expect(state.project.effectChains.has(chain.id)).toBe(true);
    expect(state.gameAudio?.memberships.map((one) => one.processing)).toEqual(['own']);
  });
});
