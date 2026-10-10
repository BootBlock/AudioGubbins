import { describe, expect, it } from 'vitest';

import { searchCommands } from '@audiogubbins/commands';

import {
  instantiateProcessor,
  processorsOf,
  type Asset,
  type EffectChain,
  type ParameterId,
  type ParameterValue,
  type ProcessorInstance,
  type Region,
} from '@audiogubbins/domain';
import { PROCESSOR_CATALOGUE } from '@audiogubbins/processors';
import { setProcessorInvocation, setRackInvocation } from '@audiogubbins/project-commands';
import type { ListedEntry } from '@audiogubbins/storage';
import { sine, type SignalFixture } from '@audiogubbins/test-fixtures';

import { holdPlatformFiles, windowWithAudio, type AudioWindow } from '../testing/project-audio.js';
import { DESCRIPTORS } from '../testing/shell-context.js';
import { projectWorld } from '../testing/project-context.js';
import { shellCommands } from './shell-commands.js';

holdPlatformFiles();

/** A second of a mono tone, which three regions are made in. */
const TONE: SignalFixture = sine(440, { length: 48_000 });

const REGIONS = [
  { name: 'First', start: 0, end: 12_000 },
  { name: 'Second', start: 12_000, end: 24_000 },
  { name: 'Third', start: 24_000, end: 36_000 },
] as const;

function processor(audio: AudioWindow, typeKey: string): ProcessorInstance {
  const descriptor = PROCESSOR_CATALOGUE.get(typeKey);
  if (descriptor === undefined) throw new Error(`The build has no ${typeKey}.`);
  return instantiateProcessor(audio.window.context.ids.next<'ProcessorId'>(), descriptor);
}

function stateOf(audio: AudioWindow) {
  return audio.session.getSnapshot().model;
}

function assetOf(audio: AudioWindow): Asset {
  const asset = stateOf(audio).state.project.assets.get(audio.assetId);
  if (asset === undefined) throw new Error('The asset is in the project.');
  return asset;
}

function regionsOf(audio: AudioWindow): readonly Region[] {
  return [...stateOf(audio).state.project.regions.values()];
}

function chainsOf(audio: AudioWindow): readonly EffectChain[] {
  return [...stateOf(audio).state.project.effectChains.values()];
}

function typesOf(chain: EffectChain | undefined): readonly string[] {
  return chain === undefined ? [] : [...processorsOf(chain.slots)].map((one) => one.typeKey);
}

/** The tone with three regions, open in an editor, its asset racked with a gain then a compressor. */
async function racked(): Promise<{ audio: AudioWindow; rack: EffectChain }> {
  const audio = await windowWithAudio({ fixture: TONE, name: 'Tone', regions: REGIONS });
  const { context } = audio.window;
  context.editorViews.open('editor', audio.asset());
  context.editorViews.measured('editor', { width: 1000, height: 300 }, audio.asset().length);
  context.editorViews.focus('editor');
  const rack: EffectChain = {
    id: context.ids.next<'EffectChainId'>(),
    slots: [{ ...processor(audio, 'gain'), mix: 0.5 }, processor(audio, 'compressor')],
  };
  const changed = audio.changed(audio.asset());
  await audio.session.run(setRackInvocation({ kind: 'asset', asset: assetOf(audio) }, rack));
  await changed;
  return { audio, rack };
}

/** The only entry the window's library lists. */
function onlyEntry(audio: AudioWindow): ListedEntry & { readonly kind: 'usable' } {
  const [listed, ...rest] = audio.window.projects.savedProcessing.get().entries;
  if (listed?.kind !== 'usable' || rest.length > 0) throw new Error('Expected one usable entry.');
  return listed;
}

/** Saves the asset's rack as "Warm vocal" and gives its identifier. */
async function savedRack(audio: AudioWindow): Promise<string> {
  const said = await audio.window.runAndHear('library.save-chain', { name: 'Warm vocal' });
  expect(said).toBe('Saved the chain “Warm vocal” to your library.');
  return onlyEntry(audio).entry.id;
}

function targetsOf(regions: readonly Region[]): string {
  return regions.map((region) => `region:${region.id}`).join(',');
}

