import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, expectTypeOf, it } from 'vitest';

import type { CommandInvocation } from '@audiogubbins/commands';
import {
  FindingKind,
  MeasureUnit,
  derivedSampleCount,
  type DetectorFinding,
} from '@audiogubbins/domain';
import type { DetectionResult } from '@audiogubbins/detection-runtime';

import {
  detectionIdentity,
  type Detection,
  type Detections,
} from '../../analysis/detection-control.js';
import type { EditorAsset } from '../../assets/editor-asset.js';
import type { ShellContext } from '../../commands/shell-context.js';
import { observable, type Observable } from '../../state/observable.js';
import { buildShellContext } from '../../testing/shell-context.js';
import { AnalysisPanel, type AnalysisParts } from './analysis-panel.js';

const range = (start: number, end: number) => ({
  start: derivedSampleCount(start),
  end: derivedSampleCount(end),
});

/** A click at `at`, treated by a de-click. */
function click(at: number): DetectorFinding {
  return {
    kind: FindingKind.Click,
    range: range(at, at + 12),
    channels: [0, 1],
    measure: { value: 30.46, unit: MeasureUnit.Decibels },
    treatment: { kind: 'steps', steps: [{ typeKey: 'de-click', values: { sensitivity: 8 } }] },
  };
}

/** What the repair and classification assistants answered over 48,000 frames. */
const RESULT: DetectionResult = {
  frames: 48_000,
  reports: [
    {
      label: 'Repair',
      recommendation: {
        assistant: 'repair',
        detectors: [{ key: 'clicks', label: 'Clicks', version: 1 }],
        findings: [click(12_000), click(36_000)],
        steps: [{ typeKey: 'de-click', values: { sensitivity: 8 } }],
      },
      learned: [{ kind: 'none' }],
      found: [{ kind: FindingKind.Click, count: 2 }],
      treated: [[{ kind: FindingKind.Click, count: 2 }]],
    },
    {
      label: 'Classification',
      recommendation: {
        assistant: 'classification',
        detectors: [{ key: 'transients', label: 'Transients', version: 1 }],
        findings: [],
        steps: [],
      },
      learned: [],
      found: [],
      treated: [],
    },
  ],
};

/** The session with the tone bursts open in the editor in use, and the asset shown. */
function session(): { readonly context: ShellContext; readonly asset: EditorAsset } {
  const { context } = buildShellContext();
  const asset = context.assets.find('test:tone-bursts');
  if (asset === undefined) throw new Error('The test asset is missing.');
  context.editorViews.open('editor', asset);
  context.editorViews.focus('editor');
  return { context, asset };
}

/** A detection of all of `asset` as it is, at the session's render quality. */
function detectionOf(context: ShellContext, asset: EditorAsset): Omit<Detection, 'kind'> {
  return {
    target: asset.id,
    name: asset.name,
    scope: { range: range(0, asset.length), whole: true },
    identity: detectionIdentity(asset, context.audioSettings.get().renderQuality),
    assistants: ['repair', 'classification'],
  };
}

/** Draws the panel over `detections`, its commands recorded rather than run. */
function panelOver(
  context: ShellContext,
  detections: Observable<Detections>,
): { readonly ran: (readonly [string, CommandInvocation['arguments']])[] } {
  const ran: (readonly [string, CommandInvocation['arguments']])[] = [];
  render(
    <AnalysisPanel
      title="Analysis"
      parts={{
        editorViews: context.editorViews,
        assets: context.assets,
        detection: detections,
        audioSettings: context.audioSettings,
      }}
      commands={{
        run: (id, args) => {
          ran.push([id, args]);
        },
        unavailableReason: () => undefined,
      }}
    />,
  );
  return { ran };
}

/** The findings of a kind a report holds at most, of however many it found. */
const HELD = 200;

