/**
 * Create Seamless Loop's choices (ADR-0103, ADR-0105): for each region its
 * loop analysis has answered, the candidates it found, best first, with how
 * each moves the loop, how it is judged and the crossfade it suggests; the
 * person chooses one, or none, for each. Nothing is looped that was not
 * chosen here.
 */

import type { ReactNode } from 'react';

import { RadioGroup } from '@audiogubbins/design-system';

import { memberKey } from '@audiogubbins/game-audio';
import type { LoopChoice } from '@audiogubbins/guided-workflows';
import type { ProjectState } from '@audiogubbins/project-format';

import { judgedWords } from '../../analysis/loop-analysing.js';
import type { NeedStatus } from '../../commands/workflow-analyses.js';
import { withChosen, type WorkflowDraft } from '../../state/workflow-drafts.js';
import { candidateMoveWords, suggestionWords } from '../loop/loop-words.js';
import type { DraftChange } from './option-rows.js';
import { memberName } from './workflow-words.js';

type Answered = Extract<NeedStatus, { readonly kind: 'current' }>;

/** The choice of leaving the loop as it is, which no candidate's rank can be. */
const NONE = 'none';

/** One region's candidates, as radio buttons, the first choosing none. */
function RegionChoice({
  status,
  chosen,
  state,
  onChoose,
}: {
  readonly status: Answered;
  readonly chosen: LoopChoice | undefined;
  readonly state: ProjectState;
  readonly onChoose: (choice: LoopChoice | undefined) => void;
}): ReactNode {
  const { answer, need } = status;
  if (answer.kind !== 'loop' || need.target.kind !== 'region') return null;
  const region = state.project.regions.get(need.target.region);
  const rate =
    region === undefined ? undefined : state.project.assets.get(region.assetId)?.sampleRate;
  const { candidates } = answer.answer.analysis;
  return (
    <div className="ag-workflow-loop-choice">
      <RadioGroup
        label={`The loop of ${memberName(need.target, state)}`}
        value={chosen === undefined ? NONE : String(chosen.rank)}
        options={[
          { value: NONE, label: 'Leave its loop as it is' },
          ...candidates.map((candidate) => ({
            value: String(candidate.rank),
            label: `Candidate ${String(candidate.rank)}: ${candidateMoveWords(candidate)}; it ${judgedWords(candidate.metrics)}. Crossfade: ${rate === undefined ? 'as suggested' : suggestionWords(candidate, rate)}`,
          })),
        ]}
        onValueChange={(value) => {
          const candidate = candidates.find((one) => String(one.rank) === value);
          onChoose(candidate === undefined ? undefined : { rank: candidate.rank });
        }}
      />
      {candidates.length === 0 && (
        <p className="ag-dialogue-note">The search found no candidate loop points.</p>
      )}
    </div>
  );
}

/** Every answered region's candidates, for the open Create Seamless Loop draft. */
export function LoopChoices({
  draft,
  statuses,
  state,
  onDraft,
}: {
  readonly draft: Extract<WorkflowDraft, { readonly key: 'create-seamless-loop' }>;
  readonly statuses: readonly NeedStatus[];
  readonly state: ProjectState;
  readonly onDraft: DraftChange;
}): ReactNode {
  const answered = statuses.filter((status): status is Answered => status.kind === 'current');
  if (answered.length === 0) return null;
  const choose = (key: string, choice: LoopChoice | undefined): void => {
    onDraft((now) => {
      if (now.key !== 'create-seamless-loop') return now;
      const choices = new Map(now.fields.choices.value);
      if (choice === undefined) choices.delete(key);
      else choices.set(key, choice);
      return { key: now.key, fields: withChosen(now.fields, 'choices', choices) };
    });
  };
  return (
    <section className="ag-workflow-section" aria-label="Loop points to choose">
      {answered.map((status) => {
        const key = memberKey(status.need.target);
        return (
          <RegionChoice
            key={key}
            status={status}
            chosen={draft.fields.choices.value.get(key)}
            state={state}
            onChoose={(choice) => {
              choose(key, choice);
            }}
          />
        );
      })}
    </section>
  );
}
