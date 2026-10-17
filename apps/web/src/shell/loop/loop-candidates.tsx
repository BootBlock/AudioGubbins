/**
 * The candidate loop points a search found (ADR-0103), best first: where each
 * would put the loop, how far it moves each point, how it is judged, the
 * micro-crossfade suggested for it, and its checks in full on request. Each
 * can be heard, alone or with its crossfade, and applied only by the person
 * pressing Apply, which runs the region's loop command: one step of the
 * history, which undo reverses.
 */

import { useId, type ReactNode } from 'react';

import { ButtonTone, Section } from '@audiogubbins/design-system';
import type { LoopCandidate } from '@audiogubbins/loop-analysis';

import { judgedWords } from '../../analysis/loop-analysing.js';
import { CommandButton, type PanelCommands } from '../command-button.js';
import { ChecksTable } from './checks-table.js';
import { candidateMoveWords, suggestionWords } from './loop-words.js';

/** What a candidate's controls name: the view they act in and the region whose loop they move. */
export interface CandidateTarget {
  readonly view: string;
  readonly region: string;
  /** Why none can be heard or applied, where the panel knows: an analysis gone stale. */
  readonly refusal: string | undefined;
}

/** A candidate's hearing: alone, and with its suggested crossfade where it has one. */
function CandidateHearing({
  candidate,
  target,
  commands,
}: {
  readonly candidate: LoopCandidate;
  readonly target: CandidateTarget;
  readonly commands: PanelCommands;
}): ReactNode {
  const rank = String(candidate.rank);
  const args = { view: target.view, region: target.region, rank: candidate.rank };
  return (
    <span className="ag-loop-candidate-hearing">
      <CommandButton
        id="loop.audition-candidate"
        label={`Hear candidate ${rank}`}
        commands={commands}
        args={args}
        refusal={target.refusal}
        compact
        iconOnly
      />
      {candidate.crossfade !== undefined && (
        <CommandButton
          id="loop.audition-candidate"
          icon="audition-crossfade"
          label={`Hear candidate ${rank} with its crossfade`}
          commands={commands}
          args={{ ...args, crossfade: true }}
          refusal={target.refusal}
          compact
          iconOnly
        />
      )}
    </span>
  );
}

/**
 * A candidate's applying, alone and with its suggested crossfade where it has
 * one; the best candidate's Apply is the call to action.
 */
function CandidateApplying({
  candidate,
  best,
  target,
  commands,
}: {
  readonly candidate: LoopCandidate;
  readonly best: boolean;
  readonly target: CandidateTarget;
  readonly commands: PanelCommands;
}): ReactNode {
  const rank = String(candidate.rank);
  const args = { view: target.view, region: target.region, rank: candidate.rank };
  return (
    <div className="ag-control-row" role="group" aria-label={`Candidate ${rank}`}>
      <CommandButton
        id="loop.apply-candidate"
        label="Apply"
        name={`Apply candidate ${rank}`}
        commands={commands}
        args={args}
        refusal={target.refusal}
        {...(best ? { tone: ButtonTone.Primary } : {})}
        compact
      />
      {candidate.crossfade !== undefined && (
        <CommandButton
          id="loop.apply-crossfade"
          label="Apply with its crossfade"
          name={`Apply candidate ${rank} with its crossfade`}
          commands={commands}
          args={args}
          refusal={target.refusal}
          compact
        />
      )}
    </div>
  );
}

/** One candidate: where it loops, how it is judged, its suggestion, and its controls. */
function Candidate({
  candidate,
  best,
  sampleRate,
  channels,
  position,
  target,
  commands,
}: {
  readonly candidate: LoopCandidate;
  /** Whether it is the best found, drawn as the chosen card. */
  readonly best: boolean;
  readonly sampleRate: number;
  readonly channels: readonly string[];
  readonly position: (frames: number) => string;
  readonly target: CandidateTarget;
  readonly commands: PanelCommands;
}): ReactNode {
  const rank = String(candidate.rank);
  return (
    <li className="ag-loop-candidate" data-ag-best={best ? '' : undefined}>
      <div className="ag-loop-candidate-head">
        <span className="ag-loop-candidate-rank" aria-hidden="true">
          {rank}
        </span>
        <h4 className="ag-loop-candidate-name">
          <span className="ag-visually-hidden">{`Candidate ${rank}: `}</span>
          <span className="ag-figure">{`${position(candidate.start)} to ${position(candidate.end)}`}</span>
        </h4>
        <CandidateHearing candidate={candidate} target={target} commands={commands} />
      </div>
      <p className="ag-loop-candidate-text">{`${candidateMoveWords(candidate)}. Without a crossfade it ${judgedWords(candidate.metrics)}.`}</p>
      <p className="ag-loop-candidate-text" data-ag-quiet="">
        {`Suggested crossfade: ${suggestionWords(candidate, sampleRate)}`}
      </p>
      <CandidateApplying candidate={candidate} best={best} target={target} commands={commands} />
      <Section title={`Candidate ${rank}’s checks`} defaultOpen={false}>
        <ChecksTable
          metrics={candidate.metrics}
          channels={channels}
          caption={`The checks of candidate ${rank}, measured without a crossfade`}
        />
      </Section>
    </li>
  );
}

/** The candidates a search found, best first, or that it found none. */
export function LoopCandidates({
  candidates,
  sampleRate,
  channels,
  position,
  target,
  commands,
}: {
  readonly candidates: readonly LoopCandidate[];
  readonly sampleRate: number;
  readonly channels: readonly string[];
  readonly position: (frames: number) => string;
  readonly target: CandidateTarget;
  readonly commands: PanelCommands;
}): ReactNode {
  const heading = useId();
  return (
    <section className="ag-loop-candidates" aria-labelledby={heading}>
      <h3 className="ag-loop-group-title" id={heading}>
        Candidate loop points, best first
      </h3>
      {candidates.length === 0 ? (
        <p className="ag-loop-heard">No loop points near these were found.</p>
      ) : (
        <ol className="ag-loop-candidate-list">
          {candidates.map((candidate, index) => (
            <Candidate
              key={`${String(candidate.start)}:${String(candidate.end)}`}
              candidate={candidate}
              best={index === 0}
              sampleRate={sampleRate}
              channels={channels}
              position={position}
              target={target}
              commands={commands}
            />
          ))}
        </ol>
      )}
    </section>
  );
}
