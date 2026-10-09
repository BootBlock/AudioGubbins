/**
 * The Analysis panel (ADR-0062): what the assistants found in the audio of
 * the editor in use, and what each recommends. Each finding is shown with its
 * kind, its range, which a person can select on the timeline, its channels
 * and its size in words; each recommendation with its steps in order and what
 * each would add, and the silence it would take out, at the edges and within.
 * Nothing is applied by being shown: Apply and Remove run the commands of
 * those names, which make the change through the project's commands.
 *
 * The findings of a report are listed by `analysis-findings.tsx`. It reads the
 * stores and runs commands; it writes nothing itself (`CLAUDE.md` G2), and it
 * follows every change to them, an edit that makes what it shows stale
 * included. Lists are keyed by what each item is, so a detection that answers
 * again updates them in place.
 */

import { useId, useSyncExternalStore, type ReactNode } from 'react';

import type { AssistantReport } from '@audiogubbins/detection-runtime';

import {
  detectionIdentity,
  type Detection,
  type Detections,
} from '../../analysis/detection-control.js';
import { stepName, stepWords } from '../../analysis/detection-words.js';
import type { EditorPanelParts } from '../../editor/panel-parts.js';
import type { AssetCatalogue } from '../../state/asset-catalogue.js';
import type { AudioSettings } from '../../state/audio-settings-store.js';
import type { Observable } from '../../state/observable.js';
import { CommandButton, type PanelCommands } from '../command-button.js';
import { Findings, positionOf, type Shown } from './analysis-findings.js';
import { DetectorSettings } from './detector-settings.js';
import { Removals } from './silence-removals.js';

/** What the Analysis panel reads. */
export interface AnalysisParts {
  readonly editorViews: EditorPanelParts['stores']['editorViews'];
  readonly assets: Pick<AssetCatalogue, 'get' | 'subscribe' | 'find'>;
  readonly detection: Observable<Detections>;
  /** The render quality, whose sound a detection hears. */
  readonly audioSettings: Observable<Pick<AudioSettings, 'renderQuality'>>;
}

/** Reads the editor last in use, its detection, and whether that is of its audio as it is now. */
function useShown(parts: AnalysisParts): {
  readonly shown: Shown | undefined;
  readonly detection: Detection | undefined;
  readonly current: boolean;
} {
  const { editorViews, assets, detection, audioSettings } = parts;
  const views = useSyncExternalStore(editorViews.subscribe, editorViews.get);
  useSyncExternalStore(assets.subscribe, assets.get);
  const detections = useSyncExternalStore(detection.subscribe, detection.get);
  const { renderQuality } = useSyncExternalStore(audioSettings.subscribe, audioSettings.get);
  const panel = views.focused;
  const entry = panel === undefined ? undefined : editorViews.entry(panel);
  const asset = entry === undefined ? undefined : assets.find(entry.asset);
  if (panel === undefined || entry === undefined || asset === undefined) {
    return { shown: undefined, detection: undefined, current: false };
  }
  const found = detections.get(asset.id);
  return {
    shown: { panel, asset, state: entry.state },
    detection: found,
    current: found?.identity === detectionIdentity(asset, renderQuality),
  };
}

/** Why a report's recommendation cannot be applied, where the panel knows before it runs. */
function refusalOf(report: AssistantReport, current: boolean): string | undefined {
  if (!current) {
    return 'The audio has changed since it was analysed. Analyse it again before applying this.';
  }
  return report.learned.find((learned) => learned.kind === 'refused')?.reason;
}

