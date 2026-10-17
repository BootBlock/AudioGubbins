/**
 * The Analysis panel (ADR-0062): what the assistants found in the audio of
 * the editor in use, and what each recommends. Each finding is shown with its
 * kind, its range, which a person can select on the timeline, its channels
 * and its size in words; each recommendation with its steps in order and what
 * each would add, and the silence it would take out, at the edges and within.
 * Nothing is applied by being shown: Apply and Remove run the commands of
 * those names, which make the change through the project's commands.
 *
 * Each assistant's report is a card of `analysis-report.tsx`, its findings
 * listed by `analysis-findings.tsx`. The panel reads the
 * stores and runs commands; it writes nothing itself (`CLAUDE.md` G2), and it
 * follows every change to them, an edit that makes what it shows stale
 * included. Lists are keyed by what each item is, so a detection that answers
 * again updates them in place.
 */

import { useSyncExternalStore, type ReactNode } from 'react';

import {
  Banner,
  BannerTone,
  Button,
  ButtonTone,
  EmptyState,
  Hint,
  Icon,
  ProgressBar,
} from '@audiogubbins/design-system';

import {
  detectionIdentity,
  type Detection,
  type Detections,
} from '../../analysis/detection-control.js';
import type { EditorPanelParts } from '../../editor/panel-parts.js';
import type { AssetCatalogue } from '../../state/asset-catalogue.js';
import type { AudioSettings } from '../../state/audio-settings-store.js';
import type { Observable } from '../../state/observable.js';
import type { PanelCommands } from '../command-button.js';
import { commandPress } from '../command-press.js';
import { positionOf, type Shown } from './analysis-findings.js';
import { Report } from './analysis-report.js';

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
  const { onPress: stop, ...reason } = commandPress(commands, 'analysis.cancel', {
    view: shown.panel,
  });
  return (
    <div className="ag-analysis-running">
      <p role="status" className="ag-analysis-running-text">
        {`Analysing ${what}: ${String(tenths)}%`}
      </p>
      <Button compact {...reason} onClick={stop}>
        Stop analysing
      </Button>
      <ProgressBar
        label="Analysis progress"
        value={detection.framesTotal === 0 ? 0 : detection.framesRead / detection.framesTotal}
      />
    </div>
  );
}

/** What was analysed of the view, in words: all of it, or the range. */
function scopeWords(detection: Detection, shown: Shown): string {
  const at = positionOf(shown);
  return detection.scope.whole
    ? 'all of it'
    : `from ${at(detection.scope.range.start)} to ${at(detection.scope.range.end)}`;
}

/** The line under the audio's name: whether it has been analysed, and what of it. */
function analysedLine(detection: Detection | undefined, shown: Shown): string | undefined {
  if (detection === undefined) return 'It has not been analysed this session.';
  return detection.kind === 'done' ? `Analysed ${scopeWords(detection, shown)}.` : undefined;
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
  if (detection === undefined) return null;
  const what = scopeWords(detection, shown);
  switch (detection.kind) {
    case 'running':
      return (
        <RunningDetection detection={detection} what={what} shown={shown} commands={commands} />
      );
    case 'failed':
      return (
        <div role="status" className="ag-analysis-notice">
          <Banner tone={BannerTone.Error} icon="error">
            {`It could not be analysed. ${detection.reason}`}
          </Banner>
        </div>
      );
    case 'done':
      return (
        <>
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
          {!current && (
            <div role="status" className="ag-analysis-notice">
              <Banner tone={BannerTone.Warning} icon="analyse-again">
                The audio has changed since it was analysed, so what is shown here is of the audio
                as it was. Analyse it again to see what it holds now.
              </Banner>
            </div>
          )}
        </>
      );
  }
}

/** The audio shown, whether and what of it was analysed, what analysing does, and Analyse. */
function Subject({
  shown,
  detection,
  commands,
}: {
  readonly shown: Shown;
  readonly detection: Detection | undefined;
  readonly commands: PanelCommands;
}): ReactNode {
  const line = analysedLine(detection, shown);
  const { onPress: analyse, ...reason } = commandPress(commands, 'analysis.detect', {
    view: shown.panel,
  });
  return (
    <div className="ag-analysis-subject">
      <div className="ag-analysis-subject-text">
        <p className="ag-editor-asset-name ag-analysis-asset-name">{shown.asset.name}</p>
        {line !== undefined && <p className="ag-analysis-analysed">{line}</p>}
      </div>
      <Hint label="About analysis">
        The assistants analyse the selection, or all of it with nothing selected, and recommend what
        would treat what they find. Nothing changes until you apply a recommendation.
      </Hint>
      <Button
        compact
        tone={ButtonTone.Primary}
        label="Analyse the audio"
        {...reason}
        onClick={analyse}
      >
        <Icon name="analyse" />
        Analyse
      </Button>
    </div>
  );
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
        <EmptyState
          icon="analysis"
          title="No audio open"
          text="Open audio in an editor to analyse it here."
        />
      ) : (
        <>
          <Subject shown={shown} detection={detection} commands={commands} />
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
