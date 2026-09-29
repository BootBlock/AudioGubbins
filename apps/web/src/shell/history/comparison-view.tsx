/**
 * The A/B comparison open in the project: its two states, the one being heard,
 * switching between them, what differs, and keeping one of them (REQ-STOR-195).
 *
 * Switching changes neither state, and keeping a side moves the project to it
 * with the other left in the history, so nothing is lost either way. What
 * differs is worked out as the comparison is opened; for a comparison kept from
 * before, comparing again says it. Hearing a side needs the audio engine, which
 * a later phase brings; the side chosen is the one it will play.
 */

import type { ReactNode } from 'react';

import { Button, ButtonTone } from '@audiogubbins/design-system';
import {
  listenedSide,
  type Comparison,
  type ComparisonSide,
  type History,
  type SideName,
} from '@audiogubbins/history';

import type { ComparedDifference } from '../../state/history-review-store.js';
import type { RunCommand } from '../settings/section.js';
import { describeNode, differenceSentences } from './history-words.js';

/** The two sides, in the order they are offered. */
const SIDES: readonly SideName[] = ['a', 'b'];

/** What a side is, in a phrase. */
function sideOf(history: History, chosen: ComparisonSide): string {
  if (chosen.name !== undefined) return `the snapshot "${chosen.name}"`;
  const node = history.nodes.get(chosen.node);
  return node === undefined ? 'a point no longer in the history' : describeNode(node);
}

/** Hearing each side, keeping one, and stopping. */
function ComparisonControls({
  listening,
  run,
}: {
  readonly listening: SideName;
  readonly run: RunCommand;
}): ReactNode {
  return (
    <div className="ag-settings-row">
      {SIDES.map((side) => (
        <Button
          key={`hear-${side}`}
          compact
          aria-pressed={listening === side}
          onClick={() => run('history.switch-side', { side })}
        >
          {`Hear ${side.toUpperCase()}`}
        </Button>
      ))}
      {SIDES.map((side) => (
        <Button
          key={`keep-${side}`}
          compact
          tone={ButtonTone.Primary}
          onClick={() => run('history.promote', { side })}
        >
          {`Keep ${side.toUpperCase()}`}
        </Button>
      ))}
      <Button compact onClick={() => run('history.close-comparison')}>
        Stop comparing
      </Button>
    </div>
  );
}

/** The comparison (see the module comment). */
export function ComparisonView({
  history,
  comparison,
  difference,
  run,
}: {
  readonly history: History;
  readonly comparison: Comparison;

  /** What differs, where it was worked out for these two sides. */
  readonly difference: ComparedDifference | undefined;
  readonly run: RunCommand;
}): ReactNode {
  const known = difference?.a === comparison.a.node && difference.b === comparison.b.node;
  const heard = comparison.listening.toUpperCase();
  const heardState = sideOf(history, listenedSide(comparison));
  return (
    <div role="group" className="ag-history-comparison" aria-label="Comparison">
      <h3 className="ag-section-heading">Comparing two states</h3>
      <p>{`A is ${sideOf(history, comparison.a)}. B is ${sideOf(history, comparison.b)}.`}</p>
      <p role="status">{`Side ${heard}, ${heardState}, is the one heard. Playing it arrives with the audio engine.`}</p>
      {known ? (
        <ul className="ag-history-differences" aria-label="What differs">
          {differenceSentences(difference.difference).map((sentence) => (
            <li key={sentence}>{sentence}</li>
          ))}
        </ul>
      ) : (
        <p className="ag-settings-note">Compare the two again to see what differs between them.</p>
      )}
      <ComparisonControls listening={comparison.listening} run={run} />
    </div>
  );
}
