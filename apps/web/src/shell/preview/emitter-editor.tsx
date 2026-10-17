/**
 * One emitter of the scenario set up: its number in its colour, what it plays
 * and how it moves, its voices against its limit while a run plays, and its
 * own Trigger, Stop and removal; and, behind its settings section, its name,
 * what it plays, the rules that plays by and where they come from (the
 * defaults where they resolve unset, said so), how it is triggered and how it
 * moves.
 */

import { useId, type ReactNode } from 'react';

import { ButtonTone, IconButton, Section, TextField } from '@audiogubbins/design-system';
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
import type { PanelCommands } from '../command-button.js';
import { ChoiceField, type Choice } from '../export/setting-fields.js';
import { CommandIconButton, HintedCommandButton } from '../hinted-command-button.js';
import { emitterColour } from './emitter-colours.js';
import { MotionFields, TriggerFields } from './motion-fields.js';
import { MOTION_WORDS, rulesWords, sourceWords, subjectKey, subjectName } from './preview-words.js';

/** What an emitter's editor reads. */
export interface EmitterParts {
  readonly project: Project;
  readonly game: GameAudioState | undefined;
  readonly space: '2d' | '3d';
  readonly commands: PanelCommands;
  /** Its voices sounding and its limit, while a run of it plays. */
  readonly voices: { readonly sounding: number; readonly limit: number } | undefined;
}

/** The most lamps the voices are drawn with; a larger limit lights them in proportion. */
const MOST_VOICE_LAMPS = 16;

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
      <p className="ag-preview-note">
        {`${rulesWords(rules?.value ?? DEFAULT_EMITTER_RULES)} ${sourceWords(rules?.source ?? { kind: 'unset' })}.`}
      </p>
    </>
  );
}

/** Its voices sounding against its limit: a row of lamps, and the words. */
function Voices({
  voices,
}: {
  readonly voices: { readonly sounding: number; readonly limit: number };
}): ReactNode {
  const lamps = Math.min(voices.limit, MOST_VOICE_LAMPS);
  const lit = voices.limit === 0 ? 0 : Math.round((voices.sounding / voices.limit) * lamps);
  return (
    <span className="ag-preview-voices">
      <span className="ag-preview-voice-lamps" aria-hidden="true">
        {Array.from({ length: lamps }, (_, at) => (
          <span
            key={at}
            className="ag-preview-voice-lamp"
            data-ag-lit={at < lit ? '' : undefined}
          />
        ))}
      </span>
      <span>{`Sounding ${String(voices.sounding)} of ${String(voices.limit)} voices.`}</span>
    </span>
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
    <span className="ag-preview-emitter-actions">
      <HintedCommandButton
        id={PreviewCommand.Trigger}
        label="Trigger"
        name={`Trigger ${emitter.name}`}
        commands={commands}
        args={args}
        compact
      />
      <CommandIconButton
        id={PreviewCommand.StopVoices}
        icon="stop"
        label={`Stop the voices of ${emitter.name}`}
        commands={commands}
        args={args}
        compact
      />
      {onRemove === undefined ? null : (
        <IconButton
          icon="remove"
          label={`Remove ${emitter.name}`}
          hint={`Remove ${emitter.name}`}
          tone={ButtonTone.Quiet}
          compact
          onClick={onRemove}
        />
      )}
    </span>
  );
}

/** An emitter's settings, behind their section: its name, what it plays, its trigger and its motion. */
function EmitterSettings({
  emitter,
  parts,
  onEmitter,
}: {
  readonly emitter: PreviewEmitter;
  readonly parts: EmitterParts;
  readonly onEmitter: (emitter: PreviewEmitter) => void;
}): ReactNode {
  return (
    <Section title={`Settings for ${emitter.name}`} defaultOpen={false}>
      <div className="ag-preview-fields">
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
      </div>
    </Section>
  );
}

/** One emitter: its row, and its settings behind their section. */
export function EmitterEditor({
  emitter,
  place,
  parts,
  onEmitter,
  onRemove,
}: {
  readonly emitter: PreviewEmitter;
  /** Where it is in the scenario, from the first: its number and its colour. */
  readonly place: number;
  readonly parts: EmitterParts;
  readonly onEmitter: (emitter: PreviewEmitter) => void;
  /** Removes it; absent for the scenario's only emitter. */
  readonly onRemove: (() => void) | undefined;
}): ReactNode {
  const heading = useId();
  const { project, game, commands, voices } = parts;
  return (
    <section
      className="ag-preview-emitter"
      data-ag-category={emitterColour(place)}
      aria-labelledby={heading}
    >
      <div className="ag-preview-emitter-row">
        <span className="ag-preview-emitter-mark" aria-hidden="true">
          {String(place + 1)}
        </span>
        <div className="ag-preview-emitter-text">
          <h4 className="ag-preview-emitter-name" id={heading}>
            {emitter.name}
          </h4>
          <span className="ag-preview-emitter-detail">
            {`${subjectName(project, game, emitter.subject)} · ${MOTION_WORDS[emitter.motion.kind]}`}
          </span>
          {voices === undefined ? null : <Voices voices={voices} />}
        </div>
        <EmitterActions emitter={emitter} commands={commands} onRemove={onRemove} />
      </div>
      <EmitterSettings emitter={emitter} parts={parts} onEmitter={onEmitter} />
    </section>
  );
}
