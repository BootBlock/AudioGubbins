/**
 * One chain of a rack as the Effects rack panel shows it (ADR-0060,
 * ADR-0061): how it is heard, by the one rule the threads that play it follow
 * (`chainListening`), how its preview differs from a render where its
 * processors read a quality setting, whether it is shared and with what, its
 * slots (`chain-view.tsx`), and what adds to it; and the ranges of the target
 * a chain processes, each opened to show its chain the same way, and each
 * removed by the command that withdraws its rack edit.
 */

import { useId, useState, useSyncExternalStore, type ReactNode } from 'react';

import { Button } from '@audiogubbins/design-system';
import {
  appliedProcessors,
  chainListening,
  type EffectChain,
  type EffectChainId,
  type QualitySettingKey,
  type RangeRack,
} from '@audiogubbins/domain';
import { PROCESSOR_CATALOGUE } from '@audiogubbins/processors';
import { formatPosition } from '@audiogubbins/timeline';

import { otherUsers } from '../../commands/rack-target.js';
import { chainWords, listeningText } from '../../commands/rack-words.js';
import { previewDifferenceText } from '../../quality-words.js';
import { previewQualityOf } from '../../state/audio-settings-store.js';
import { CommandButton } from '../command-button.js';
import { AddProcessorMenu } from './add-processor-menu.js';
import type { ChainParts } from './chain-parts.js';
import { SlotList } from './chain-view.js';
import type { RackContext, ShownRack } from './shown-rack.js';

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

/** How a chain is heard, and how its preview differs from a render where its processors read a setting. */
function ListeningLines({
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
  return (
    <>
      <p className="ag-panel-note">{listeningText(listening)}</p>
      {read.size > 0 && (
        <p className="ag-panel-note">
          {previewDifferenceText(preview, settings.renderQuality.settings, read)}
        </p>
      )}
    </>
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
  const others = otherUsers(shown.state.project, id, shown.target);
  if (others.length === 0) return undefined;
  const verb = others.length === 1 ? 'uses' : 'use';
  return (
    <div className="ag-inspector-row">
      <p>{`This chain is shared: ${others.join(', ')} ${verb} it too, so a change here is heard there.`}</p>
      <CommandButton
        id="rack.make-independent"
        label="Make independent"
        commands={context}
        args={{ view: shown.panel, chainId: id }}
        compact
      />
    </div>
  );
}

/** What adds to the end of a chain: a processor, a parallel group, or what was copied. */
function ChainActions({
  id,
  shown,
  context,
}: {
  readonly id: EffectChainId;
  readonly shown: ShownRack;
  readonly context: RackContext;
}): ReactNode {
  const args = { view: shown.panel, chainId: id };
  return (
    <div className="ag-inspector-row">
      <AddProcessorMenu label="Add a processor" args={args} commands={context} />
      <CommandButton
        id="rack.add-group"
        label="Add a parallel group"
        commands={context}
        args={args}
        compact
      />
      <CommandButton id="rack.paste" label="Paste" commands={context} args={args} compact />
    </div>
  );
}

/** One chain of the target, with how it is heard, whether it is shared, and its slots. */
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
    selected: shown.selected,
    gate,
    commands: context,
  };
  return (
    <>
      <ListeningLines chain={chain} shown={shown} context={context} />
      <SharedNotice id={id} shown={shown} context={context} />
      <SlotList
        slots={chain.slots}
        group={undefined}
        parts={parts}
        empty="It runs no processor yet: add one."
      />
      <ChainActions id={id} shown={shown} context={context} />
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
  return (
    <li className="ag-rack-range">
      <Button
        compact
        tone="quiet"
        aria-expanded={opened}
        aria-controls={contentId}
        onClick={() => {
          setOpened(!opened);
        }}
      >
        {`From ${at(range.range.start)} to ${at(range.range.end)}: ${runs}`}
      </Button>
      <CommandButton
        id="rack.remove-range"
        label="Remove this processing"
        commands={context}
        args={{ view: shown.panel, operationId: range.operation }}
        compact
      />
      <div id={contentId} hidden={!opened}>
        {opened && chain !== undefined && (
          <ChainSection id={range.chain} chain={chain} shown={shown} context={context} />
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
    <section className="ag-inspector-section" aria-label="Ranges a chain processes">
      <h3 className="ag-inspector-heading">Ranges a chain processes</h3>
      {ranges.length === 0 ? (
        <p className="ag-panel-note">None. Select a range and add a processor over it.</p>
      ) : (
        <ul className="ag-rack-ranges">
          {ranges.map((range) => (
            <RangeRow key={range.operation} range={range} shown={shown} context={context} />
          ))}
        </ul>
      )}
    </section>
  );
}
