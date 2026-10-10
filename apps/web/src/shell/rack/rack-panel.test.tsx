import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { CommandInvocation } from '@audiogubbins/commands';
import {
  SummingLaw,
  derivedSampleCount,
  instantiateProcessor,
  parameterAtPosition,
  type ChainSlot,
  type EffectChain,
  type ProcessorInstance,
} from '@audiogubbins/domain';
import { PROCESSOR_CATALOGUE } from '@audiogubbins/processors';
import {
  rackRangeInvocation,
  removeSlotsInvocations,
  setRackInvocation,
} from '@audiogubbins/project-commands';

import type { ModelGate } from '../../assets/model-gate.js';
import type { VoicedOptions } from '../../commands/voiced-execution.js';
import { observable } from '../../state/observable.js';
import {
  holdPlatformFiles,
  windowWithAudio,
  type AudioWindow,
} from '../../testing/project-audio.js';
import { RackPanel } from './rack-panel.js';

holdPlatformFiles();

const at = derivedSampleCount;

type Ran = (readonly [string, CommandInvocation['arguments']])[];

/** The commands a control asked to be spoken of other than as usual, and how. */
type Voiced = (readonly [string, VoicedOptions])[];

function processor(audio: AudioWindow, typeKey: string): ProcessorInstance {
  const descriptor = PROCESSOR_CATALOGUE.get(typeKey);
  if (descriptor === undefined) throw new Error(`The build has no ${typeKey}.`);
  return instantiateProcessor(audio.window.context.ids.next<'ProcessorId'>(), descriptor);
}

/** The loop in the editor in use, its asset racked with `slots` outside the panel. */
async function racked(
  make: (audio: AudioWindow) => readonly ChainSlot[],
): Promise<{ audio: AudioWindow; rack: EffectChain }> {
  const audio = await windowWithAudio({ regions: [{ name: 'Intro', start: 0, end: 48_000 }] });
  const { context } = audio.window;
  context.editorViews.open('editor', audio.asset());
  context.editorViews.focus('editor');
  const rack: EffectChain = { id: context.ids.next<'EffectChainId'>(), slots: make(audio) };
  const asset = audio.session.getSnapshot().model.state.project.assets.get(audio.assetId);
  if (asset === undefined) throw new Error('The asset is in the project.');
  const changed = audio.changed(audio.asset());
  await audio.session.run(setRackInvocation({ kind: 'asset', asset }, rack));
  await changed;
  return { audio, rack };
}

/**
 * Draws the panel over the window's stores, every command it runs recorded
 * and not run, so nothing but a command could change what it shows; those
 * run with options are recorded in `voiced` as well.
 */
function panelOver(
  audio: AudioWindow,
  gate: ModelGate = () => undefined,
  voiced: Voiced = [],
): Ran {
  const { context, projects } = audio.window;
  const ran: Ran = [];
  render(
    <RackPanel
      title="Effects rack"
      context={{
        projects,
        editor: {
          stores: { editorViews: context.editorViews, selections: context.selections },
          assets: context.assets,
        },
        modelGate: observable(gate),
        audioSettings: context.audioSettings,
        hearing: context.hearing,
        run: (id, args, options) => {
          ran.push([id, args]);
          if (options !== undefined) voiced.push([id, options]);
        },
        unavailableReason: () => undefined,
      }}
    />,
  );
  return ran;
}

/** The list item of the slot whose name button is `name`. */
function slotRow(name: string): HTMLElement {
  const row = screen.getByRole('button', { name }).closest('li');
  if (!(row instanceof HTMLElement)) throw new Error(`${name} is in no row.`);
  return row;
}

