/**
 * One assistant's report in the Analysis panel (ADR-0062), as a card: its
 * glyph, its name and how many things it found, the findings of each kind, the
 * settings its detectors judged by, and what it recommends, the processors in
 * order with Apply, or the silence it would take out. Nothing is applied by
 * being shown: Apply runs the command of that name.
 */

import { useId, type ReactNode } from 'react';

import {
  Badge,
  BadgeTone,
  Button,
  ButtonTone,
  Icon,
  type IconName,
} from '@audiogubbins/design-system';
import type { AssistantReport } from '@audiogubbins/detection-runtime';

import type { Detection } from '../../analysis/detection-control.js';
import { stepName, stepWords } from '../../analysis/detection-words.js';
import type { PanelCommands } from '../command-button.js';
import { commandPress } from '../command-press.js';
import { Findings, positionOf, type Shown } from './analysis-findings.js';
import { DetectorSettings } from './detector-settings.js';
import { Removals } from './silence-removals.js';

/** Why a report's recommendation cannot be applied, where the panel knows before it runs. */
function refusalOf(report: AssistantReport, current: boolean): string | undefined {
  if (!current) {
    return 'The audio has changed since it was analysed. Analyse it again before applying this.';
  }
  return report.learned.find((learned) => learned.kind === 'refused')?.reason;
}

/** Each assistant's glyph, by its key; one this build does not know takes the panel's. */
const ASSISTANT_ICONS: ReadonlyMap<string, IconName> = new Map<string, IconName>([
  ['repair', 'repair'],
  ['restoration', 'enhance'],
  ['silence', 'silence'],
  ['classification', 'classification'],
]);

/**
 * How many things a report found, as a badge: in the warning colour where it
 * recommends a treatment for them, so what wants attention stands out, and
 * marked in the success colour where it found nothing.
 */
function FoundBadge({ report }: { readonly report: AssistantReport }): ReactNode {
  const total = report.found.reduce((sum, { count }) => sum + count, 0);
  if (total === 0) {
    return (
      <Badge tone={BadgeTone.Success} icon="success">
        Nothing found
      </Badge>
    );
  }
  const treats = report.recommendation.steps.length > 0;
  return (
    <Badge tone={treats ? BadgeTone.Warning : BadgeTone.Neutral}>{`${String(total)} found`}</Badge>
  );
}

/** One assistant's report: what it found, what it recommends, and Apply or Remove. */
export function Report({
  report,
  detection,
  shown,
  current,
  commands,
}: {
  readonly report: AssistantReport;
  readonly detection: Detection;
  readonly shown: Shown;
  readonly current: boolean;
  readonly commands: PanelCommands;
}): ReactNode {
  const heading = useId();
  const { findings, steps, removals } = report.recommendation;
  const { found } = report;
  // An assistant that would take frames out, as the silence assistant does,
  // recommends no processor: what it offers is what it would take out.
  const removes = removals.length > 0;
  return (
    <section className="ag-analysis-report" aria-labelledby={heading}>
      <header className="ag-analysis-report-header">
        <span className="ag-analysis-report-glyph">
          <Icon name={ASSISTANT_ICONS.get(report.recommendation.assistant) ?? 'analysis'} />
        </span>
        <h3 className="ag-analysis-report-title" id={heading}>
          {report.label}
        </h3>
        <FoundBadge report={report} />
      </header>
      <Findings findings={findings} found={found} shown={shown} commands={commands} />
      <DetectorSettings
        report={report}
        detection={detection}
        panel={shown.panel}
        commands={commands}
      />
      {removes ? (
        <Removals
          report={report}
          scope={detection.scope}
          shown={shown}
          refusal={refusalOf(report, current)}
          commands={commands}
        />
      ) : steps.length === 0 ? (
        <p className="ag-analysis-note">It recommends nothing.</p>
      ) : (
        <Steps report={report} shown={shown} current={current} commands={commands} />
      )}
    </section>
  );
}

/** The processors a report recommends, in order, each with what it adds, and Apply. */
function Steps({
  report,
  shown,
  current,
  commands,
}: {
  readonly report: AssistantReport;
  readonly shown: Shown;
  readonly current: boolean;
  readonly commands: PanelCommands;
}): ReactNode {
  const { steps } = report.recommendation;
  const { onPress: apply, ...reason } = commandPress(
    commands,
    'analysis.apply',
    { view: shown.panel, assistant: report.recommendation.assistant },
    undefined,
    refusalOf(report, current),
  );
  return (
    <div className="ag-analysis-recommendation">
      <h4 className="ag-analysis-subheading">It recommends, in this order</h4>
      <ol className="ag-analysis-steps">
        {steps.map((step, index) => (
          <li key={step.typeKey} className="ag-analysis-step">
            <span className="ag-analysis-step-name">{stepName(step)}</span>
            {` ${stepWords(step, report.treated[index] ?? [], positionOf(shown))}`}
          </li>
        ))}
      </ol>
      <Button
        compact
        tone={ButtonTone.Primary}
        label={`Apply the ${report.label} recommendation`}
        {...reason}
        onClick={apply}
      >
        Apply
      </Button>
    </div>
  );
}
