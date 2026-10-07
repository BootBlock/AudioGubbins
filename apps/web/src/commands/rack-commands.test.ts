import { describe, expect, it } from 'vitest';

import type { CommandInvocation } from '@audiogubbins/commands';
import {
  instantiateProcessor,
  parameterOf,
  processorsOf,
  type Asset,
  type ChainSlot,
  type EffectChain,
  type ProcessorInstance,
  type Region,
} from '@audiogubbins/domain';
import { PROCESSOR_CATALOGUE } from '@audiogubbins/processors';
import { addChainInvocation, setRackInvocation } from '@audiogubbins/project-commands';
import { sine, type SignalFixture } from '@audiogubbins/test-fixtures';

import { followPlayingAsset } from '../audio/playing-asset.js';
import { holdPlatformFiles, windowWithAudio, type AudioWindow } from '../testing/project-audio.js';

holdPlatformFiles();

/** A second of a mono tone, which two regions are made in. */
const TONE: SignalFixture = sine(440, { length: 48_000 });

const REGIONS = [
  { name: 'First', start: 0, end: 12_000 },
  { name: 'Second', start: 12_000, end: 24_000 },
] as const;

function modelOf(audio: AudioWindow) {
  return audio.session.getSnapshot().model;
}

function assetOf(audio: AudioWindow): Asset {
  const asset = modelOf(audio).state.project.assets.get(audio.assetId);
  if (asset === undefined) throw new Error('The asset is in the project.');
  return asset;
}

function regionsOf(audio: AudioWindow): readonly Region[] {
  return [...modelOf(audio).state.project.regions.values()];
}

function chainOf(audio: AudioWindow, id: string | undefined): EffectChain | undefined {
  return [...modelOf(audio).state.project.effectChains.values()].find((one) => one.id === id);
}

function typesOf(chain: Pick<EffectChain, 'slots'> | undefined): readonly string[] {
  return chain === undefined ? [] : [...processorsOf(chain.slots)].map((one) => one.typeKey);
}

function processor(audio: AudioWindow, typeKey: string): ProcessorInstance {
  const descriptor = PROCESSOR_CATALOGUE.get(typeKey);
  if (descriptor === undefined) throw new Error(`The build has no ${typeKey}.`);
  return instantiateProcessor(audio.window.context.ids.next<'ProcessorId'>(), descriptor);
}

/** The tone with two regions, open in an editor in use. */
async function opened(): Promise<AudioWindow> {
  const audio = await windowWithAudio({ fixture: TONE, name: 'Tone', regions: REGIONS });
  const { context } = audio.window;
  context.editorViews.open('editor', audio.asset());
  context.editorViews.measured('editor', 1000, audio.asset().length);
  context.editorViews.focus('editor');
  return audio;
}

/** Gives the asset a rack of `slots`, outside the commands under test, and gives the rack. */
async function racked(audio: AudioWindow, slots: readonly ChainSlot[]): Promise<EffectChain> {
  const rack: EffectChain = { id: audio.window.context.ids.next<'EffectChainId'>(), slots };
  const changed = audio.changed(audio.asset());
  await audio.session.run(addChainInvocation(rack));
  await audio.session.run(setRackInvocation({ kind: 'asset', asset: assetOf(audio) }, rack.id));
  await changed;
  return rack;
}

/** The step the history is at: its parent and what it is called. */
function latestStep(audio: AudioWindow): readonly unknown[] {
  const { history } = modelOf(audio);
  const step = history.nodes.get(history.cursor);
  return step?.kind === 'change' ? [step.parent, step.description] : [];
}

/** Why the window refuses `id` with `args`. */
function refusal(audio: AudioWindow, id: string, args?: CommandInvocation['arguments']): string {
  const ran = audio.window.run(id, args);
  return ran.kind === 'refused' ? ran.failures[0].summary : `not refused: ${ran.kind}`;
}

