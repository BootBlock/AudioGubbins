/**
 * One chain of a rack as the Effects rack panel shows it (ADR-0060,
 * ADR-0061): how it is heard, by the one rule the threads that play it follow
 * (`chainListening`), and how its preview differs from a render where its
 * processors read a quality setting, said in a word with the whole of it
 * behind a hint; whether it is shared and with what; its slots and the
 * controls of each processor selected (`chain-view.tsx`); and what adds to
 * it. And the ranges of the target a chain processes, each opened to show its
 * chain the same way, and each removed by the command that withdraws its rack
 * edit.
 */

import { useId, useState, useSyncExternalStore, type ReactNode } from 'react';

import {
  Button,
  ButtonTone,
  Hint,
  Icon,
  IconButton,
  Menu,
  Section,
  type MenuItemDescriptor,
} from '@audiogubbins/design-system';
import {
  appliedProcessors,
  chainListening,
  type EffectChain,
  type EffectChainId,
  type QualitySettingKey,
  type RangeRack,
} from '@audiogubbins/domain';
import type { CommandInvocation } from '@audiogubbins/commands';
import { PROCESSOR_CATALOGUE } from '@audiogubbins/processors';
import { counted } from '@audiogubbins/text';
import { formatPosition } from '@audiogubbins/timeline';

import { otherUsers } from '../../commands/rack-target.js';
import { chainWords, listeningText } from '../../commands/rack-words.js';
import { previewDifferenceText } from '../../quality-words.js';
import { previewQualityOf } from '../../state/audio-settings-store.js';
import { CommandButton, type PanelCommands } from '../command-button.js';
import { AddLook, AddProcessorMenu } from './add-processor-menu.js';
import type { ChainParts } from './chain-parts.js';
import { SelectedProcessors, SlotList } from './chain-view.js';
import type { RackContext, ShownRack } from './shown-rack.js';

/** A menu entry that runs the command `id` with `args`, unavailable with its own reason. */
export function commandItem(
  commands: PanelCommands,
  id: string,
  label: string,
  args?: CommandInvocation['arguments'],
): MenuItemDescriptor {
  const reason = commands.unavailableReason(id, args);
  return {
    key: `${id}:${label}`,
    label,
    ...(reason === undefined ? {} : { unavailableReason: reason }),
    onSelect: () => {
      commands.run(id, args);
    },
  };
}

/** The quality settings the processors `chain` applies read, for its preview's difference. */
function settingsRead(chain: EffectChain): ReadonlySet<QualitySettingKey> {
  const read = new Set<QualitySettingKey>();
  for (const processor of appliedProcessors(chain.slots)) {
    for (const key of PROCESSOR_CATALOGUE.get(processor.typeKey)?.qualitySettings ?? []) {
      read.add(key);
    }
  }
  return read;
}

/**
 * How a chain is heard, in a word, live or from a render, with the whole of
 * it behind a hint: why it is heard so, and how its preview differs from a
 * render where its processors read a setting.
 */
export function ChainHearing({
  chain,
  shown,
  context,
}: {
  readonly chain: EffectChain;
  readonly shown: ShownRack;
  readonly context: RackContext;
}): ReactNode {
  const { audioSettings } = context;
  const settings = useSyncExternalStore(audioSettings.subscribe, audioSettings.get);
  const preview = previewQualityOf(settings).settings;
  const listening = chainListening(chain, PROCESSOR_CATALOGUE, {
    sampleRate: shown.view.sampleRate,
    quality: preview,
  });
  const read = settingsRead(chain);
  const word = listening.kind === 'live' ? 'Heard live' : 'Heard from a render';
  return (
    <span className="ag-rack-hearing">
      <span className="ag-rack-hearing-word">{word}</span>
      <Hint label={`About how it is heard: ${word.toLowerCase()}`} title={word}>
        <p>{listeningText(listening)}</p>
        {read.size > 0 && (
          <p>{previewDifferenceText(preview, settings.renderQuality.settings, read)}</p>
        )}
      </Hint>
    </span>
  );
}

/** Where a chain is shared, what else uses it, and the command that makes it this target's own. */
function SharedNotice({
  id,
  shown,
  context,
}: {
  readonly id: EffectChainId;
  readonly shown: ShownRack;
  readonly context: RackContext;
}): ReactNode {
  const others = otherUsers(shown.state, id, shown.target);
  if (others.length === 0) return undefined;
  const verb = others.length === 1 ? 'uses' : 'use';
  const args = { view: shown.panel, chainId: id };
  return (
    <div className="ag-rack-shared">
      <Icon name="saved-chain" />
      <p>{`This chain is shared: ${others.join(', ')} ${verb} it too, so a change here is heard there.`}</p>
      <CommandButton
        id="rack.make-independent"
        label="Make independent"
        commands={context}
        args={args}
        compact
      />
    </div>
  );
}

/**
 * What adds to the end of a chain: a processor, by the menu that adds one, and
 * a parallel group or what was copied, in the menu beside it, with whatever
 * else the place it is drawn in adds there (`more`).
 */