// Each test imports audio and runs its storage worker in the test's own
// thread, which takes seconds under the whole suite's load.
describe('the Effects rack panel', { timeout: 30_000 }, () => {
  it('lists the rack in signal order, a group’s branches nested, and says how each chain is heard', async () => {
    const { audio, rack } = await racked((made) => [
      processor(made, 'gain'),
      {
        kind: 'group',
        id: made.window.context.ids.next<'ProcessorGroupId'>(),
        enabled: true,
        soloed: false,
        mix: 1,
        summing: SummingLaw.Mean,
        branches: [{ slots: [processor(made, 'reverb')] }, { slots: [] }],
      },
      processor(made, 'peak-normalisation'),
    ]);
    panelOver(audio);

    const rows = screen.getAllByRole('list')[0];
    if (rows === undefined) throw new Error('The rack is listed.');
    expect(
      within(rows)
        .getAllByRole('listitem')
        .map(
          (row) =>
            row.querySelector(':scope > .ag-rack-slot-head button[aria-pressed]')?.textContent ??
            'group',
        ),
    ).toEqual(['Gain', 'group', 'Reverb', 'Peak normalisation']);
    expect(
      within(screen.getByRole('region', { name: 'Branch 1' })).getByText('Reverb'),
    ).toBeVisible();
    expect(
      within(screen.getByRole('region', { name: 'Branch 2' })).getByText(
        'Empty: it passes the group’s input on, the dry path.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Heard from a render, made before it plays. Peak normalisation measures the whole of its input before it plays anything.',
      ),
    ).toBeInTheDocument();
    expect(rack.slots).toHaveLength(3);
  });

  it('runs a command for each control, naming its slot, and writes nothing itself', async () => {
    const { audio, rack } = await racked((made) => [
      processor(made, 'gain'),
      processor(made, 'compressor'),
    ]);
    const [gain, compressor] = rack.slots;
    if (gain === undefined || compressor === undefined) throw new Error('Two slots.');
    const before = audio.session.getSnapshot().model.state;
    const ran = panelOver(audio);
    const user = userEvent.setup();
    const row = slotRow('Compressor');

    await user.click(within(row).getByRole('switch', { name: 'Use “Compressor”' }));
    await user.click(within(row).getByRole('switch', { name: 'Solo “Compressor”' }));
    within(row)
      .getByRole('button', { name: /^Move “Compressor”/u })
      .focus();
    await user.keyboard('{ArrowUp}');
    await user.click(within(row).getByRole('button', { name: 'Remove' }));
    await user.click(within(row).getByRole('button', { name: 'Compressor' }));
    await user.click(screen.getByRole('button', { name: 'Hear the original' }));

    expect(ran).toEqual([
      ['rack.set-enabled', { view: 'editor', slot: compressor.id, enabled: false }],
      ['rack.set-soloed', { view: 'editor', slot: compressor.id, soloed: true }],
      ['rack.move-processor', { view: 'editor', slot: compressor.id, direction: 'up' }],
      ['rack.remove-processor', { view: 'editor', slot: compressor.id }],
      ['editor.select-processor', { view: 'editor', processorId: compressor.id, extend: false }],
      ['transport.listen-original', undefined],
    ]);
    expect(audio.session.getSnapshot().model.state).toBe(before);
  });

  it('moves a slot dropped on another to that place, stated as the list stands without it', async () => {
    const { audio, rack } = await racked((made) => [
      processor(made, 'gain'),
      processor(made, 'compressor'),
      processor(made, 'limiter'),
    ]);
    const [gain] = rack.slots;
    if (gain === undefined) throw new Error('A gain leads.');
    const ran = panelOver(audio);
    const carried = new Map<string, string>();
    const dataTransfer = {
      setData: (type: string, value: string) => carried.set(type, value),
      getData: (type: string) => carried.get(type) ?? '',
      get types() {
        return [...carried.keys()];
      },
      effectAllowed: 'none',
    };

    fireEvent.dragStart(within(slotRow('Gain')).getByRole('button', { name: /^Move “Gain”/u }), {
      dataTransfer,
    });
    fireEvent.drop(slotRow('Limiter'), { dataTransfer });

    expect(ran).toEqual([
      ['rack.move-processor', { view: 'editor', chainId: rack.id, index: 1, slot: gain.id }],
    ]);
  });

  it('adds a processor by category, into the rack or over the selection', async () => {
    const { audio, rack } = await racked((made) => [processor(made, 'gain')]);
    const ran = panelOver(audio);
    const user = userEvent.setup();

    // A menu opens from the keyboard as from a press.
    screen.getByRole('button', { name: 'Add a processor' }).focus();
    await user.keyboard('{Enter}');
    const menu = await screen.findByRole('menu', { name: 'Add a processor' });
    expect(within(menu).getByText('Dynamics')).toBeInTheDocument();
    await user.click(within(menu).getByRole('menuitem', { name: /^Compressor/u }));
    screen.getByRole('button', { name: 'Add over the selection' }).focus();
    await user.keyboard('{Enter}');
    await user.click(await screen.findByRole('menuitem', { name: /^De-click/u }));

    expect(ran).toEqual([
      ['rack.add-processor', { view: 'editor', chainId: rack.id, typeKey: 'compressor' }],
      ['rack.add-processor', { view: 'editor', place: 'selection', typeKey: 'de-click' }],
    ]);
  });

  it('shows a selected processor’s settings along its taper, setting one once a key steps it', async () => {
    const { audio, rack } = await racked((made) => [processor(made, 'filter')]);
    const [filter] = rack.slots;
    if (filter === undefined) throw new Error('A filter.');
    audio.window.run('editor.select-processor', { processorId: filter.id });
    const ran = panelOver(audio);
    const user = userEvent.setup();

    const cutoff = screen.getByRole('slider', { name: 'Cutoff' });
    const descriptor = PROCESSOR_CATALOGUE.get('filter');
    const parameter = descriptor?.parameters.find((one) => one.key === 'cutoff');
    if (parameter?.kind !== 'numeric') throw new Error('A filter has a cutoff.');
    // Its default sits along the travel by its logarithm, not its value.
    const at =
      Math.log(parameter.defaultValue / parameter.minimum) /
      Math.log(parameter.maximum / parameter.minimum);
    expect(Number(cutoff.getAttribute('aria-valuenow'))).toBeCloseTo(at * 200, 6);
    cutoff.focus();
    await user.keyboard('{ArrowRight}');

    // A step from between two steps lands on the next whole one, which is the
    // value there along the taper.
    expect(ran).toEqual([
      [
        'rack.set-parameter',
        {
          view: 'editor',
          processorId: filter.id,
          key: 'cutoff',
          value: parameterAtPosition(parameter, Math.round(at * 200 + 1) / 200),
        },
      ],
    ]);
  });

  it('has its comparison say so when the rack is being compared already, which it does not show', async () => {
    const { audio } = await racked((made) => [processor(made, 'gain')]);
    const voiced: Voiced = [];
    const ran = panelOver(audio, () => undefined, voiced);

    await userEvent.click(screen.getByRole('button', { name: 'Compare with before' }));
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));

    expect(ran.map(([id]) => id)).toEqual(['rack.compare-before-change', 'rack.copy']);
    expect(voiced).toEqual([['rack.compare-before-change', { sayWhenUnchanged: true }]]);
  });

  it('says a shared chain is shared and where, with the command that makes it independent', async () => {
    const { audio, rack } = await racked((made) => [processor(made, 'gain')]);
    const region = [...audio.session.getSnapshot().model.state.project.regions.values()][0];
    if (region === undefined) throw new Error('A region.');
    const asset = audio.session.getSnapshot().model.state.project.assets.get(audio.assetId);
    if (asset === undefined) throw new Error('An asset.');
    await audio.session.run(setRackInvocation({ kind: 'region', region, asset }, rack));
    const ran = panelOver(audio);

    expect(
      await screen.findByText(
        'This chain is shared: the rack of “Intro” uses it too, so a change here is heard there.',
      ),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Make independent' }));
    expect(ran).toEqual([['rack.make-independent', { view: 'editor', chainId: rack.id }]]);
  });

  it('offers to remove the processing of each range a chain processes, naming its edit', async () => {
    const { audio } = await racked((made) => [processor(made, 'gain')]);
    const asset = audio.session.getSnapshot().model.state.project.assets.get(audio.assetId);
    if (asset === undefined) throw new Error('An asset.');
    const chain: EffectChain = {
      id: audio.window.context.ids.next<'EffectChainId'>(),
      slots: [processor(audio, 'reverb')],
    };
    const operation = audio.window.context.ids.next<'EditOperationId'>();
    await audio.session.run(
      rackRangeInvocation(
        { kind: 'asset', asset: asset.id, range: { start: at(0), end: at(4_800) } },
        operation,
        chain,
      ),
    );
    const ran = panelOver(audio);

    const ranges = screen.getByRole('region', { name: 'Ranges a chain processes' });
    await userEvent.click(within(ranges).getByRole('button', { name: 'Remove this processing' }));

    expect(ran).toEqual([['rack.remove-range', { view: 'editor', operationId: operation }]]);
  });

  it('says why a processor cannot run where its model is missing, and follows a change', async () => {
    const { audio, rack } = await racked((made) => [processor(made, 'gain')]);
    panelOver(audio, () => 'Its model pack is not installed.');

    expect(screen.getByText('It cannot run: Its model pack is not installed.')).toBeInTheDocument();
    await act(async () => {
      const [first, ...rest] = removeSlotsInvocations(
        audio.session.getSnapshot().model.state,
        rack.slots.map((slot) => slot.id),
      );
      if (first !== undefined) await audio.session.runGroup('Empty the rack', [first, ...rest]);
    });
    expect(await screen.findByText('It runs no processor yet: add one.')).toBeInTheDocument();
  });
});
