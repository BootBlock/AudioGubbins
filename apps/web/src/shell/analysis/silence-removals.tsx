/**
 * The silence a report would take out, in the Analysis panel: the stretches at
 * the edges of what was analysed and the long pauses within it, each part
 * counted, with the command that removes it. Nothing is removed by being
 * shown; the controls run `analysis.remove-silence`.
 */

import type { ReactNode } from 'react';

import type { AssistantReport } from '@audiogubbins/detection-runtime';
import { counted } from '@audiogubbins/text';

import {
  silenceRemovals,
  type DetectionScope,
  type SilencePart,
} from '../../analysis/detection-control.js';
import { CommandButton, type PanelCommands } from '../command-button.js';
import type { Shown } from './analysis-findings.js';

/** How each part of the silence is offered: what is taken out, and its control's words. */
const REMOVALS: readonly {
  readonly part: SilencePart;
  readonly one: string;
  readonly many: string;
  readonly label: string;
}[] = [
  {
    part: 'edges',
    one: 'silent stretch at an edge',
    many: 'silent stretches at the edges',
    label: 'Trim the silence at the edges',
  },
  {
    part: 'within',
    one: 'long pause, shortened to the pause kept',
    many: 'long pauses, each shortened to the pause kept',
    label: 'Shorten the long pauses',
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
    <>
      <h4 className="ag-analysis-heading">It would take out, as trim and delete edits</h4>
      <ul className="ag-analysis-steps">
        {offered.map(({ part, one, many, label, count }) => (
          <li key={part}>
            {`${counted(count, one, many)}. `}
            <CommandButton
              id="analysis.remove-silence"
              label={label}
              commands={commands}
              args={{ view: shown.panel, part }}
              refusal={refusal}
            />
          </li>
        ))}
      </ul>
    </>
  );
}
