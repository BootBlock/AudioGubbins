/**
 * The preview's event log as a table (ADR-0104): each trigger and voice the
 * listener has heard, newest last, with its emitter's dot in the emitter's
 * colour and the member, pitch, gain, offset and bus each start chose; the
 * counts of every kind behind the title's hint; and a polite count of them said
 * at most once a second, so a rapid run is not read out event by event.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import { Hint } from '@audiogubbins/design-system';

import type { Project } from '@audiogubbins/domain';
import type { PreviewEmitterId, PreviewEvent } from '@audiogubbins/game-audio';
import { counted } from '@audiogubbins/text';

import type { EventCounts } from '../../state/game-preview-store.js';
import { emitterColour } from './emitter-colours.js';
import { eventWords, memberName, signed } from './preview-words.js';

/** The least time between two counts said, in milliseconds. */
const SAID_EVERY_MILLISECONDS = 1_000;

/** Says how many events have been heard, at most once a second, in a polite live region. */
function useCountSaid(total: number): string {
  const [said, setSaid] = useState('');
  const last = useRef(0);
  useEffect(() => {
    const now = performance.now();
    const wait = Math.max(0, last.current + SAID_EVERY_MILLISECONDS - now);
    const timer = setTimeout(() => {
      last.current = performance.now();
      setSaid(total === 0 ? '' : `${counted(total, 'event', 'events')} heard.`);
    }, wait);
    return () => {
      clearTimeout(timer);
    };
  }, [total]);
  return said;
}

/** The events that are refusals, drawn in the warning colour. */
const REFUSALS: ReadonlySet<PreviewEvent['kind']> = new Set(['rejected', 'budget-rejected']);

/** The time of `frame` at `rate`, in seconds to the millisecond. */
function timeOf(frame: number, rate: number): string {
  return `${(frame / rate).toFixed(3)} s`;
}

/** One event the listener heard: when, from which emitter, what, and what a start chose. */
function EventRow({
  event,
  rate,
  project,
  emitter,
}: {
  readonly event: PreviewEvent;
  readonly rate: number;
  readonly project: Project;
  readonly emitter: { readonly name: string; readonly place: number } | undefined;
}): ReactNode {
  const started = event.kind === 'started' ? event : undefined;
  return (
    <tr data-kind={event.kind} data-ag-refusal={REFUSALS.has(event.kind) ? '' : undefined}>
      <td className="ag-figure">{timeOf(event.frame, rate)}</td>
      <td>
        <span
          className="ag-preview-event-dot"
          data-ag-category={emitterColour(emitter?.place ?? 0)}
          aria-hidden="true"
        />
        {emitter?.name ?? event.emitter}
      </td>
      <td>{`${eventWords(event)}${'trigger' in event ? `, trigger ${String(event.trigger + 1)}` : `, voice ${String(event.voice + 1)}`}`}</td>
      <td>{started === undefined ? '' : memberName(project, started.member)}</td>
      <td className="ag-figure">
        {started === undefined ? '' : signed(started.pitchCents, 'cents')}
      </td>
      <td className="ag-figure">
        {started === undefined ? '' : signed(started.gainDecibels, 'dB', 1)}
      </td>
      <td className="ag-figure">
        {started === undefined ? '' : `${String(started.offsetFrames)} frames`}
      </td>
      <td>{started === undefined ? '' : (started.bus ?? 'Master')}</td>
    </tr>
  );
}

/** The log of the events a run played, and their counts. */
export function EventLog({
  events,
  counts,
  rate,
  project,
  emitters,
}: {
  readonly events: readonly PreviewEvent[];
  readonly counts: EventCounts;
  readonly rate: number;
  readonly project: Project;
  /** Each emitter's name and its place in the scenario, which its dot's colour follows. */
  readonly emitters: ReadonlyMap<
    PreviewEmitterId,
    { readonly name: string; readonly place: number }
  >;
}): ReactNode {
  const caption = useId();
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const said = useCountSaid(total);
  const title = `The latest ${counted(events.length, 'event', 'events')} heard, oldest first`;
  return (
    <div className="ag-preview-log">
      <div className="ag-preview-log-head">
        <h4 className="ag-preview-group-title" id={caption}>
          {title}
        </h4>
        <Hint label="How many events of each kind were heard">
          {`${counted(counts.started, 'voice', 'voices')} started; ${String(counts.stolen)} stolen and ${String(counts.rejected)} refused at an emitter's limit; ${String(counts['budget-stolen'])} stolen and ${String(counts['budget-rejected'])} refused for the voice budget; ${String(counts.suppressed)} suppressed by a cooldown.`}
        </Hint>
      </div>
      <div role="status" aria-live="polite" className="ag-visually-hidden">
        {said}
      </div>
      <div className="ag-table-frame">
        <table className="ag-table ag-preview-log-table" aria-labelledby={caption}>
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Emitter</th>
              <th scope="col">Event</th>
              <th scope="col">Member</th>
              <th scope="col">Pitch</th>
              <th scope="col">Gain</th>
              <th scope="col">Offset</th>
              <th scope="col">Bus</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event, index) => (
              <EventRow
                key={index}
                event={event}
                rate={rate}
                project={project}
                emitter={emitters.get(event.emitter)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
