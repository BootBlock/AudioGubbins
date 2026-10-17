/**
 * The findings of one assistant's report in the Analysis panel (ADR-0062): a
 * list for each kind, open at first while it is short, each finding with the
 * control that selects its range on the timeline, its channels and its size
 * in words. The control runs the selection command; nothing here writes.
 *
 * A report holds the first findings of each kind and says how many there
 * were (`MOST_FINDINGS_SHOWN`), and the list says how many it leaves out. A
 * kind is a section, whose rows are made only once it is opened (a closed
 * section holds no content), so a closed list of hundreds costs the page
 * nothing.
 */

import { useState, type ReactNode } from 'react';

import { IconButton, List, ListRow, Section } from '@audiogubbins/design-system';

import type { KindCount } from '@audiogubbins/detection-runtime';
import type { DetectorFinding, FindingKind } from '@audiogubbins/domain';
import { counted } from '@audiogubbins/text';
import type { EditorViewState } from '@audiogubbins/editor-view';
import { formatPosition } from '@audiogubbins/timeline';

import { kindHeading, measureWords } from '../../analysis/detection-words.js';
import { channelNames } from '../../assets/channel-names.js';
import type { EditorAsset } from '../../assets/editor-asset.js';
import type { PanelCommands } from '../command-button.js';
import { commandPress } from '../command-press.js';

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
  const start = at(finding.range.start);
  const { onPress: select, ...reason } = commandPress(commands, 'editor.select-time', {
    view: shown.panel,
    start: finding.range.start,
    end: finding.range.end,
    ...(every ? {} : { channels: finding.channels.join(',') }),
  });
  return (
    <ListRow
      name={start}
      detail={`On ${channels}: ${measureWords(finding)}.`}
      actions={
        <IconButton
          compact
          icon="locate"
          label={spanLabel(start, at(finding.range.end))}
          {...reason}
          onClick={select}
        />
      }
    />
  );
}

/** The findings of one kind: `count` of them, of which `ofKind` are held. */
function KindList({
  kind,
  count,
  ofKind,
  shown,
  commands,
}: {
  readonly kind: FindingKind;
  readonly count: number;
  readonly ofKind: readonly DetectorFinding[];
  readonly shown: Shown;
  readonly commands: PanelCommands;
}): ReactNode {
  const [open, setOpen] = useState(count <= OPEN_UP_TO);
  const left = count - ofKind.length;
  return (
    <Section title={`${kindHeading(kind)}: ${String(count)}`} open={open} onOpenChange={setOpen}>
      <div className="ag-analysis-kind">
        <List label={kindHeading(kind)}>
          {ofKind.map((finding) => (
            <FindingRow
              key={`${String(finding.range.start)}:${String(finding.range.end)}:${finding.channels.join(',')}`}
              finding={finding}
              shown={shown}
              commands={commands}
            />
          ))}
        </List>
        {left > 0 ? (
          <p className="ag-analysis-note">
            {`The first ${String(ofKind.length)} are listed, and ${counted(left, 'more is', 'more are')} left out. Analyse a shorter range to list them.`}
          </p>
        ) : null}
      </div>
    </Section>
  );
}

/** The findings of a report, a list of each kind, `found` saying how many of each there are. */
export function Findings({
  findings,
  found,
  shown,
  commands,
}: {
  readonly findings: readonly DetectorFinding[];
  readonly found: readonly KindCount[];
  readonly shown: Shown;
  readonly commands: PanelCommands;
}): ReactNode {
  if (found.length === 0) return <p className="ag-analysis-note">It found nothing.</p>;
  return (
    <>
      {found.map(({ kind, count }) => (
        <KindList
          key={kind}
          kind={kind}
          count={count}
          ofKind={findings.filter((finding) => finding.kind === kind)}
          shown={shown}
          commands={commands}
        />
      ))}
    </>
  );
}
