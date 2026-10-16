/**
 * The candidate loop points a search found (ADR-0103), best first: where each
 * would put the loop, how far it moves each point, how it is judged, the
 * micro-crossfade suggested for it, and its checks in full on request. Each
 * can be heard, alone or with its crossfade, and applied only by the person
 * pressing Apply, which runs the region's loop command: one step of the
 * history, which undo reverses.
 */

import { useId, type ReactNode } from 'react';

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

/** A candidate's controls: hear it and apply it, each with its suggested crossfade where it has one. */
function CandidateActions({
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
  const faded = candidate.crossfade !== undefined;
  const actions = [
    ['loop.audition-candidate', `Hear candidate ${rank}`, args],
    ...(faded
      ? ([
          [
            'loop.audition-candidate',
            `Hear candidate ${rank} with its crossfade`,
            { ...args, crossfade: true },
          ],
        ] as const)
      : []),
    ['loop.apply-candidate', `Apply candidate ${rank}`, args],
    ...(faded
      ? ([['loop.apply-crossfade', `Apply candidate ${rank} with its crossfade`, args]] as const)
      : []),
  ] as const;
  return (
    <div className="ag-loop-actions" role="group" aria-label={`Candidate ${rank}`}>
      {actions.map(([id, label, given]) => (
        <CommandButton
          key={label}
          id={id}
          label={label}
          commands={commands}
          args={given}
          refusal={target.refusal}
          compact
        />
      ))}
    </div>
  );
}

/** One candidate: where it loops, how it is judged, its suggestion, and its controls. */
function Candidate({
  candidate,
  sampleRate,
  channels,
  position,
  target,
  commands,
}: {
  readonly candidate: LoopCandidate;
  readonly sampleRate: number;
  readonly channels: readonly string[];
  readonly position: (frames: number) => string;
  readonly target: CandidateTarget;
  readonly commands: PanelCommands;
}): ReactNode {
  const rank = String(candidate.rank);
  return (
    <li className="ag-loop-candidate">
      <h4 className="ag-analysis-heading">
        {`Candidate ${rank}: ${position(candidate.start)} to ${position(candidate.end)}`}
      </h4>
      <p>{`${candidateMoveWords(candidate)}. Without a crossfade it ${judgedWords(candidate.metrics)}.`}</p>
      <p>{`Suggested crossfade: ${suggestionWords(candidate, sampleRate)}`}</p>
      <CandidateActions candidate={candidate} target={target} commands={commands} />
      <details>
        <summary>{`Candidate ${rank}’s checks`}</summary>
        <ChecksTable
          metrics={candidate.metrics}
          channels={channels}
          caption={`The checks of candidate ${rank}, measured without a crossfade`}
        />
      </details>
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
    <section aria-labelledby={heading}>
      <h3 className="ag-analysis-heading" id={heading}>
        Candidate loop points, best first
      </h3>
      {candidates.length === 0 ? (
        <p className="ag-panel-note">No loop points near these were found.</p>
      ) : (
        <ol className="ag-loop-candidates">
          {candidates.map((candidate) => (
            <Candidate
              key={`${String(candidate.start)}:${String(candidate.end)}`}
              candidate={candidate}
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