// Each test imports a second of audio and runs its storage worker in the
// test's own thread, which takes seconds under the whole suite's load.
describe('the rack commands (ADR-0060)', { timeout: 30_000 }, () => {
  it('gives an asset with no rack one, with a processor at its defaults, as one step one undo takes away', async () => {
    const audio = await opened();
    const before = modelOf(audio).history.cursor;

    const said = await audio.window.runAndHear('rack.add-processor', { typeKey: 'compressor' });

    expect(said).toBe('Gave “Tone” a rack, with “Compressor” in it.');
    const rack = chainOf(audio, assetOf(audio).rack);
    expect(typesOf(rack)).toEqual(['compressor']);
    expect(latestStep(audio)).toEqual([before, 'Give “Tone” a rack']);
    await audio.window.runAndHear('edit.undo');
    expect(assetOf(audio).rack).toBeUndefined();
    expect(modelOf(audio).state.project.effectChains.size).toBe(0);
  });

  it('adds a processor into a branch of a parallel group, at the place named', async () => {
    const audio = await opened();
    await audio.window.runAndHear('rack.add-processor', { typeKey: 'gain' });
    await audio.window.runAndHear('rack.add-group', {});
    const group = chainOf(audio, assetOf(audio).rack)?.slots[1];
    if (group?.kind !== 'group') throw new Error('The rack has a group second.');

    await audio.window.runAndHear('rack.add-processor', {
      typeKey: 'reverb',
      group: group.id,
      branch: 1,
      index: 0,
    });

    const placed = chainOf(audio, assetOf(audio).rack)?.slots[1];
    expect(placed?.kind === 'group' ? placed.branches.map((one) => typesOf(one)) : []).toEqual([
      [],
      ['reverb'],
    ]);
    expect(placed?.kind === 'group' ? placed.summing : undefined).toBe('mean');
    expect(
      refusal(audio, 'rack.add-processor', { typeKey: 'gain', group: group.id, branch: 2 }),
    ).toBe('The rack has no such group or branch.');
  });

  it('processes the selected range with a new chain as a rack edit, one step', async () => {
    const audio = await opened();
    const before = modelOf(audio).history.cursor;
    audio.window.run('editor.select-time', { start: 6_000, end: 30_000 });

    const said = await audio.window.runAndHear('rack.add-processor', {
      typeKey: 'parametric-equaliser',
      place: 'selection',
    });

    expect(said).toBe(
      'Added “Parametric equaliser” over the selection of Tone, in a chain of its own.',
    );
    const [edit] = assetOf(audio).edits;
    expect(edit).toMatchObject({ kind: 'process', range: { start: 6_000, end: 30_000 } });
    expect(
      typesOf(
        chainOf(
          audio,
          edit?.kind === 'process' && edit.edit.kind === 'rack' ? edit.edit.chain : undefined,
        ),
      ),
    ).toEqual(['parametric-equaliser']);
    expect(assetOf(audio).rack).toBeUndefined();
    expect(latestStep(audio)[0]).toBe(before);
  });

  it('refuses each with a reason a person can read', async () => {
    const audio = await opened();

    expect(refusal(audio, 'rack.add-processor', { typeKey: 'flanger' })).toBe(
      'Choose a processor this version has.',
    );
    expect(refusal(audio, 'rack.add-processor', { typeKey: 'gain', place: 'selection' })).toBe(
      'Nothing is selected; select a time range first.',
    );
    expect(refusal(audio, 'rack.remove-rack')).toBe('“Tone” has no rack to take away.');
    expect(refusal(audio, 'rack.compare-before-change')).toBe('“Tone” has no rack to compare.');
    expect(refusal(audio, 'rack.set-enabled')).toBe(
      'Select a processor in the rack, or name one, first.',
    );
    await racked(audio, [processor(audio, 'gain')]);
    expect(refusal(audio, 'rack.make-independent')).toBe(
      'The chain is “Tone”’s alone already; nothing else uses it.',
    );
    expect(refusal(audio, 'rack.paste')).toBe(
      'Nothing is copied. Copy processors from a rack first.',
    );
  });

  it('sets a parameter, refusing a value outside its range with the range, never clamping it', async () => {
    const audio = await opened();
    const gain = processor(audio, 'gain');
    await racked(audio, [gain]);
    const level = parameterOf(PROCESSOR_CATALOGUE.get('gain') ?? { parameters: [] }, 'gain');
    if (level?.kind !== 'numeric') throw new Error('A gain has a numeric gain.');

    expect(
      refusal(audio, 'rack.set-parameter', { processorId: gain.id, key: 'gain', value: 99 }),
    ).toMatch(/^Gain is from −\d+ dB to \d+ dB; 99 dB is outside it\.$/u);
    const said = await audio.window.runAndHear('rack.set-parameter', {
      processorId: gain.id,
      key: 'gain',
      value: -6,
    });

    expect(said).toBe('Gain of “Gain” set to −6 dB.');
    const set = chainOf(audio, assetOf(audio).rack)?.slots[0];
    expect(set?.kind === 'processor' ? set.values.get(level.id) : undefined).toBe(-6);
    await audio.window.runAndHear('rack.reset-parameter', { processorId: gain.id, key: 'gain' });
    const reset = chainOf(audio, assetOf(audio).rack)?.slots[0];
    expect(reset?.kind === 'processor' ? reset.values.get(level.id) : undefined).toBe(
      level.defaultValue,
    );
  });

  it('changes a chain two regions share for both in one step, which one undo restores for both', async () => {
    const audio = await opened();
    const gain = processor(audio, 'gain');
    const shared: EffectChain = {
      id: audio.window.context.ids.next<'EffectChainId'>(),
      slots: [gain],
    };
    await audio.session.run(addChainInvocation(shared));
    for (const region of regionsOf(audio)) {
      await audio.session.run(
        setRackInvocation({ kind: 'region', region, asset: assetOf(audio) }, shared.id),
      );
    }
    const before = modelOf(audio).history.cursor;
    audio.window.run('editor.select-processor', { processorId: gain.id });

    const said = await audio.window.runAndHear('rack.set-enabled', { enabled: false });

    expect(said).toBe('Bypassed “Gain”.');
    expect(
      regionsOf(audio).map((region) => chainOf(audio, region.rack)?.slots[0]?.enabled),
    ).toEqual([false, false]);
    expect(latestStep(audio)[0]).toBe(before);
    await audio.window.runAndHear('edit.undo');
    expect(
      regionsOf(audio).map((region) => chainOf(audio, region.rack)?.slots[0]?.enabled),
    ).toEqual([true, true]);
  });

  it('shows the rack of the region whose processor is selected, and makes its shared chain its own', async () => {
    const audio = await opened();
    const gain = processor(audio, 'gain');
    const shared: EffectChain = {
      id: audio.window.context.ids.next<'EffectChainId'>(),
      slots: [gain],
    };
    await audio.session.run(addChainInvocation(shared));
    for (const region of regionsOf(audio)) {
      await audio.session.run(
        setRackInvocation({ kind: 'region', region, asset: assetOf(audio) }, shared.id),
      );
    }
    audio.window.run('editor.select-processor', { processorId: gain.id });

    const said = await audio.window.runAndHear('rack.make-independent');

    expect(said).toBe(
      '“First” has a chain of its own now, a copy; 1 other use keep the shared one.',
    );
    const [first, second] = regionsOf(audio);
    expect(first?.rack).not.toBe(shared.id);
    expect(typesOf(chainOf(audio, first?.rack))).toEqual(['gain']);
    expect(chainOf(audio, first?.rack)?.slots[0]?.id).not.toBe(gain.id);
    expect(second?.rack).toBe(shared.id);
    await audio.window.runAndHear('edit.undo');
    expect(regionsOf(audio).map((region) => region.rack)).toEqual([shared.id, shared.id]);
  });

  it('moves, bypasses and removes the selected processor, each one step', async () => {
    const audio = await opened();
    const [gain, compressor, limiter] = [
      processor(audio, 'gain'),
      processor(audio, 'compressor'),
      processor(audio, 'limiter'),
    ];
    const rack = await racked(audio, [gain, compressor, limiter]);
    audio.window.run('editor.select-processor', { processorId: limiter.id });

    expect(await audio.window.runAndHear('rack.move-processor', { direction: 'up' })).toBe(
      'Moved “Limiter” to place 2 of 3.',
    );
    expect(typesOf(chainOf(audio, rack.id))).toEqual(['gain', 'limiter', 'compressor']);
    await audio.window.runAndHear('rack.move-processor', { direction: 'up' });
    expect(refusal(audio, 'rack.move-processor', { direction: 'up' })).toBe(
      '“Limiter” is first in its list already.',
    );
    await audio.window.runAndHear('rack.remove-processor');
    expect(typesOf(chainOf(audio, rack.id))).toEqual(['gain', 'compressor']);
    expect(audio.window.context.selections.of(audio.entry).objects).toBeUndefined();
  });

  it('pastes copied processors as copies with new identifiers, after the one selected', async () => {
    const audio = await opened();
    const [gain, compressor] = [processor(audio, 'gain'), processor(audio, 'compressor')];
    const rack = await racked(audio, [gain, compressor]);
    audio.window.run('editor.select-processor', { processorId: gain.id });
    audio.window.run('rack.copy');

    await audio.window.runAndHear('rack.paste');
    await audio.window.runAndHear('rack.paste');

    const slots = chainOf(audio, rack.id)?.slots ?? [];
    expect(slots.map((slot) => (slot.kind === 'processor' ? slot.typeKey : 'group'))).toEqual([
      'gain',
      'gain',
      'gain',
      'compressor',
    ]);
    expect(new Set(slots.map((slot) => slot.id)).size).toBe(4);
  });

  it('takes a rack away, its chain kept only where something else names it', async () => {
    const audio = await opened();
    const rack = await racked(audio, [processor(audio, 'gain')]);

    expect(await audio.window.runAndHear('rack.remove-rack')).toBe('Took away the rack of “Tone”.');
    expect(chainOf(audio, rack.id)).toBeUndefined();
    await audio.window.runAndHear('edit.undo');
    expect(assetOf(audio).rack).toBe(rack.id);
  });

  it('compares the project with the state before the latest change to the rack’s chain', async () => {
    const audio = await opened();
    const gain = processor(audio, 'gain');
    await racked(audio, [gain]);
    await audio.window.runAndHear('rack.set-parameter', {
      processorId: gain.id,
      key: 'gain',
      value: -3,
    });
    const { history } = modelOf(audio);
    const changed = history.nodes.get(history.cursor);
    // An edit since that leaves the chain alone is passed over.
    await audio.window.runAndHear('editor.add-marker');

    await audio.window.runAndHear('rack.compare-before-change');

    const comparison = modelOf(audio).comparison;
    expect([comparison?.a.node, comparison?.b.node, comparison?.listening]).toEqual([
      modelOf(audio).history.cursor,
      changed?.kind === 'change' ? changed.parent : 'a change',
      'a',
    ]);
  });

  it('finds nothing to do, or refuses, run a second time where it would change nothing', async () => {
    const audio = await opened();
    const { window } = audio;
    const group = {
      kind: 'group',
      id: window.context.ids.next<'ProcessorGroupId'>(),
      enabled: true,
      soloed: false,
      mix: 1,
      summing: 'sum',
      branches: [{ slots: [] }, { slots: [] }],
    } as const;
    const gain = processor(audio, 'gain');
    const rack = await racked(audio, [gain, group]);
    window.run('editor.select-processor', { processorId: gain.id });
    const twice = async (id: string, args?: CommandInvocation['arguments']): Promise<string> => {
      await window.runAndHear(id, args);
      const again = window.run(id, args);
      return again.kind === 'applied' ? 'applied again' : again.kind;
    };
    const selected = { slot: gain.id };

    expect(await twice('rack.set-enabled', { ...selected, enabled: false })).toBe('unchanged');
    expect(await twice('rack.set-soloed', { ...selected, soloed: true })).toBe('unchanged');
    expect(await twice('rack.set-mix', { ...selected, mix: 0.25 })).toBe('unchanged');
    expect(await twice('rack.set-group-law', { slot: group.id, law: 'mean' })).toBe('unchanged');
    const value = { processorId: gain.id, key: 'gain', value: -2 };
    expect(await twice('rack.set-parameter', value)).toBe('unchanged');
    expect(await twice('rack.reset-parameter', { processorId: gain.id, key: 'gain' })).toBe(
      'unchanged',
    );
    expect(await twice('rack.copy')).toBe('unchanged');
    expect(await twice('rack.compare-before-change')).toBe('unchanged');
    await window.runAndHear('history.close-comparison');
    expect(window.run('editor.select-processor', { processorId: gain.id }).kind).toBe('unchanged');
    // A selection says nothing as it changes: the editor's selection scope shows it.
    expect(window.run('editor.deselect-processors').kind).toBe('applied');
    expect(window.run('editor.deselect-processors').kind).toBe('refused');
    expect(await twice('transport.listen-original')).toBe('unchanged');
    expect(await twice('rack.remove-processor', selected)).toBe('refused');
    expect(await twice('rack.remove-rack')).toBe('refused');
    expect(chainOf(audio, rack.id)).toBeUndefined();
  });

  it('hears the asset as its original from where it plays, every chain bypassed, and processed again', async () => {
    const audio = await opened();
    const { context } = audio.window;
    followPlayingAsset(context.assets, context.hearing, context.playback);
    audio.window.run('editor.select-time', { start: 0, end: 24_000 });
    await audio.window.runAndHear('rack.add-processor', { typeKey: 'gain', place: 'selection' });
    audio.window.run('editor.clear-selection');
    await audio.window.runAndHear('rack.add-processor', { typeKey: 'compressor' });
    await audio.window.runAndHear('transport.play');
    const [opened_] = audio.window.audio.playback.opened;
    if (opened_ === undefined) throw new Error('Playback opened a session.');
    const { session } = opened_;
    session.contextFrame = 9_600;
    const loads = session.loads.length;

    await audio.window.runAndHear('transport.listen-original');

    await expect.poll(() => session.loads.length).toBe(loads + 1);
    const heard = session.loads.at(-1)?.sources[0];
    const plan = heard !== undefined && 'plan' in heard ? heard.plan : undefined;
    expect(plan?.streams.some((stream) => stream.processing !== undefined)).toBe(false);
    expect(plan).toEqual(audio.asset().original?.plan);
    expect(session.seeks.at(-1)).toBe(9_600);

    await audio.window.runAndHear('transport.listen-processed');
    await expect.poll(() => session.loads.length).toBe(loads + 2);
    const again = session.loads.at(-1)?.sources[0];
    const { owner } = audio.asset();
    expect(again !== undefined && 'plan' in again ? again.plan : undefined).toEqual(
      owner.kind === 'project' ? owner.plan : undefined,
    );
  });
});
