/**
 * The Effects rack panel (ADR-0060, REQ-AUDIO-017, REQ-AUDIO-019): the rack
 * of the asset or region the editor in use acts on (`shown-rack.ts`), its
 * chain drawn as a row of cards in signal order with parallel groups nested
 * (`chain-section.tsx`, `chain-view.tsx`), the controls of each processor
 * selected under it, the ranges of the target a chain processes, each opened
 * as a chain the same way, and what is done with a rack: adding a processor
 * by category, copying and pasting, saving it and its processors to the
 * library (`library-controls.tsx`), comparing it with before its latest
 * change, and hearing the original beside it.
 *
 * Its header names the rack and says how it is heard, and holds what is done
 * with the rack as a whole; the menus there carry every command the row of
 * buttons once did, each unavailable with its own reason.
 *
 * It reads the stores and runs commands; it writes nothing itself (`CLAUDE.md`
 * G2), and it follows every change to them, an undo included.
 */

import type { ReactNode } from 'react';

import {
  Button,
  EmptyState,
  IconButton,
  Menu,
  PanelHeader,
  type MenuItemDescriptor,
} from '@audiogubbins/design-system';
import type { EffectChain, EffectChainId } from '@audiogubbins/domain';
import { targetChains } from '@audiogubbins/project-commands';

import { targetName } from '../../commands/rack-target.js';
import { optionalReason } from '../optional-reason.js';
import { AddLook, AddProcessorMenu } from './add-processor-menu.js';
import {
  ChainActions,
  ChainHearing,
  ChainSection,
  RangeRacks,
  commandItem,
} from './chain-section.js';
import { HearingSwitch } from './hearing-switch.js';
import { LibraryControls, NO_LIBRARY } from './library-controls.js';
import { useShown, type RackContext, type ShownRack } from './shown-rack.js';

/**
 * The row under the header of what is done with the rack as a whole: hearing
 * the original beside it, copying it, comparing it with before its latest
 * change, and adding a processor over the selection.
 */
function RackTools({
  shown,
  context,
}: {
  readonly shown: ShownRack;
  readonly context: RackContext;
}): ReactNode {
  const args = { view: shown.panel };
  return (
    <div className="ag-rack-tools">
      <HearingSwitch hearing={context.hearing} commands={context} />
      <span className="ag-rack-tools-group">
        <IconButton
          icon="copy"
          compact
          label="Copy"
          {...optionalReason(context.unavailableReason('rack.copy', args))}
          onClick={() => {
            context.run('rack.copy', args);
          }}
        />
        <IconButton
          icon="compare"
          compact
          label="Compare with before"
          {...optionalReason(context.unavailableReason('rack.compare-before-change', args))}
          onClick={() => {
            // A comparison already open is shown in the History panel, not
            // here, so the command says so when it finds nothing to do.
            context.run('rack.compare-before-change', args, { sayWhenUnchanged: true });
          }}
        />
      </span>
      <AddProcessorMenu
        label="Add over the selection"
        args={{ ...args, place: 'selection' }}
        commands={context}
      />
    </div>
  );
}

/** The menu entry that takes the rack away from its target. */
function takeAway(shown: ShownRack, context: RackContext): MenuItemDescriptor {
  return commandItem(context, 'rack.remove-rack', 'Take the rack away', { view: shown.panel });
}

/**
 * The rack's header: the panel's name, the rack's target and how it is heard,
 * and what adds to it, with the rest of what is done with it in a menu.
 */
function RackHeader({
  title,
  rack,
  chain,
  shown,
  context,
}: {
  readonly title: string;
  readonly rack: EffectChainId | undefined;
  readonly chain: EffectChain | undefined;
  readonly shown: ShownRack;
  readonly context: RackContext;
}): ReactNode {
  return (
    <PanelHeader
      title={title}
      icon="effects-rack"
      subLabel={
        <span className="ag-rack-sub">
          <span>{`Rack of ${targetName(shown.target)}`}</span>
          {chain !== undefined && <ChainHearing chain={chain} shown={shown} context={context} />}
        </span>
      }
      actions={
        rack === undefined || chain === undefined ? (
          <Menu
            label="More for this rack"
            trigger={<IconButton icon="more" label="More for this rack" compact />}
            groups={[{ key: 'rack', items: [takeAway(shown, context)] }]}
          />
        ) : (
          <ChainActions
            id={rack}
            shown={shown}
            context={context}
            look={AddLook.CallToAction}
            more={[takeAway(shown, context)]}
          />
        )
      }
    />
  );
}

/** The rack of a target of the project. */
function ProjectRack({
  title,
  shown,
  context,
}: {
  readonly title: string;
  readonly shown: ShownRack;
  readonly context: RackContext;
}): ReactNode {
  const { rack, ranges } = targetChains(shown.target);
  const chain = rack === undefined ? undefined : shown.state.project.effectChains.get(rack);
  const args = { view: shown.panel };
  return (
    <>
      <RackHeader title={title} rack={rack} chain={chain} shown={shown} context={context} />
      <div className="ag-panel-body">
        <RackTools shown={shown} context={context} />
        {rack === undefined || chain === undefined ? (
          <EmptyState
            icon="effects-rack"
            title="It has no rack"
            text="Add a processor to give it one, or paste one."
            actions={
              <>
                <AddProcessorMenu
                  label="Add a processor"
                  args={args}
                  commands={context}
                  look={AddLook.CallToAction}
                />
                <Button
                  compact
                  {...optionalReason(context.unavailableReason('rack.paste', args))}
                  onClick={() => {
                    context.run('rack.paste', args);
                  }}
                >
                  Paste
                </Button>
              </>
            }
          />
        ) : (
          <ChainSection id={rack} chain={chain} shown={shown} context={context} />
        )}
        <RangeRacks ranges={ranges} shown={shown} context={context} />
        <LibraryControls
          shown={shown}
          library={context.projects?.savedProcessing ?? NO_LIBRARY}
          commands={context}
        />
      </div>
    </>
  );
}

/** The Effects rack panel. */
export function RackPanel({
  title,
  context,
}: {
  readonly title: string;
  readonly context: RackContext;
}): ReactNode {
  const shown = useShown(context);
  return (
    <section className="ag-panel ag-processing-panel ag-rack">
      {shown.kind === 'project' ? (
        <ProjectRack title={title} shown={shown} context={context} />
      ) : (
        <>
          <PanelHeader title={title} icon="effects-rack" />
          <div className="ag-panel-body">
            {shown.kind === 'nothing' ? (
              <EmptyState
                icon="effects-rack"
                title="No rack to show"
                text="Open audio in an editor to see its rack here."
              />
            ) : (
              <EmptyState
                icon="effects-rack"
                title={shown.view.name}
                text="It is not part of the project, so it has no rack. Import a file to process it."
              />
            )}
          </div>
        </>
      )}
    </section>
  );
}
