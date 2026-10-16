/**
 * The preview's event log as a table (ADR-0104): each trigger and voice the
 * listener has heard, newest last, with the member, pitch, gain, offset and bus
 * each start chose; and a polite count of them said at most once a second, so
 * a rapid run is not read out event by event.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';

import type { Project } from '@audiogubbins/domain';
import type { PreviewEmitterId, PreviewEvent } from '@audiogubbins/game-audio';
import { counted } from '@audiogubbins/text';

import type { EventCounts } from '../../state/game-preview-store.js';
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

/** The time of `frame` at `rate`, in seconds to the millisecond. */
function timeOf(frame: number, rate: number): string {
  return `${(frame / rate).toFixed(3)} s`;
}

export function EventLog({
  events,
  counts,
  rate,
  project,
  emitterNames,
}: {
  readonly events: readonly PreviewEvent[];
  readonly counts: EventCounts;
  readonly rate: number;
  readonly project: Project;
  readonly emitterNames: ReadonlyMap<PreviewEmitterId, string>;
}): ReactNode {
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const said = useCountSaid(total);
  return (
    <div className="ag-preview-log">
      <p className="ag-panel-note">
        {`${counted(counts.started, 'voice', 'voices')} started; ${String(counts.stolen)} stolen and ${String(counts.rejected)} refused at an emitter's limit; ${String(counts['budget-stolen'])} stolen and ${String(counts['budget-rejected'])} refused for the voice budget; ${String(counts.suppressed)} suppressed by a cooldown.`}
      </p>
      <div role="status" aria-live="polite" className="ag-visually-hidden">
        {said}
      </div>
      <table className="ag-preview-log-table">
        <caption>{`The latest ${counted(events.length, 'event', 'events')} heard, oldest first`}</caption>
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
            <tr key={index} data-kind={event.kind}>
              <td>{timeOf(event.frame, rate)}</td>
              <td>{emitterNames.get(event.emitter) ?? event.emitter}</td>
              <td>{`${eventWords(event)}${'trigger' in event ? `, trigger ${String(event.trigger + 1)}` : `, voice ${String(event.voice + 1)}`}`}</td>
              <td>{event.kind === 'started' ? memberName(project, event.member) : ''}</td>
              <td>{event.kind === 'started' ? signed(event.pitchCents, 'cents') : ''}</td>
              <td>{event.kind === 'started' ? signed(event.gainDecibels, 'dB', 1) : ''}</td>
              <td>{event.kind === 'started' ? `${String(event.offsetFrames)} frames` : ''}</td>
              <td>{event.kind === 'started' ? (event.bus ?? 'Master') : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
