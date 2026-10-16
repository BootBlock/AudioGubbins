/**
 * The Loop panel's controls (ADR-0103): the search's settings and the command
 * that searches with them, the controls that hear the loop and what is being
 * heard, and a running analysis's progress with the command that stops it.
 * Each runs a command; the settings are a draft the command reads, and nothing
 * here writes a store.
 */

import { useState, type ReactNode } from 'react';

import { TextField, ToggleSwitch } from '@audiogubbins/design-system';
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
      <legend>Search near the loop</legend>
      <TextField
        label="How far each point may move, in milliseconds"
        value={radius}
        onValueChange={setRadius}
        description="At most 2,000 ms."
      />
      <TextField
        label="Candidates to list"
        value={candidates}
        onValueChange={setCandidates}
        description={`From 1 to ${String(MOST_CANDIDATES)}.`}
      />
      <ToggleSwitch
        label="Keep the loop’s length"
        checked={keepLength}
        onCheckedChange={setKeepLength}
        description="Moves both points together, so the loop lasts as long as it does now."
      />
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
      />
    </fieldset>
  );
}

/** The controls that hear the region's loop, and what is being heard. */
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
  const heard =
    audition === undefined
      ? 'No loop is being heard.'
      : `Hearing ${audition.mode === 'cycles' ? 'the cycles' : 'the seam stress test'} of ${
          audition.candidate === undefined ? 'the loop' : `candidate ${String(audition.candidate)}`
        } of ${quoted(audition.name)}.`;
  return (
    <div className="ag-loop-actions" role="group" aria-label="Hear the loop">
      <CommandButton
        id="loop.audition-cycles"
        label="Hear the loop cycling"
        commands={commands}
        args={args}
      />
      <CommandButton
        id="loop.audition-seam"
        label="Stress-test the seam"
        commands={commands}
        args={args}
      />
      <CommandButton id="loop.stop-audition" label="Stop hearing the loop" commands={commands} />
      <p className="ag-panel-note">{heard}</p>
    </div>
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
    <>
      <progress
        className="ag-render-progress"
        aria-label="Loop analysis progress"
        max={record.total}
        value={record.done}
      />
      <p role="status" className="ag-panel-note">
        {`Analysing the loop${record.request.search === undefined ? '' : ' and searching near it'}: ${String(tenths)}%`}
      </p>
      <CommandButton
        id="loop.cancel-analysis"
        label="Stop analysing the loop"
        commands={commands}
        args={{ view: shown.panel, region: shown.region }}
      />
    </>
  );
}
