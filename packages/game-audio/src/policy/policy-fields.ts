/**
 * The fields of a group's policy (ADR-0101): the one statement of them, read by
 * the commands, the resolver, the validator, the project format and the
 * Inspector, one per default `REQ-GAME-120` names.
 */

import type { EffectChainId } from '@audiogubbins/domain';

import type { DestinationPath } from '../export/destination-path.js';
import type { GameExportProfile } from '../export/game-export-profile.js';
import type { NamingTemplate } from '../export/naming-template.js';
import type { BusName } from './bus-name.js';
import type { LoudnessTarget } from './loudness-target.js';
import type { EmitterRules, VoiceVariation } from './playback-rules.js';

export const POLICY_FIELDS = [
  'processing',
  'loudness',
  'exportProfile',
  'naming',
  'destination',
  'emitter',
  'variation',
  'bus',
  'tags',
] as const;

export type PolicyField = (typeof POLICY_FIELDS)[number];

/** What each field holds where it is set. */
export interface PolicyValues {
  /** The chain a member's rack is while it inherits, or `none`: no rack. */
  readonly processing: EffectChainId | 'none';
  readonly loudness: LoudnessTarget;
  readonly exportProfile: GameExportProfile;
  readonly naming: NamingTemplate;
  readonly destination: DestinationPath;
  /** How a player of the group behaves. */
  readonly emitter: EmitterRules;
  /** How each voice of a member varies. */
  readonly variation: VoiceVariation;
  readonly bus: BusName;
  /** Added to every tag below, never replacing one. */
  readonly tags: readonly string[];
}
