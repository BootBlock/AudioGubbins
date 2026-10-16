/**
 * Each field of an asset group's policy as a sentence names it (ADR-0101), in
 * what the game commands say and the Inspector and the Asset groups panel
 * show, so a field goes by one name wherever the person meets it.
 */

import { POLICY_FIELDS, type OverridableField, type PolicyField } from '@audiogubbins/game-audio';

/** Each field of a policy as a sentence names it, in lower case. */
export const POLICY_FIELD_WORDS: Readonly<Record<PolicyField, string>> = {
  processing: 'processing',
  loudness: 'loudness target',
  exportProfile: 'export profile',
  naming: 'naming template',
  destination: 'destination folder',
  emitter: 'emitter rules',
  variation: 'voice variation',
  bus: 'bus',
  tags: 'tags',
};

/**
 * The fields a member may set over its group, typed over `OverridableField`,
 * so a field that joins or leaves it fails to compile here rather than being
 * offered, or not, by mistake.
 */
const OVERRIDABLE: Readonly<Record<OverridableField, true>> = {
  loudness: true,
  exportProfile: true,
  naming: true,
  destination: true,
  variation: true,
  bus: true,
};

/** The fields a member may set over its group, in the policy's order. */
export const OVERRIDABLE_FIELDS: readonly OverridableField[] = POLICY_FIELDS.filter(
  (field): field is OverridableField => field in OVERRIDABLE,
);
