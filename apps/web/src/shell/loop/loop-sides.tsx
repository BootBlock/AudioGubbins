/**
 * The two sides of the Loop panel (ADR-0103): the loop as heard, where it lies,
 * its seam, the controls that hear and analyse it and what its analysis found;
 * and the search near it with the candidates it found.
 */

import type { ReactNode } from 'react';

import { ButtonTone, StatusChip, StatusTone, type IconName } from '@audiogubbins/design-system';
import type { LoopRendering } from '@audiogubbins/domain';
import type { LoopAnalysis } from '@audiogubbins/loop-analysis';
import { counted } from '@audiogubbins/text';

import { judgedWords, type RegionLoop } from '../../analysis/loop-analysing.js';
import type { Auditioning } from '../../audio/loop-audition.js';
import type { LoopAnalysisRecord } from '../../state/loop-analysis-store.js';
import type { PanelCommands } from '../command-button.js';
import { HintedCommandButton } from '../hinted-command-button.js';
import { seamCauseWords } from '../inspector/loop-processing-words.js';
import { ChecksTable, worstVerdict } from './checks-table.js';
import { LoopCandidates, type CandidateTarget } from './loop-candidates.js';
import { Hearing, Running, SearchSettings } from './loop-controls.js';
import { millisecondsWords, seamFaulted, shapeWords } from './loop-words.js';
import { SeamView } from './seam-view.js';

/** The region the panel shows, and how it reads. */
export interface Shown {
  /** The editor panel its commands act in. */
  readonly panel: string;
  readonly name: string;
  /** Its loop as heard now, or why it has none to analyse. */
  readonly looped: RegionLoop | string;
  readonly region: string;
  /** A position of the region, as its views write one. */
  readonly position: (frames: number) => string;
  readonly channels: readonly string[];
}

/** The region's loop in a sentence: where it lies, its crossfade, and any shortening of it. */
function loopSentence(looped: RegionLoop, position: (frames: number) => string): string {
  const { loop, sound } = looped;
  const where = `It loops from ${position(loop.loopStart)} to ${position(loop.loopEnd)} of the region`;
  const crossfade =
    loop.crossfadeLength === 0
      ? `${where}, with no crossfade.`
      : `${where}, with a crossfade of ${millisecondsWords(loop.crossfadeLength, sound.sampleRate)} (${counted(loop.crossfadeLength, 'frame', 'frames')}), ${shapeWords(loop.crossfadeShape)}.`;
  const kept = loop.crossfadeClampedFrom;
  return kept === undefined
    ? crossfade
    : `${crossfade} It was set to ${counted(kept, 'frame', 'frames')}; the region now holds too little audio before or within the loop for more.`;
}

/** How the loop's verdict line is drawn for its worst check. */
const VERDICT_LINES: Readonly<
  Record<'fail' | 'warn' | 'pass', { readonly tone: StatusTone; readonly icon: IconName }>
> = {
  fail: { tone: StatusTone.Error, icon: 'check-fails' },
  warn: { tone: StatusTone.Warning, icon: 'warning' },
  pass: { tone: StatusTone.Success, icon: 'check-passes' },
};

/** What an answered analysis found of the loop as heard: its verdict and its checks. */
function Answered({
  analysis,
  shown,
  current,
  rendering,
}: {
  readonly analysis: LoopAnalysis;
  readonly shown: Shown;
  readonly current: boolean;
  /** How the loop renders its effects now (ADR-0107). */
  readonly rendering: LoopRendering | undefined;
}): ReactNode {
  // Said only of an analysis of the sound as it is, whose rendering is the
  // loop's now.
  const cause =
    current && rendering !== undefined && seamFaulted(analysis.current)
      ? seamCauseWords(rendering)
      : undefined;
  const line = VERDICT_LINES[worstVerdict(analysis.current, shown.channels)];
  return (
    <>
      {!current && (
        <p role="status" className="ag-loop-stale">
          The region’s sound has changed since its loop was analysed, so what is shown here is of
          its sound as it was. Analyse it again to see its loop as it is now.
        </p>
      )}
      <StatusChip tone={line.tone} icon={line.icon}>
        {`As heard, the loop ${judgedWords(analysis.current)}.`}
      </StatusChip>
      <ChecksTable
        metrics={analysis.current}
        channels={shown.channels}
        caption="The loop’s checks, as it is heard with its crossfade"
      />
      {cause !== undefined && <p className="ag-loop-note">{cause}</p>}
    </>
  );
}

/** The analysis of the region's loop, where it has one this session. */
export interface Analysed {
  readonly record: LoopAnalysisRecord | undefined;
  /** Whether the analysis is of the region's sound as it is now. */
  readonly current: boolean;
}

/** What an analysis of the region's loop is doing, or what it came to. */
function AnalysisState({
  analysed,
  shown,
  looped,
  commands,
}: {
  readonly analysed: Analysed;
  readonly shown: Shown;
  readonly looped: RegionLoop;
  readonly commands: PanelCommands;
}): ReactNode {
  const { record } = analysed;
  if (record === undefined) {
    return <p className="ag-loop-note">Its loop has not been analysed this session.</p>;
  }
  switch (record.kind) {
    case 'running':
      return <Running record={record} shown={shown} commands={commands} />;
    case 'failed':
      return (
        <p role="status" className="ag-loop-stale">
          {`Its loop could not be analysed. ${record.reason}`}
        </p>
      );
    case 'done':
      return (
        <Answered
          analysis={record.analysis}
          shown={shown}
          current={analysed.current}
          rendering={looped.rendering}
        />
      );
  }
}

/** The loop as heard: where it lies, its seam, the controls that hear and analyse it, and its checks. */
export function HeardSide({
  shown,
  looped,
  analysed,
  audition,
  commands,
}: {
  readonly shown: Shown;
  readonly looped: RegionLoop;
  readonly analysed: Analysed;
  readonly audition: Auditioning | undefined;
  readonly commands: PanelCommands;
}): ReactNode {
  const { record } = analysed;
  return (
    <div className="ag-loop-side">
      <p className="ag-loop-sentence">{loopSentence(looped, shown.position)}</p>
      {record?.kind === 'done' && <SeamView analysis={record.analysis} channels={shown.channels} />}
      <Hearing shown={shown} audition={audition} commands={commands} />
      <span>
        <HintedCommandButton
            id="loop.analyse"
            label="Analyse the loop"
            icon="analyse"
            commands={commands}
            args={{ view: shown.panel, region: shown.region }}
          tone={ButtonTone.Primary}
          compact
        />
      </span>
      <AnalysisState analysed={analysed} shown={shown} looped={looped} commands={commands} />
    </div>
  );
}

/** The search near the loop, and the candidates it found. */
export function SearchSide({
  shown,
  analysed,
  commands,
}: {
  readonly shown: Shown;
  readonly analysed: Analysed;
  readonly commands: PanelCommands;
}): ReactNode {
  const { record } = analysed;
  const target: CandidateTarget = {
    view: shown.panel,
    region: shown.region,
    refusal: analysed.current
      ? undefined
      : 'The region’s sound has changed since its loop was analysed. Analyse it again first.',
  };
  return (
    <div className="ag-loop-side">
      <SearchSettings shown={shown} commands={commands} />
      {record?.kind === 'done' && record.request.search !== undefined && (
        <LoopCandidates
          candidates={record.analysis.candidates}
          sampleRate={record.analysis.sampleRate}
          channels={shown.channels}
          position={shown.position}
          target={target}
          commands={commands}
        />
      )}
    </div>
  );
}
