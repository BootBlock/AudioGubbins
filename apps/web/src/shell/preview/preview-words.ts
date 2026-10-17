/**
 * The Game preview's words (ADR-0104): what an event, an emitter's rules and
 * their source, a subject, a position and a run are called, in British English
 * and never by colour alone.
 */

import {
  memberKey,
  pathText,
  groupPath,
  type EmitterRules,
  type GameAudioState,
  type GroupMember,
  type Motion,
  type PolicySource,
  type PreviewEvent,
  type PreviewSubject,
  type Position,
} from '@audiogubbins/game-audio';
import type { Project } from '@audiogubbins/domain';
import { counted } from '@audiogubbins/text';

/** What `member` is called in `project`. */
export function memberName(project: Project, member: GroupMember): string {
  if (member.kind === 'region')
    return project.regions.get(member.region)?.displayName ?? 'A region no longer in the project';
  return project.assets.get(member.asset)?.displayName ?? 'An asset no longer in the project';
}

/** What `subject` is called. */
export function subjectName(
  project: Project,
  game: GameAudioState | undefined,
  subject: PreviewSubject,
): string {
  if (subject.kind === 'member') return memberName(project, subject.member);
  if (game?.groups.has(subject.group) !== true) return 'A group no longer in the project';
  return `The group ${pathText(groupPath(game.groups, subject.group))}`;
}

/** How an emitter moves, in a word or two: what the emitter's motion choice says. */
export const MOTION_WORDS: Readonly<Record<Motion['kind'], string>> = {
  still: 'Still',
  waypoints: 'Along waypoints',
};

/** Where an emitter's rules come from. */
export function sourceWords(source: PolicySource): string {
  switch (source.kind) {
    case 'group':
      return `Set on ${source.path.join('/')}`;
    case 'override':
      return 'Overridden on this member';
    case 'unset':
      return 'Not set: the preview plays by the defaults';
  }
}

/** An emitter's rules, in a sentence. */
export function rulesWords(rules: EmitterRules): string {
  const selection =
    rules.selection.kind === 'uniform'
      ? 'any member at random'
      : `no member of the last ${counted(rules.selection.depth, 'choice', 'choices')} again`;
  const stealing = {
    oldest: 'the oldest is stolen',
    quietest: 'the quietest is stolen',
    reject: 'a new trigger is refused',
  }[rules.voices.stealing];
  const cooldown =
    rules.cooldownMilliseconds === 0
      ? 'no cooldown'
      : `a cooldown of ${String(rules.cooldownMilliseconds)} ms`;
  const attenuation =
    rules.attenuation.kind === 'none' ? 'no attenuation' : `${rules.attenuation.kind} attenuation`;
  return `Plays ${selection}; at most ${counted(rules.voices.limit, 'voice', 'voices')}, past which ${stealing}; ${cooldown}; ${attenuation}${rules.filter === undefined ? '' : ', with a distance filter'}.`;
}

/** What happened in `event`, in a few words. */
export function eventWords(event: PreviewEvent): string {
  switch (event.kind) {
    case 'started':
      return 'Started';
    case 'suppressed':
      return 'Suppressed by the cooldown';
    case 'rejected':
      return 'Refused: the emitter is full';
    case 'budget-rejected':
      return 'Refused: the voice budget is full';
    case 'stolen':
      return 'Stolen for a new voice';
    case 'budget-stolen':
      return 'Stolen for the voice budget';
    case 'stopped':
      return 'Stopped by hand';
    case 'ended':
      return 'Played to its end';
  }
}

/** A signed number of `unit`, to `places` decimal places. */
export function signed(value: number, unit: string, places = 0): string {
  const text = value.toFixed(places);
  return `${value > 0 ? '+' : ''}${text} ${unit}`;
}

/** A position as the listener hears it: how far away, and which way. */
export function whereWords(at: Position, listener: Position, space: '2d' | '3d'): string {
  const dx = at.x - listener.x;
  const dy = at.y - listener.y;
  const dz = at.z - listener.z;
  const distance = Math.hypot(dx, dy, dz);
  const unit = space === '3d' ? 'm' : 'px';
  if (distance === 0) return `at the listener`;
  const ahead = space === '3d' ? -dz : -dy;
  const across = dx;
  const parts = [
    ahead === 0 ? undefined : ahead > 0 ? 'ahead' : 'behind',
    across === 0 ? undefined : across > 0 ? 'to the right' : 'to the left',
    space === '3d' && dy !== 0 ? (dy > 0 ? 'above' : 'below') : undefined,
  ].filter((part) => part !== undefined);
  return `${distance.toFixed(1)} ${unit} away, ${parts.join(' and ')} in the world's axes`;
}

/** The identity a subject is chosen by in a list. */
export function subjectKey(subject: PreviewSubject): string {
  return subject.kind === 'group' ? `group:${subject.group}` : memberKey(subject.member);
}
