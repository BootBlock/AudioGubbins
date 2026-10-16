/**
 * What an emitter of a game preview plays by, read from the game-audio state
 * (ADR-0104): the emitter rules its subject's group holds, and its pool, each
 * member with the variation and bus of its own effective policy, so a member's
 * override is heard when its group is played.
 *
 * A group's pool is its own members in membership order; a member subject is
 * a pool of one, played by its group's emitter rules. Where a field resolves
 * unset the preview plays by `DEFAULT_EMITTER_RULES` or
 * `DEFAULT_VOICE_VARIATION`, and a member with no bus plays on Godot's
 * `Master`. What each member sounds like, its rate, length and loop, comes
 * from the plans the caller made of it.
 */

import type { Project, SampleRate } from '@audiogubbins/domain';

import type { GameAudioState } from '../groups/game-audio-state.js';
import { memberKey, type GroupMember } from '../groups/membership.js';
import type { BusName } from '../policy/bus-name.js';
import {
  DEFAULT_EMITTER_RULES,
  DEFAULT_VOICE_VARIATION,
  type EmitterRules,
  type VoiceVariation,
} from '../policy/playback-rules.js';
import { groupPolicies, resolveAll } from '../policy/policy-resolution.js';
import type { PreviewSubject } from './preview-scenario.js';

/** What a member sounds like, in its own frames at its own rate. */
export interface MemberSound {
  readonly sampleRate: SampleRate;
  /** At least 1. */
  readonly length: number;
  /** Where it loops, `0 ≤ start < end ≤ length`, where it is a loop. */
  readonly loop?: { readonly start: number; readonly end: number };
}

/** One member of an emitter's pool, with what its voices vary by and where they play. */
export interface PoolMember extends MemberSound {
  readonly member: GroupMember;
  readonly variation: VoiceVariation;
  readonly bus: BusName | undefined;
}

/** What a scenario's emitters play by. */
export interface PreviewSubjects {
  readonly emitterRules: (subject: PreviewSubject) => EmitterRules;
  /** Empty where no member of the subject has a sound. */
  readonly poolOf: (subject: PreviewSubject) => readonly PoolMember[];
}

/**
 * What each subject plays by in `state`, its members' sounds given by `sounds`
 * (a member it gives none is left out of every pool).
 */
export function previewSubjects(
  project: Project,
  state: GameAudioState,
  sounds: (member: GroupMember) => MemberSound | undefined,
): PreviewSubjects {
  const policies = resolveAll(project, state);
  const groupPolicy = groupPolicies(state);
  const poolMember = (member: GroupMember): PoolMember | undefined => {
    const sound = sounds(member);
    if (sound === undefined) return undefined;
    const policy = policies.get(memberKey(member));
    return {
      ...sound,
      member,
      variation: policy?.variation.value ?? DEFAULT_VOICE_VARIATION,
      bus: policy?.bus.value,
    };
  };
  return {
    emitterRules: (subject) => {
      const rules =
        subject.kind === 'group'
          ? state.groups.has(subject.group)
            ? groupPolicy(subject.group).fields.emitter.value
            : undefined
          : policies.get(memberKey(subject.member))?.emitter.value;
      return rules ?? DEFAULT_EMITTER_RULES;
    },
    poolOf: (subject) => {
      const members =
        subject.kind === 'member'
          ? [subject.member]
          : state.memberships
              .filter((membership) => membership.group === subject.group)
              .map((membership) => membership.member);
      return members.flatMap((member) => poolMember(member) ?? []);
    },
  };
}
