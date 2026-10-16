/**
 * One emitter of the scenario set up: what it plays, the rules it plays by and
 * where they come from (the defaults where they resolve unset, said so), how it
 * is triggered and moves, its voices against its limit while a run plays, and
 * its own Trigger and Stop.
 */

import { useId, type ReactNode } from 'react';

import { Button, TextField } from '@audiogubbins/design-system';
import type { Project } from '@audiogubbins/domain';
import {
  DEFAULT_EMITTER_RULES,
  resolveGroupPolicy,
  resolvePolicy,
  type EmitterRules,
  type GameAudioState,
  type PreviewEmitter,
  type PreviewSubject,
  type Resolved,
} from '@audiogubbins/game-audio';

import { PreviewCommand } from '../../commands/preview-run-commands.js';
import { CommandButton, type PanelCommands } from '../command-button.js';
import { ChoiceField, type Choice } from '../export/setting-fields.js';
import { MotionFields, TriggerFields } from './motion-fields.js';
import { rulesWords, sourceWords, subjectKey, subjectName } from './preview-words.js';

/** What an emitter's editor reads. */
export interface EmitterParts {
  readonly project: Project;
  readonly game: GameAudioState | undefined;
  readonly space: '2d' | '3d';
  readonly commands: PanelCommands;
  /** Its voices sounding and its limit, while a run of it plays. */
  readonly voices: { readonly sounding: number; readonly limit: number } | undefined;
}

/** Every subject an emitter may play: each group, then each member of one. */
function subjectChoices(
  project: Project,
  game: GameAudioState | undefined,
): readonly Choice<PreviewSubject>[] {
  if (game === undefined) return [];
  const groups = [...game.groups.keys()].map((group): PreviewSubject => ({ kind: 'group', group }));
  const members = game.memberships.map((one): PreviewSubject => ({
    kind: 'member',
    member: one.member,
  }));
  return [...groups, ...members].map((value) => ({
    value,
    label: subjectName(project, game, value),
  }));
}

/** The emitter rules `subject` plays by, with where they come from. */
function rulesOf(
  game: GameAudioState | undefined,
  project: Project,
  subject: PreviewSubject,
): Resolved<EmitterRules> | undefined {
  if (game === undefined) return undefined;
  if (subject.kind === 'member') return resolvePolicy(project, game, subject.member).emitter;
  return game.groups.has(subject.group)
    ? resolveGroupPolicy(game, subject.group).fields.emitter
    : undefined;
}

/** What the emitter plays, and the rules that plays by. */
function SubjectFields({
  emitter,
  parts,
  onEmitter,
}: {
  readonly emitter: PreviewEmitter;
  readonly parts: EmitterParts;
  readonly onEmitter: (emitter: PreviewEmitter) => void;
}): ReactNode {
  const { project, game } = parts;
  const choices = subjectChoices(project, game);
  const chosen = choices.find((one) => subjectKey(one.value) === subjectKey(emitter.subject));
  const offered =
    chosen === undefined
      ? [{ value: emitter.subject, label: subjectName(project, game, emitter.subject) }, ...choices]
      : choices;
  const rules = rulesOf(game, project, emitter.subject);
  return (
    <>
      <ChoiceField
        label="Plays"
        value={chosen?.value ?? emitter.subject}
        choices={offered}
        onChoose={(subject) => {
          onEmitter({ ...emitter, subject });
        }}
      />
      <p className="ag-panel-note">
        {`${rulesWords(rules?.value ?? DEFAULT_EMITTER_RULES)} ${sourceWords(rules?.source ?? { kind: 'unset' })}.`}
      </p>
    </>
  );
}

/** The emitter's own Trigger and Stop, and its removal where the scenario keeps another. */
function EmitterActions({
  emitter,
  commands,
  onRemove,
}: {
  readonly emitter: PreviewEmitter;
  readonly commands: PanelCommands;
  readonly onRemove: (() => void) | undefined;
}): ReactNode {
  const args = { emitter: emitter.id };
  return (
    <div className="ag-preview-actions">
      <CommandButton
        id={PreviewCommand.Trigger}
        label={`Trigger ${emitter.name}`}
        commands={commands}
        args={args}
        compact
      />
      <CommandButton
        id={PreviewCommand.StopVoices}
        label={`Stop the voices of ${emitter.name}`}
        commands={commands}
        args={args}
        compact
      />
      {onRemove === undefined ? null : (
        <Button compact tone="quiet" onClick={onRemove}>
          {`Remove ${emitter.name}`}
        </Button>
      )}
    </div>
  );
}

/** One emitter's editor. */
export function EmitterEditor({
  emitter,
  parts,
  onEmitter,
  onRemove,
}: {
  readonly emitter: PreviewEmitter;
  readonly parts: EmitterParts;
  readonly onEmitter: (emitter: PreviewEmitter) => void;
  /** Removes it; absent for the scenario's only emitter. */
  readonly onRemove: (() => void) | undefined;
}): ReactNode {
  const heading = useId();
  const { commands, voices } = parts;
  return (
    <section className="ag-inspector-section" aria-labelledby={heading}>
      <h4 className="ag-inspector-heading" id={heading}>
        {emitter.name}
      </h4>
      <TextField
        label="Name"
        value={emitter.name}
        maxLength={128}
        onValueChange={(name) => {
          onEmitter({ ...emitter, name });
        }}
      />
      <SubjectFields emitter={emitter} parts={parts} onEmitter={onEmitter} />
      <TriggerFields
        trigger={emitter.trigger}
        onTrigger={(trigger) => {
          onEmitter({ ...emitter, trigger });
        }}
      />
      <MotionFields
        motion={emitter.motion}
        space={parts.space}
        onMotion={(motion) => {
          onEmitter({ ...emitter, motion });
        }}
      />
      {voices === undefined ? null : (
        <p className="ag-panel-note">{`Sounding ${String(voices.sounding)} of ${String(voices.limit)} voices.`}</p>
      )}
      <EmitterActions emitter={emitter} commands={commands} onRemove={onRemove} />
    </section>
  );
}