describe('the Analysis panel', () => {
  it('reads the detections and cannot write them, changing anything only by a command', () => {
    expectTypeOf<AnalysisParts['detection']>().toEqualTypeOf<Observable<Detections>>();
  });

  it('shows each finding with its range, channels and size, and each step with what it adds', () => {
    const { context, asset } = session();
    const done: Detection = { ...detectionOf(context, asset), kind: 'done', result: RESULT };
    panelOver(context, observable<Detections>(new Map([[asset.id, done]])));

    const repair = screen.getByRole('region', { name: 'Repair' });
    expect(within(repair).getByText('Clicks: 2')).toBeInTheDocument();
    const rows = within(repair).getAllByRole('listitem').slice(0, 2);
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('On every channel: 30.5 dB above the music around it.'),
      expect.stringContaining('On every channel: 30.5 dB above the music around it.'),
    ]);
    expect(within(repair).getByText(/for the 2 clicks found\./u).textContent).toBe(
      'De-click A de-click at sensitivity 8, for the 2 clicks found.',
    );
    const classification = screen.getByRole('region', { name: 'Classification' });
    expect(within(classification).getByText('It found nothing.')).toBeInTheDocument();
    expect(within(classification).getByText('It recommends nothing.')).toBeInTheDocument();
    expect(
      within(classification).queryByRole('button', { name: /Apply/u }),
    ).not.toBeInTheDocument();
  });

  it('lists a long kind only once it is opened, saying how many of its findings the report leaves out', async () => {
    const { context, asset } = session();
    const held = Array.from({ length: HELD }, (_, index) => click(index * 100));
    const [repair] = RESULT.reports;
    if (repair === undefined) throw new Error('The result has a repair report.');
    const many: DetectionResult = {
      ...RESULT,
      reports: [
        {
          ...repair,
          recommendation: { ...repair.recommendation, findings: held },
          found: [{ kind: FindingKind.Click, count: 5_000 }],
          treated: [[{ kind: FindingKind.Click, count: 4_990 }]],
        },
      ],
    };
    const done: Detection = { ...detectionOf(context, asset), kind: 'done', result: many };
    panelOver(context, observable<Detections>(new Map([[asset.id, done]])));

    const region = screen.getByRole('region', { name: 'Repair' });
    const summary = within(region).getByText('Clicks: 5000');
    // Every row was drawn on the page's thread whether or not anyone looked.
    expect(within(region).queryAllByRole('button', { name: /^Select / })).toHaveLength(0);
    expect(within(region).getByText(/for the 4990 clicks found\./u)).toBeInTheDocument();

    await userEvent.click(summary);

    expect(within(region).getAllByRole('button', { name: /^Select / })).toHaveLength(HELD);
    expect(
      within(region).getByText(
        `The first ${String(HELD)} are listed, and ${String(5_000 - HELD)} more are left out. Analyse a shorter range to list them.`,
      ),
    ).toBeInTheDocument();
  });

  it('runs the commands its controls name, and writes nothing itself', async () => {
    const { context, asset } = session();
    const done: Detection = { ...detectionOf(context, asset), kind: 'done', result: RESULT };
    const detections = observable<Detections>(new Map([[asset.id, done]]));
    const before = detections.get();
    const { ran } = panelOver(context, detections);

    await userEvent.click(screen.getByRole('button', { name: 'Apply the Repair recommendation' }));
    const [select] = screen.getAllByRole('button', { name: /^Select / });
    if (select === undefined) throw new Error('No finding can be selected.');
    // A click twelve frames long starts and ends at one position as the view
    // writes positions, so its control names that position once.
    expect(select).toHaveAccessibleName(/^Select \S+$/u);
    await userEvent.click(select);
    await userEvent.click(screen.getByRole('button', { name: 'Analyse the audio' }));

    expect(ran).toEqual([
      ['analysis.apply', { view: 'editor', assistant: 'repair' }],
      ['editor.select-time', { view: 'editor', start: 12_000, end: 12_012 }],
      ['analysis.detect', { view: 'editor' }],
    ]);
    expect(detections.get()).toBe(before);
  });

  it('says when the audio has changed since, and refuses to apply what was found in it', async () => {
    const { context, asset } = session();
    const stale: Detection = {
      ...detectionOf(context, asset),
      identity: 'audio as it was before an edit',
      kind: 'done',
      result: RESULT,
    };
    const { ran } = panelOver(context, observable<Detections>(new Map([[asset.id, stale]])));

    expect(
      screen.getByText(/The audio has changed since it was analysed, so/u),
    ).toBeInTheDocument();
    const apply = screen.getByRole('button', { name: 'Apply the Repair recommendation' });
    expect(apply).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(apply);
    expect(ran).toEqual([]);
  });

  it('shows a detection running with its progress, and stops it by its command', async () => {
    const { context, asset } = session();
    const detections = observable<Detections>(
      new Map([
        [
          asset.id,
          { ...detectionOf(context, asset), kind: 'running', framesRead: 0, framesTotal: 1000 },
        ],
      ]),
    );
    const { ran } = panelOver(context, detections);

    act(() => {
      detections.set(
        new Map([
          [
            asset.id,
            { ...detectionOf(context, asset), kind: 'running', framesRead: 450, framesTotal: 1000 },
          ],
        ]),
      );
    });

    expect(screen.getByRole('progressbar', { name: 'Analysis progress' })).toHaveAttribute(
      'value',
      '450',
    );
    expect(screen.getByRole('status')).toHaveTextContent('Analysing all of it: 40%');
    await userEvent.click(screen.getByRole('button', { name: 'Stop analysing' }));
    expect(ran).toEqual([['analysis.cancel', { view: 'editor' }]]);
  });
});