// Each test imports a second of audio and runs its storage worker in the
// test's own thread, which takes seconds under the whole suite's load.
describe('the library of saved chains and presets (ADR-0060)', { timeout: 30_000 }, () => {
  it('applies a saved chain to three regions as one step, a copy each, which one undo takes off all three', async () => {
    const { audio, rack } = await racked();
    const entry = await savedRack(audio);
    const regions = regionsOf(audio);
    const before = stateOf(audio).history.cursor;

    const said = await audio.window.runAndHear('library.apply-chain', {
      entry,
      targets: targetsOf(regions),
    });

    expect(said).toBe('Applied “Warm vocal” to 3 targets.');
    const { history } = stateOf(audio);
    const step = history.nodes.get(history.cursor);
    expect(step?.kind === 'change' ? [step.parent, step.description] : []).toEqual([
      before,
      'Apply the saved chain “Warm vocal”',
    ]);
    const racks = regionsOf(audio).map((region) => region.rack);
    expect(new Set(racks).size).toBe(3);
    for (const id of racks) {
      const chain = chainsOf(audio).find((one) => one.id === id);
      expect(typesOf(chain)).toEqual(['gain', 'compressor']);
      expect(chain?.slots[0]?.mix).toBe(0.5);
      expect(id).not.toBe(rack.id);
    }

    await audio.window.runAndHear('edit.undo');

    expect(stateOf(audio).history.cursor).toBe(before);
    expect(regionsOf(audio).map((region) => region.rack)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(chainsOf(audio).map((chain) => chain.id)).toEqual([rack.id]);
  });

  it('gives every target one shared chain where asked to share', async () => {
    const { audio } = await racked();
    const entry = await savedRack(audio);

    const said = await audio.window.runAndHear('library.apply-chain', {
      entry,
      targets: targetsOf(regionsOf(audio)),
      share: true,
    });

    expect(said).toBe('Applied “Warm vocal” to 3 targets, one chain shared.');
    const racks = new Set(regionsOf(audio).map((region) => region.rack));
    expect(racks.size).toBe(1);
    expect(chainsOf(audio)).toHaveLength(2);
  });

  it('replaces a rack a target had, removing it where nothing else names it', async () => {
    const { audio, rack } = await racked();
    const entry = await savedRack(audio);
    const [first] = regionsOf(audio);
    if (first === undefined) throw new Error('The asset has regions.');
    const own: EffectChain = {
      id: audio.window.context.ids.next<'EffectChainId'>(),
      slots: [processor(audio, 'gain')],
    };
    await audio.session.run(
      setRackInvocation({ kind: 'region', region: first, asset: assetOf(audio) }, own),
    );

    await audio.window.runAndHear('library.apply-chain', { entry, targets: `region:${first.id}` });

    const chains = chainsOf(audio).map((chain) => chain.id);
    expect(chains).not.toContain(own.id);
    expect(chains).toContain(rack.id);
    await audio.window.runAndHear('edit.undo');
    expect(regionsOf(audio)[0]?.rack).toBe(own.id);
  });

  it('processes a selected range with a copy of the saved chain, as a rack edit', async () => {
    const { audio } = await racked();
    const entry = await savedRack(audio);
    const range = { start: 6_000, end: 30_000 };
    audio.window.run('editor.select-time', range);

    const said = await audio.window.runAndHear('library.apply-chain', { entry });

    expect(said).toBe('Applied “Warm vocal” to a range of Tone.');
    const edits = stateOf(audio).state.project.assets.get(audio.assetId)?.edits ?? [];
    expect(edits).toEqual([
      expect.objectContaining({
        kind: 'process',
        range,
        edit: expect.objectContaining({ kind: 'rack' }),
      }),
    ]);
  });

  it('applies a preset to another processor as one command, its place kept, one undo restoring it', async () => {
    const { audio, rack } = await racked();
    const [gain] = rack.slots;
    if (gain?.kind !== 'processor') throw new Error('The rack starts with a gain.');
    const [level] = PROCESSOR_CATALOGUE.get('gain')?.parameters ?? [];
    if (level === undefined) throw new Error('A gain has a level.');
    const louder = { ...gain, values: new Map<ParameterId, ParameterValue>([[level.id, 6]]) };
    await audio.session.run(setProcessorInvocation(louder));
    const saved = await audio.window.runAndHear('library.save-preset', {
      name: 'Six up',
      processorId: gain.id,
    });
    expect(saved).toBe('Saved the preset “Six up” to your library.');
    // The rack replaced goes with it, as nothing else names its chain.
    const other = { ...processor(audio, 'gain'), enabled: false };
    const second: EffectChain = {
      id: audio.window.context.ids.next<'EffectChainId'>(),
      slots: [other],
    };
    await audio.session.run(setRackInvocation({ kind: 'asset', asset: assetOf(audio) }, second));
    const before = stateOf(audio).history.cursor;

    const said = await audio.window.runAndHear('library.apply-preset', {
      entry: onlyEntry(audio).entry.id,
      processorId: other.id,
    });

    expect(said).toBe('Applied the preset “Six up”.');
    const set = chainsOf(audio).find((chain) => chain.id === second.id)?.slots[0];
    expect(set).toEqual({ ...other, values: louder.values });
    const { history } = stateOf(audio);
    const step = history.nodes.get(history.cursor);
    expect(step?.kind === 'change' ? [step.parent, step.description] : []).toEqual([
      before,
      'Apply the preset “Six up”',
    ]);
    await audio.window.runAndHear('edit.undo');
    expect(chainsOf(audio).find((chain) => chain.id === second.id)?.slots[0]).toEqual(other);
  });

  it('refuses to apply a preset as a chain, saying what it is', async () => {
    const { audio, rack } = await racked();
    const [gain] = rack.slots;
    if (gain === undefined) throw new Error('The rack has a gain.');
    await audio.window.runAndHear('library.save-preset', { name: 'Flat', processorId: gain.id });

    const said = await audio.window.runAndHear('library.apply-chain', {
      entry: onlyEntry(audio).entry.id,
    });

    expect(said).toBe('“Flat” is not a chain.');
    expect(chainsOf(audio)).toEqual([rack]);
  });

  it('refuses each change of the library run a second time, where it would change nothing', async () => {
    const { audio, rack } = await racked();
    const [gain] = rack.slots;
    if (gain === undefined) throw new Error('The rack has a gain.');
    const { window } = audio;
    const twice = async (id: string, args: Readonly<Record<string, string>>) => {
      await window.runAndHear(id, args);
      return await window.runAndHear(id, args);
    };

    expect(await twice('library.save-chain', { name: 'Warm vocal' })).toBe(
      'A chain is already saved as “Warm vocal”: replace it, or choose another name.',
    );
    expect(await twice('library.save-preset', { name: 'Flat', processorId: gain.id })).toBe(
      'A preset is already saved as “Flat”: replace it, or choose another name.',
    );
    const saved = window.projects.savedProcessing.get().entries;
    const entryOf = (kind: string) =>
      saved.find((listed) => listed.kind === 'usable' && listed.entry.content.kind === kind)?.entry;
    const chainEntry = entryOf('chain');
    const presetEntry = entryOf('preset');
    if (chainEntry === undefined || presetEntry === undefined) throw new Error('Two entries.');
    expect(await twice('library.rename', { entry: chainEntry.id, name: 'Warmer' })).toBe(
      'It is already called “Warmer”.',
    );
    expect(
      await twice('library.apply-preset', { entry: presetEntry.id, processorId: gain.id }),
    ).toBe('No command in the group changed anything.');
    expect(await twice('library.remove', { entry: chainEntry.id })).toBe(
      'The library has no such saved chain or preset.',
    );
  });

  it('offers every library command in the palette, and says there where an entry is chosen', async () => {
    const { audio } = await racked();
    const { context } = audio.window;
    const offered = searchCommands(shellCommands(DESCRIPTORS), 'library', {
      context,
      profile: context.shortcuts.get().profile,
      convention: context.convention,
      layout: context.keyboardLayout.get(),
    }).map((result) => String(result.command.id));

    expect(offered).toEqual(
      expect.arrayContaining([
        'library.save-chain',
        'library.save-preset',
        'library.rename',
        'library.remove',
        'library.apply-chain',
        'library.apply-preset',
      ]),
    );
    for (const id of ['library.apply-chain', 'library.apply-preset', 'library.remove']) {
      expect(audio.window.run(id)).toMatchObject({
        kind: 'refused',
        failures: [{ summary: 'Choose a saved chain or preset in the Library panel.' }],
      });
    }
  });

  it('keeps what was saved for another window of the profile, which lists it', async () => {
    const world = projectWorld();
    const audio = await windowWithAudio({ world, fixture: TONE, name: 'Tone', regions: REGIONS });
    const { context } = audio.window;
    context.editorViews.open('editor', audio.asset());
    context.editorViews.focus('editor');
    const rack: EffectChain = {
      id: context.ids.next<'EffectChainId'>(),
      slots: [processor(audio, 'gain')],
    };
    await audio.session.run(setRackInvocation({ kind: 'asset', asset: assetOf(audio) }, rack));
    await audio.window.runAndHear('library.save-chain', { name: 'Plain gain', chainId: rack.id });

    const other = await world.window();
    await other.projects.savedProcessing.refresh();

    expect(other.projects.savedProcessing.get().entries).toEqual([onlyEntry(audio)]);
  });
});
