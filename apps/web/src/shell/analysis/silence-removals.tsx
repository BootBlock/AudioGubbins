/**
 * The silence a report would take out, in the Analysis panel: the stretches at
 * the edges of what was analysed and the long pauses within it, each part
 * counted, with the command that removes it. Nothing is removed by being
 * shown; the controls run `analysis.remove-silence`.
 */

import type { ReactNode } from 'react';

import { Button, List, ListRow } from '@audiogubbins/design-system';

import {
  silenceRemovals,
  type AssistantReport,
  type DetectionScope,
  type SilencePart,
} from '@audiogubbins/detection-runtime';
import { counted } from '@audiogubbins/text';

import type { PanelCommands } from '../command-button.js';
import { commandPress } from '../command-press.js';
import type { Shown } from './analysis-findings.js';

/** How each part of the silence is offered: what is taken out, and its control's words. */
const REMOVALS: readonly {
  readonly part: SilencePart;
  readonly one: string;
  readonly many: string;
  readonly label: string;

  /** The button's face: the label's verb, which the label begins with. */
  readonly face: string;
}[] = [
  {
    part: 'edges',
    one: 'silent stretch at an edge',
    many: 'silent stretches at the edges',
    label: 'Trim the silence at the edges',
    face: 'Trim',
  },
  {
    part: 'within',
    one: 'long pause, shortened to the pause kept',
    many: 'long pauses, each shortened to the pause kept',
    label: 'Shorten the long pauses',
    face: 'Shorten',
  },
];

/** The silence a report would take out, by part, each with the command that removes it. */
export function Removals({
  report,
  scope,
  shown,
  refusal,
  commands,
}: {
  readonly report: AssistantReport;
  readonly scope: DetectionScope;
  readonly shown: Shown;
  /** Why the silence cannot be removed now, where the panel knows before the command runs. */
  readonly refusal: string | undefined;
  readonly commands: PanelCommands;
}): ReactNode {
  const offered = REMOVALS.map((removal) => ({
    ...removal,
    count: silenceRemovals(report, scope, removal.part).length,
  })).filter(({ count }) => count > 0);
  return (
    <div className="ag-analysis-recommendation">
      <h4 className="ag-analysis-subheading">It would take out, as trim and delete edits</h4>
      <List>
        {offered.map(({ part, one, many, label, face, count }) => {
          const { onPress: remove, ...reason } = commandPress(
            commands,
            'analysis.remove-silence',
            { view: shown.panel, part },
            undefined,
            refusal,
          );
          return (
            <ListRow
              key={part}
              name={`${counted(count, one, many)}.`}
              actions={
                <Button compact label={label} {...reason} onClick={remove}>
                  {face}
                </Button>
              }
            />
          );
        })}
      </List>
    </div>
  );
}
