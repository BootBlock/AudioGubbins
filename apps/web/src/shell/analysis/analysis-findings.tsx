/**
 * The findings of one assistant's report in the Analysis panel (ADR-0062): a
 * list for each kind, open at first while it is short, each finding with the
 * control that selects its range on the timeline, its channels and its size
 * in words. The control runs the selection command; nothing here writes.
 */

import type { ReactNode } from 'react';

import type { DetectorFinding, FindingKind } from '@audiogubbins/domain';
import type { EditorViewState } from '@audiogubbins/editor-view';
import { formatPosition } from '@audiogubbins/timeline';

import { kindHeading, measureWords } from '../../analysis/detection-words.js';
import { channelNames } from '../../assets/channel-names.js';
import type { EditorAsset } from '../../assets/editor-asset.js';
import { CommandButton, type PanelCommands } from '../command-button.js';

/** A list of findings of one kind open at first only while it is this short. */
const OPEN_UP_TO = 12;

/** The view a panel shows the analysis of: the editor last in use. */
export interface Shown {
  readonly panel: string;
  readonly asset: EditorAsset;
  readonly state: EditorViewState;
}

/** A position of the view, as it writes positions. */
export function positionOf(shown: Shown): (frames: number) => string {
  return (frames) => formatPosition(frames, shown.asset.sampleRate, shown.state.timeFormat);
}

/**
 * What the control that selects a finding is called: its span, or the one
 * position a span shorter than the view writes positions to is at.
 */
function spanLabel(start: string, end: string): string {
  return start === end ? `Select ${start}` : `Select ${start} to ${end}`;
}

/** One finding: its range, which selects it, its channels and its size. */
function FindingRow({
  finding,
  shown,
  commands,
}: {
  readonly finding: DetectorFinding;
  readonly shown: Shown;
  readonly commands: PanelCommands;
}): ReactNode {
  const at = positionOf(shown);
  const names = channelNames(shown.asset.layout);
  const every = finding.channels.length === names.length;
  const channels = every
    ? 'every channel'
    : finding.channels.map((index) => names[index] ?? String(index + 1)).join(', ');
  return (
    <li className="ag-analysis-finding">
      <CommandButton
        id="editor.select-time"
        label={spanLabel(at(finding.range.start), at(finding.range.end))}
        commands={commands}
        tone="quiet"
        compact
        args={{
          view: shown.panel,
          start: finding.range.start,
          end: finding.range.end,
          ...(every ? {} : { channels: finding.channels.join(',') }),
        }}
      />
      <span>{`On ${channels}: ${measureWords(finding)}.`}</span>
    </li>
  );
}

/** The findings of a report, a list of each kind. */
export function Findings({
  findings,
  shown,
  commands,
}: {
  readonly findings: readonly DetectorFinding[];
  readonly shown: Shown;
  readonly commands: PanelCommands;
}): ReactNode {
  if (findings.length === 0) return <p>It found nothing.</p>;
  const byKind = new Map<FindingKind, DetectorFinding[]>();
  for (const finding of findings) {
    const ofKind = byKind.get(finding.kind);
    if (ofKind === undefined) byKind.set(finding.kind, [finding]);
    else ofKind.push(finding);
  }
  return (
    <>
      {[...byKind].map(([kind, ofKind]) => (
        <details key={kind} className="ag-analysis-kind" open={ofKind.length <= OPEN_UP_TO}>
          <summary>{`${kindHeading(kind)}: ${String(ofKind.length)}`}</summary>
          <ul className="ag-analysis-findings">
            {ofKind.map((finding) => (
              <FindingRow
                key={`${String(finding.range.start)}:${String(finding.range.end)}:${finding.channels.join(',')}`}
                finding={finding}
                shown={shown}
                commands={commands}
              />
            ))}
          </ul>
        </details>
      ))}
    </>
  );
}
