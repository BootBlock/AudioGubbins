/**
 * The project settings: how a file is brought into a project by default, and
 * how much of the open project's history is kept, with what a change of that
 * would remove shown before it is made (REQ-STOR-025, REQ-STOR-055,
 * REQ-STOR-106).
 *
 * Copying and linking each have a cost, and both are explained where the choice
 * is made. A link is offered only where the browser can give a file
 * AudioGubbins finds again. Keeping less history plans first: the plan says
 * what it frees and what undo, branches and export states it takes, and only
 * applying it changes anything; once applied, the limit goes on letting older
 * history go as the person works, which the form says. Every control runs a
 * command.
 */

import { useState, useSyncExternalStore, type ReactNode } from 'react';

import { Button, OptionSelect, TextField } from '@audiogubbins/design-system';
import { SourceHandling } from '@audiogubbins/media-store';
import type { ExportRecord, RetentionPolicy } from '@audiogubbins/project-format';

import { CANNOT_LINK } from '../../state/project-preferences-store.js';
import type { HistoryReviewState, PendingCompaction } from '../../state/history-review-store.js';
import type { Observable } from '../../state/observable.js';
import type { OpenProjectState } from '../../state/open-project-store.js';
import type { ProjectPreferences } from '../../state/project-preferences-store.js';
import { CompactionReview } from '../history/compaction-review.js';
import type { RunCommand } from './section.js';

/** What the project settings read. */
interface ProjectReadings {
  readonly preferences: Observable<ProjectPreferences>;
  readonly project: Observable<OpenProjectState>;
  readonly review: Observable<HistoryReviewState>;
}

/** What each way of bringing a file in costs. */
const HANDLING_NOTES: Readonly<Record<SourceHandling, string>> = {
  [SourceHandling.Copy]:
    'A copy is kept with the project, so nothing done to the file afterwards changes the project, and the project goes wherever it is exported. It takes room in this browser.',
  [SourceHandling.Link]:
    'A link takes no room and follows the file as it changes, and you are asked what to do when it does. The file must stay where it is, and a bundle carries it only once it is copied in.',
};

/** How much history is kept, as the form holds it. */
interface RetentionForm {
  readonly kind: string;
  readonly value: string;
}

/** The form a policy starts it from. */
function formOf(policy: RetentionPolicy): RetentionForm {
  if (policy.kind === 'unlimited') return { kind: 'unlimited', value: '' };
  if (policy.kind === 'budget')
    return { kind: 'budget', value: String(Math.round(policy.bytes / 2 ** 20)) };
  const [rule] = policy.rules;
  return rule.kind === 'recent-changes'
    ? { kind: 'recent-changes', value: String(rule.count) }
    : { kind: 'recent-days', value: String(rule.days) };
}

const KEEPING = [
  { value: 'unlimited', label: 'Everything' },
  { value: 'recent-changes', label: 'The most recent changes' },
  { value: 'recent-days', label: 'The most recent days' },
  { value: 'budget', label: 'As much as fits in a size' },
] as const;

/** What each kind of limit is counted in. */
const UNITS: Readonly<Record<string, string>> = {
  budget: 'Size in MB',
  'recent-days': 'Days',
  'recent-changes': 'Changes',
};

/** The limit chosen and its number, and the plan it would make, where one waits. */
function RetentionChoice({
  retention,
  exports,
  pending,
  run,
}: {
  readonly retention: RetentionPolicy;
  readonly exports: readonly ExportRecord[];
  readonly pending: PendingCompaction | undefined;
  readonly run: RunCommand;
}): ReactNode {
  const [form, setForm] = useState<RetentionForm>(formOf(retention));
  const number = Number(form.value);
  const value = form.kind === 'budget' ? number * 2 ** 20 : number;
  return (
    <div className="ag-settings-section">
      <div className="ag-settings-row">
        <OptionSelect
          label="Keep"
          value={form.kind}
          options={KEEPING}
          onValueChange={(kind) => {
            setForm({ ...form, kind });
          }}
        />
        {form.kind !== 'unlimited' && (
          <TextField
            label={UNITS[form.kind] ?? 'Changes'}
            value={form.value}
            onValueChange={(typed) => {
              setForm({ ...form, value: typed });
            }}
          />
        )}
        <Button onClick={() => run('history.plan-retention', { kind: form.kind, value })}>
          Show what this keeps
        </Button>
      </div>
      {form.kind !== 'unlimited' && (
        <p className="ag-settings-note">
          Once applied, history past this limit goes on its own as you work. Snapshots, the point
          you are at and what redo reaches are always kept.
        </p>
      )}
      {pending?.policy !== undefined && (
        <CompactionReview pending={pending} exports={exports} run={run} />
      )}
    </div>
  );
}

/** How much of the open project's history is kept. */
function Retention({
  projects,
  run,
}: {
  readonly projects: ProjectReadings;
  readonly run: RunCommand;
}): ReactNode {
  const open = useSyncExternalStore(projects.project.subscribe, projects.project.get);
  const review = useSyncExternalStore(projects.review.subscribe, projects.review.get);
  if (open.kind !== 'open') {
    return (
      <p className="ag-settings-note">Open a project to set how much of its history is kept.</p>
    );
  }
  const { model } = open.snapshot;
  return (
    <RetentionChoice
      // Made afresh for another project, so the form starts from its policy.
      key={open.snapshot.project}
      retention={model.retention}
      exports={model.exports}
      pending={review.compaction}
      run={run}
    />
  );
}

/** The project settings (see the module comment). */
export function ProjectSettings({
  projects,
  run,
}: {
  readonly projects: ProjectReadings;
  readonly run: RunCommand;
}): ReactNode {
  const preferences = useSyncExternalStore(
    projects.preferences.subscribe,
    projects.preferences.get,
  );
  const offered = preferences.canLink
    ? [
        { value: SourceHandling.Copy, label: 'Copying them into the project' },
        { value: SourceHandling.Link, label: 'Linking to them where they are' },
      ]
    : [{ value: SourceHandling.Copy, label: 'Copying them into the project' }];
  return (
    <div className="ag-settings-section">
      <OptionSelect
        label="Bring files in by"
        value={preferences.sourceHandling}
        options={offered}
        onValueChange={(handling) => run('settings.source-handling', { handling })}
      />
      <p className="ag-settings-note">{HANDLING_NOTES[preferences.sourceHandling]}</p>
      {!preferences.canLink && <p className="ag-settings-note">{CANNOT_LINK}</p>}
      <h3 className="ag-section-heading">History kept</h3>
      <Retention projects={projects} run={run} />
    </div>
  );
}
