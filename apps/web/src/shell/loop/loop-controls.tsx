/**
 * The Loop panel's controls (ADR-0103): the search's settings and the command
 * that searches with them, the controls that hear the loop and what is being
 * heard, and a running analysis's progress with the command that stops it.
 * Each runs a command; the settings are a draft the command reads, and nothing
 * here writes a store.
 */

import { useState, type ReactNode } from 'react';

import { Hint, ProgressBar, TextField, ToggleSwitch } from '@audiogubbins/design-system';
import { MOST_CANDIDATES } from '@audiogubbins/loop-analysis';
import { quoted } from '@audiogubbins/text';

import type { Auditioning } from '../../audio/loop-audition.js';
import type { LoopAnalysisRecord } from '../../state/loop-analysis-store.js';
import { CommandButton, type PanelCommands } from '../command-button.js';

/** What the controls act on: the view their commands run in, and the region whose loop they act on. */
export interface LoopTarget {
  readonly panel: string;
  readonly region: string;
}

/** The search's settings, as the person types them: a draft the command reads. */
export function SearchSettings({
  shown,
  commands,
}: {
  readonly shown: LoopTarget;
  readonly commands: PanelCommands;
}): ReactNode {
  const [radius, setRadius] = useState('20');
  const [candidates, setCandidates] = useState('5');
  const [keepLength, setKeepLength] = useState(false);
  return (
    <fieldset className="ag-loop-search">
      <legend className="ag-loop-group-title">Search near the loop</legend>
      <div className="ag-loop-setting">
        <TextField label="Move up to" unit="ms" value={radius} onValueChange={setRadius} />
        <Hint label="About how far each point may move">
          How far each point may move, in milliseconds. At most 2,000 ms.
        </Hint>
      </div>
      <div className="ag-loop-setting">
        <TextField label="Candidates to list" value={candidates} onValueChange={setCandidates} />
        <Hint label="About how many candidates to list">
          {`From 1 to ${String(MOST_CANDIDATES)}.`}
        </Hint>
      </div>
      <div className="ag-loop-setting">
        <ToggleSwitch
          label="Keep the loop’s length"
          checked={keepLength}
          onCheckedChange={setKeepLength}
        />
        <Hint label="About keeping the loop’s length">
          Moves both points together, so the loop lasts as long as it does now.
        </Hint>
      </div>
      <CommandButton
        id="loop.find-candidates"
        label="Find better loop points"
        commands={commands}
        args={{
          view: shown.panel,
          region: shown.region,
          radius,
          candidates,
          'keep-length': keepLength,
        }}
        compact
      />
    </fieldset>
  );
}

/** The controls that hear the region's loop, and what is being heard said under them. */
export function Hearing({
  shown,
  audition,
  commands,
}: {
  readonly shown: LoopTarget;
  readonly audition: Auditioning | undefined;
  readonly commands: PanelCommands;
}): ReactNode {
  const args = { view: shown.panel, region: shown.region };
  return (
    <div className="ag-loop-hearing" role="group" aria-label="Hear the loop">
      <div className="ag-control-row">
        <CommandButton
          id="loop.audition-cycles"
          label="Hear the loop cycling"
          commands={commands}
          args={args}
          compact
        />
        <CommandButton
          id="loop.audition-seam"
          label="Stress-test the seam"
          commands={commands}
          args={args}
          compact
        />
        <CommandButton
          id="loop.stop-audition"
          label="Stop hearing the loop"
          commands={commands}
          compact
          iconOnly
        />
      </div>
      <HeardLine audition={audition} />
    </div>
  );
}

/** What is being heard of the region's loop, or that nothing is. */
function HeardLine({ audition }: { readonly audition: Auditioning | undefined }): ReactNode {
  const heard =
    audition === undefined
      ? 'No loop is being heard.'
      : `Hearing ${audition.mode === 'cycles' ? 'the cycles' : 'the seam stress test'} of ${
          audition.candidate === undefined ? 'the loop' : `candidate ${String(audition.candidate)}`
        } of ${quoted(audition.name)}.`;
  return (
    <p className="ag-loop-heard" data-ag-heard={audition === undefined ? undefined : ''}>
      {heard}
    </p>
  );
}

/** How far a running analysis has gone, and the command that stops it. */
export function Running({
  record,
  shown,
  commands,
}: {
  readonly record: Extract<LoopAnalysisRecord, { readonly kind: 'running' }>;
  readonly shown: LoopTarget;
  readonly commands: PanelCommands;
}): ReactNode {
  // Said in tenths, so a screen reader hears it move without being read every chunk.
  const tenths = record.total === 0 ? 0 : Math.floor((record.done / record.total) * 10) * 10;
  return (
    <div className="ag-loop-running">
      <ProgressBar
        label="Loop analysis progress"
        value={record.total === 0 ? null : record.done / record.total}
      />
      <div className="ag-control-row">
        <p role="status" className="ag-loop-heard">
          {`Analysing the loop${record.request.search === undefined ? '' : ' and searching near it'}: ${String(tenths)}%`}
        </p>
        <CommandButton
          id="loop.cancel-analysis"
          label="Stop analysing the loop"
          commands={commands}
          args={{ view: shown.panel, region: shown.region }}
          compact
        />
      </div>
    </div>
  );
}