export function ChainActions({
  id,
  shown,
  context,
  look,
  more = [],
}: {
  readonly id: EffectChainId;
  readonly shown: ShownRack;
  readonly context: RackContext;
  readonly look: AddLook;
  readonly more?: readonly MenuItemDescriptor[];
}): ReactNode {
  const args = { view: shown.panel, chainId: id };
  return (
    <>
      <AddProcessorMenu label="Add a processor" args={args} commands={context} look={look} />
      <Menu
        label="More for this chain"
        trigger={<IconButton icon="more" label="More for this chain" compact />}
        groups={[
          {
            key: 'chain',
            items: [
              commandItem(context, 'rack.add-group', 'Add a parallel group', args),
              commandItem(context, 'rack.paste', 'Paste', args),
            ],
          },
          ...(more.length === 0 ? [] : [{ key: 'more', items: more }]),
        ]}
      />
    </>
  );
}

/** One chain of the target: whether it is shared, its slots, and the controls of each processor selected. */
export function ChainSection({
  id,
  chain,
  shown,
  context,
}: {
  readonly id: EffectChainId;
  readonly chain: EffectChain;
  readonly shown: ShownRack;
  readonly context: RackContext;
}): ReactNode {
  const gate = useSyncExternalStore(context.modelGate.subscribe, context.modelGate.get);
  const parts: ChainParts = {
    panel: shown.panel,
    chain: id,
    sampleRate: shown.view.sampleRate,
    selected: shown.selected,
    gate,
    commands: context,
  };
  return (
    <>
      <SharedNotice id={id} shown={shown} context={context} />
      <SlotList
        slots={chain.slots}
        group={undefined}
        parts={parts}
        empty="It runs no processor yet: add one."
      />
      <SelectedProcessors slots={chain.slots} parts={parts} />
    </>
  );
}

/** The chain of a range opened: how it is heard, what adds to it, and its slots. */
function RangeChain({
  id,
  chain,
  shown,
  context,
}: {
  readonly id: EffectChainId;
  readonly chain: EffectChain;
  readonly shown: ShownRack;
  readonly context: RackContext;
}): ReactNode {
  return (
    <>
      <div className="ag-rack-range-bar">
        <ChainHearing chain={chain} shown={shown} context={context} />
        <span className="ag-rack-range-actions">
          <ChainActions id={id} shown={shown} context={context} look={AddLook.Secondary} />
        </span>
      </div>
      <ChainSection id={id} chain={chain} shown={shown} context={context} />
    </>
  );
}

/**
 * A range of the target a chain processes, opened to show its chain as the
 * rack is shown, with the command that removes that processing.
 */
function RangeRow({
  range,
  shown,
  context,
}: {
  readonly range: RangeRack;
  readonly shown: ShownRack;
  readonly context: RackContext;
}): ReactNode {
  const [opened, setOpened] = useState(false);
  const contentId = useId();
  const chain = shown.state.project.effectChains.get(range.chain);
  const at = (frames: number): string =>
    formatPosition(frames, shown.view.sampleRate, shown.timeFormat);
  const runs = chain === undefined ? 'a chain the project does not hold' : chainWords(chain);
  const remove = { view: shown.panel, operationId: range.operation };
  return (
    <li className="ag-rack-range" data-ag-open={opened ? '' : undefined}>
      <div className="ag-rack-range-head">
        <Button
          compact
          tone="quiet"
          aria-expanded={opened}
          aria-controls={contentId}
          onClick={() => {
            setOpened(!opened);
          }}
        >
          <Icon name={opened ? 'collapse' : 'expand'} />
          {`From ${at(range.range.start)} to ${at(range.range.end)}: ${runs}`}
        </Button>
        <CommandButton
          id="rack.remove-range"
          label="Remove this processing"
          commands={context}
          args={remove}
          tone={ButtonTone.QuietDestructive}
          compact
        />
      </div>
      <div id={contentId} hidden={!opened} className="ag-rack-range-chain">
        {opened && chain !== undefined && (
          <RangeChain id={range.chain} chain={chain} shown={shown} context={context} />
        )}
      </div>
    </li>
  );
}

/** The ranges of the target a chain processes, each a rack edit (REQ-EDIT-012). */
export function RangeRacks({
  ranges,
  shown,
  context,
}: {
  readonly ranges: readonly RangeRack[];
  readonly shown: ShownRack;
  readonly context: RackContext;
}): ReactNode {
  return (
    <section className="ag-rack-section" aria-label="Ranges a chain processes">
      <Section
        title="Ranges a chain processes"
        icon="region"
        {...(ranges.length === 0 ? {} : { summary: counted(ranges.length, 'range', 'ranges') })}
      >
        {ranges.length === 0 ? (
          <p className="ag-panel-note">None. Select a range and add a processor over it.</p>
        ) : (
          <ul className="ag-rack-ranges">
            {ranges.map((range) => (
              <RangeRow key={range.operation} range={range} shown={shown} context={context} />
            ))}
          </ul>
        )}
      </Section>
    </section>
  );
}
