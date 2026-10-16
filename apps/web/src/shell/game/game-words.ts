/**
 * What the Asset groups panel and the Inspector say of a group's policy
 * (ADR-0101): each value as a person reads it, where it comes from in words
 * ("Set on Footsteps", "Inherited from Footsteps/Grass", "Overridden on this
 * region", "Not set"), what an override or a nearer group hides, and how a
 * member's loudness stands against its target. Words only: the values and
 * their sources are the game-audio package's resolution, read through
 * `game-policy-view.ts`.
 */

import type { EffectChainId, Project } from '@audiogubbins/domain';
import {
  pathText,
  type Attenuation,
  type BusName,
  type DestinationPath,
  type EmitterRules,
  type GameAssetGroupId,
  type GameExportProfile,
  type LoudnessTarget,
  type NamingTemplate,
  type PolicyField,
  type PolicySource,
  type PolicyValues,
  type VoiceVariation,
} from '@audiogubbins/game-audio';
import { formatName } from '@audiogubbins/import-export';
import { quoted } from '@audiogubbins/text';

import { chainWords } from '../../commands/rack-words.js';
import type { GamePolicyView } from '../../state/game-policy-view.js';
import { sampleRateWords } from '../../wording.js';

/** A signed number as a person reads it, with a true minus sign. */
export function signed(value: number, digits = 1): string {
  const text = Math.abs(value).toFixed(digits).replace(/\.0+$/u, '');
  return value < 0 ? `−${text}` : text;
}

/** A loudness target in words. */
export function loudnessWords(target: LoudnessTarget): string {
  const ceiling =
    target.truePeakCeilingDbtp === undefined
      ? ''
      : `, true peak under ${signed(target.truePeakCeilingDbtp)} dBTP`;
  return `${signed(target.integratedLufs)} LUFS within ${signed(target.toleranceLu)} LU${ceiling}`;
}

/** What an export profile chooses, in words; the rest is each member's highest quality. */
function profileWords(profile: GameExportProfile): string {
  const { choices } = profile;
  const rate = choices.sampleRate === undefined ? '' : ` at ${sampleRateWords(choices.sampleRate)}`;
  const bits =
    choices.encoding !== undefined && 'bits' in choices.encoding
      ? `, ${String(choices.encoding.bits)}-bit`
      : '';
  return `${formatName(profile.format)}${bits}${rate}`;
}

/** A destination folder in words. */
export function destinationWords(destination: DestinationPath): string {
  return destination.segments.length === 0
    ? 'the folder exported to itself'
    : quoted(destination.segments.join('/'));
}

function attenuationWords(attenuation: Attenuation): string {
  switch (attenuation.kind) {
    case 'none':
      return 'no attenuation';
    case 'exponent':
      return `attenuation by exponent ${signed(attenuation.exponent, 2)}, silent from ${signed(attenuation.maxDistance)}`;
    default:
      return `${attenuation.kind} attenuation from ${signed(attenuation.unitSize)} to ${signed(attenuation.maxDistance)}`;
  }
}

/** Emitter rules in words. */
export function emitterWords(rules: EmitterRules): string {
  const selection =
    rules.selection.kind === 'uniform'
      ? 'chooses at random'
      : `never repeats the last ${String(rules.selection.depth)}`;
  const cooldown =
    rules.cooldownMilliseconds === 0
      ? 'no cooldown'
      : `${String(rules.cooldownMilliseconds)} ms between triggers`;
  const filter =
    rules.filter === undefined
      ? ''
      : `, a distance filter at ${String(rules.filter.cutoffHertz)} Hz`;
  return `It ${selection}, sounds ${String(rules.voices.limit)} voices stealing the ${rules.voices.stealing === 'reject' ? 'none, refusing more' : rules.voices.stealing}, with ${cooldown} and ${attenuationWords(rules.attenuation)}${filter}`;
}

/** Voice variation in words. */
export function variationWords(variation: VoiceVariation): string {
  const { pitchCents, gainDecibels, startOffsetMilliseconds } = variation;
  return `Pitch ${signed(pitchCents.min, 0)} to ${signed(pitchCents.max, 0)} cents, gain ${signed(gainDecibels.min)} to ${signed(gainDecibels.max)} dB, start up to ${String(startOffsetMilliseconds.max)} ms in`;
}

/** The processing a group names, in words: its chain's processors, or none. */
function processingWords(project: Project, processing: EffectChainId | 'none'): string {
  if (processing === 'none') return 'No processing';
  const chain = project.effectChains.get(processing);
  return chain === undefined ? 'A chain the project no longer holds' : chainWords(chain);
}

/** Each field's value as a person reads it. */
export function valueWords<F extends PolicyField>(
  project: Project,
  field: F,
  value: PolicyValues[F],
): string {
  const words: { readonly [K in PolicyField]: (value: PolicyValues[K]) => string } = {
    processing: (one: EffectChainId | 'none') => processingWords(project, one),
    loudness: loudnessWords,
    exportProfile: profileWords,
    naming: (template: NamingTemplate) => quoted(template.source),
    destination: destinationWords,
    emitter: emitterWords,
    variation: variationWords,
    bus: (bus: BusName) => quoted(bus),
    tags: (tags: readonly string[]) => tags.join(', '),
  };
  return words[field](value);
}

/** What a policy is shown for: a member, by its kind, or a group. */
export type PolicySubject =
  | { readonly kind: 'member'; readonly member: 'region' | 'asset' }
  | { readonly kind: 'group'; readonly group: GameAssetGroupId };

/**
 * Where a value comes from, in words, for `subject`: set on the group shown
 * or the member's own group, inherited from a group above, overridden on the
 * member, or not set anywhere.
 */
export function sourceWords(
  source: PolicySource,
  subject: PolicySubject,
  view: Pick<GamePolicyView, 'pathOf'>,
  memberGroup?: GameAssetGroupId,
): string {
  switch (source.kind) {
    case 'unset':
      return 'Not set';
    case 'override':
      return `Overridden on this ${subject.kind === 'member' ? subject.member : 'member'}`;
    case 'group': {
      const own = subject.kind === 'group' ? subject.group : memberGroup;
      if (source.group === own) {
        return subject.kind === 'group' ? 'Set on this group' : `Set on ${pathText(source.path)}`;
      }
      return `Inherited from ${pathText(view.pathOf(source.group))}`;
    }
  }
}

/** What an unset field means where it is used, beside "Not set". */
export const UNSET_MEANING: Readonly<Record<PolicyField, string>> = {
  processing: 'Inheriting members have no rack.',
  loudness: 'Its members are measured against no target.',
  exportProfile: 'Its members cannot be exported until one is set.',
  naming: 'Its members cannot be exported or named until one is set.',
  destination: 'Its files go into the folder exported to itself.',
  emitter: 'The preview plays it by the default rules.',
  variation: 'The preview plays every voice as it is.',
  bus: 'The preview plays it on no bus of its own.',
  tags: '',
};
