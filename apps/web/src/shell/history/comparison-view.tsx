/**
 * The A/B comparison open in the project: its two states, the one being heard,
 * switching between them, what differs, and keeping one of them (REQ-STOR-195).
 *
 * Switching changes neither state, and keeping a side moves the project to it
 * with the other left in the history, so nothing is lost either way. What
 * differs is said entity by entity, worked out in the storage worker as the
 * comparison is opened and again for one kept from before, as after a reload.
 * Playing plays the audio in the editor in use as the side heard has it, and
 * switching while it plays goes on with the other side from the same place.
 */

import type { ReactNode } from 'react';

import {
  Badge,
  BadgeTone,
  Button,
  ButtonTone,
  Icon,
  IconButton,
  SegmentedControl,
  Spinner,
} from '@audiogubbins/design-system';
import {
  listenedSide,
  type Comparison,
  type ComparisonSide,
  type History,
  type SideName,
} from '@audiogubbins/history';

import type { ComparedStates } from '@audiogubbins/storage';

import { when } from '../../wording.js';
import { CommandButton, type PanelCommands } from '../command-button.js';
import { differenceLines } from './difference-words.js';
import { describeNode } from './history-words.js';

/** The two sides, in the order they are offered. */
const SIDES: readonly SideName[] = ['a', 'b'];

/** The choice of the side heard, one segment for each side. */
const HEARING = SIDES.map((side) => ({ value: side, label: `Hear ${side.toUpperCase()}` }));

/** What a side is, in a phrase. */
function sideOf(history: History, chosen: ComparisonSide): string {
  if (chosen.name !== undefined) return `the snapshot "${chosen.name}"`;
  const node = history.nodes.get(chosen.node);
  return node === undefined ? 'a point no longer in the history' : describeNode(node);
}

/** Whether `value` names a side, as the segmented control hands back a string. */
function isSide(value: string): value is SideName {
  return SIDES.some((side) => side === value);
}

/** One side: its letter, what it is and when, and whether it is the one heard. */
function SideCard({
  history,
  side,
  of,
  heard,
}: {
  readonly history: History;
  readonly side: SideName;
  readonly of: ComparisonSide;
  readonly heard: boolean;
}): ReactNode {
  const at = history.nodes.get(of.node)?.at;
  return (
    <div className="ag-history-side" data-ag-heard={heard ? '' : undefined}>
      <span className="ag-history-side-letter">{side.toUpperCase()}</span>
      <span className="ag-history-side-text">
        <span className="ag-history-side-name">{sideOf(history, of)}</span>
        {at !== undefined && <span className="ag-history-side-time">{when(at)}</span>}
      </span>
      {heard && (
        <Badge tone={BadgeTone.Accent} icon="heard-side">
          Heard
        </Badge>
      )}
    </div>
  );
}

/** Hearing each side and playing the one heard. */
function Hearing({
  listening,
  commands,
  labelFor,
}: {
  readonly listening: SideName;
  readonly commands: PanelCommands;
  readonly labelFor: (id: string) => string;
}): ReactNode {
  return (
    <div className="ag-history-hearing">
      <SegmentedControl
        label="Side heard"
        value={listening}
        options={HEARING}
        onValueChange={(side) => {
          if (isSide(side)) commands.run('history.switch-side', { side });
        }}
      />
      <span className="ag-history-play">
        <CommandButton
          id="history.audition"
          label={labelFor('history.audition')}
          commands={commands}
          tone={ButtonTone.Primary}
          iconOnly
        />
      </span>
    </div>
  );
}

/** What differs between the sides, or that it is being worked out. */
function Differences({
  comparison,
  difference,
}: {
  readonly comparison: Comparison;
  readonly difference: ComparedStates | undefined;
}): ReactNode {
  const known = difference?.a === comparison.a.node && difference.b === comparison.b.node;
  if (!known) {
    return (
      <p className="ag-history-working" role="status">
        <Spinner />
        <span>Working out what differs between them…</span>
      </p>
    );
  }
  return (
    <ul className="ag-history-differences" aria-label="What differs">
      {differenceLines(difference.difference, difference.names).map((line, index) => (
        // Two entities of one kind can share a name, and so a line.
        <li key={`${String(index)} ${line}`} className="ag-history-difference">
          {line}
        </li>
      ))}
    </ul>
  );
}

/** What is being done, and the way to stop comparing. */
function ComparisonHeader({ commands }: { readonly commands: PanelCommands }): ReactNode {
  return (
    <div className="ag-history-comparison-header">
      <Icon name="compare" className="ag-history-comparison-glyph" />
      <h3 className="ag-history-comparison-title">Comparing two states</h3>
      <IconButton
        icon="close"
        compact
        label="Stop comparing"
        onClick={() => {
          commands.run('history.close-comparison');
        }}
      />
    </div>
  );
}

/** Keeping either side, which moves the project to it with the other left in the history. */
function Keeping({ commands }: { readonly commands: PanelCommands }): ReactNode {
  return (
    <div className="ag-history-buttons">
      {SIDES.map((side) => (
        <Button
          key={`keep-${side}`}
          compact
          onClick={() => {
            commands.run('history.promote', { side });
          }}
        >
          {`Keep ${side.toUpperCase()}`}
        </Button>
      ))}
    </div>
  );
}

/** The comparison (see the module comment). */
export function ComparisonView({
  history,
  comparison,
  difference,
  commands,
  labelFor,
}: {
  readonly history: History;
  readonly comparison: Comparison;

  /** What differs, where it was worked out for these two sides. */
  readonly difference: ComparedStates | undefined;
  readonly commands: PanelCommands;
  readonly labelFor: (id: string) => string;
}): ReactNode {
  const heard = comparison.listening.toUpperCase();
  const heardState = sideOf(history, listenedSide(comparison));
  return (
    <div role="group" className="ag-history-comparison" aria-label="Comparison">
      <ComparisonHeader commands={commands} />
      <div className="ag-history-sides">
        {SIDES.map((side) => (
          <SideCard
            key={side}
            history={history}
            side={side}
            of={comparison[side]}
            heard={comparison.listening === side}
          />
        ))}
      </div>
      {/* Not a status: switching sides says which is heard as it is made,
          and a status would say it again. */}
      <p className="ag-history-heard">{`Side ${heard}, ${heardState}, is the one heard.`}</p>
      <Hearing listening={comparison.listening} commands={commands} labelFor={labelFor} />
      <h4 className="ag-history-group-title">What differs</h4>
      <Differences comparison={comparison} difference={difference} />
      <Keeping commands={commands} />
    </div>
  );
}