/** One assistant's report: what it found, what it recommends, and Apply or Remove. */
function Report({
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
      <h3 className="ag-analysis-heading" id={heading}>
        {report.label}
      </h3>
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
        <p className="ag-panel-note">It recommends nothing.</p>
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
  return (
    <>
      <h4 className="ag-analysis-heading">It recommends, in this order</h4>
      <ol className="ag-analysis-steps">
        {steps.map((step, index) => (
          <li key={step.typeKey}>
            <span className="ag-analysis-step-name">{stepName(step)}</span>
            {` ${stepWords(step, report.treated[index] ?? [], positionOf(shown))}`}
          </li>
        ))}
      </ol>
      <CommandButton
        id="analysis.apply"
        label={`Apply the ${report.label} recommendation`}
        commands={commands}
        args={{ view: shown.panel, assistant: report.recommendation.assistant }}
        refusal={refusalOf(report, current)}
      />
    </>
  );
}

/** How far a running detection has read, and the command that stops it. */
function RunningDetection({
  detection,
  what,
  shown,
  commands,
}: {
  readonly detection: Extract<Detection, { readonly kind: 'running' }>;
  readonly what: string;
  readonly shown: Shown;
  readonly commands: PanelCommands;
}): ReactNode {
  // Said in tenths, so a screen reader hears it move without being read every
  // chunk.
  const tenths =
    detection.framesTotal === 0
      ? 0
      : Math.floor((detection.framesRead / detection.framesTotal) * 10) * 10;
  return (
    <>
      <progress
        className="ag-render-progress"
        aria-label="Analysis progress"
        max={detection.framesTotal}
        value={detection.framesRead}
      />
      <p role="status" className="ag-panel-note">
        {`Analysing ${what}: ${String(tenths)}%`}
      </p>
      <CommandButton
        id="analysis.cancel"
        label="Stop analysing"
        commands={commands}
        args={{ view: shown.panel }}
      />
    </>
  );
}

/** What a detection of the view is doing, or what it came to. */
function DetectionState({
  detection,
  shown,
  current,
  commands,
}: {
  readonly detection: Detection | undefined;
  readonly shown: Shown;
  readonly current: boolean;
  readonly commands: PanelCommands;
}): ReactNode {
  if (detection === undefined) {
    return <p className="ag-panel-note">It has not been analysed this session.</p>;
  }
  const at = positionOf(shown);
  const what = detection.scope.whole
    ? 'all of it'
    : `from ${at(detection.scope.range.start)} to ${at(detection.scope.range.end)}`;
  switch (detection.kind) {
    case 'running':
      return (
        <RunningDetection detection={detection} what={what} shown={shown} commands={commands} />
      );
    case 'failed':
      return <p role="status">{`It could not be analysed. ${detection.reason}`}</p>;
    case 'done':
      return (
        <>
          <p className="ag-panel-note">{`Analysed ${what}.`}</p>
          {!current && (
            <p role="status">
              The audio has changed since it was analysed, so what is shown here is of the audio as
              it was. Analyse it again to see what it holds now.
            </p>
          )}
          {detection.result.reports.map((report) => (
            <Report
              key={report.recommendation.assistant}
              report={report}
              detection={detection}
              shown={shown}
              current={current}
              commands={commands}
            />
          ))}
        </>
      );
  }
}

/** The Analysis panel. */
export function AnalysisPanel({
  title,
  parts,
  commands,
}: {
  readonly title: string;
  readonly parts: AnalysisParts;
  readonly commands: PanelCommands;
}): ReactNode {
  const { shown, detection, current } = useShown(parts);
  return (
    <section className="ag-panel ag-analysis">
      <h2 className="ag-panel-title">{title}</h2>
      {shown === undefined ? (
        <p>Open audio in an editor to analyse it here.</p>
      ) : (
        <>
          <p className="ag-editor-asset-name">{shown.asset.name}</p>
          <p className="ag-panel-note">
            The assistants analyse the selection, or all of it with nothing selected, and recommend
            what would treat what they find. Nothing changes until you apply a recommendation.
          </p>
          <CommandButton
            id="analysis.detect"
            label="Analyse the audio"
            commands={commands}
            args={{ view: shown.panel }}
          />
          <DetectionState
            detection={detection}
            shown={shown}
            current={current}
            commands={commands}
          />
        </>
      )}
    </section>
  );
}
