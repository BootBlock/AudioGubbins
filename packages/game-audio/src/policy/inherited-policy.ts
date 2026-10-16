/**
 * What a group sets and what a member sets over it (ADR-0101), and the one way
 * each is changed: a field set to a value, or reset so it is inherited.
 *
 * A field a group does not set is inherited from its parent; one it sets is set
 * there, never copied into its descendants. No field holds a hidden default: a
 * reset removes the field, so what is inherited shows through.
 */

import { POLICY_FIELDS, type PolicyField, type PolicyValues } from './policy-fields.js';

/** What a group sets. */
export type InheritedPolicy = { readonly [F in PolicyField]?: PolicyValues[F] };

/**
 * The fields a member may set over its group. `processing` is the membership's
 * own record and the member's rack; `tags` add to a region's own; `emitter`
 * belongs to whoever plays the group, not to one sound in it.
 */
export type OverridableField = Exclude<PolicyField, 'processing' | 'tags' | 'emitter'>;

/**
 * Each field a member may override, named once in a record typed over
 * `OverridableField`, so a field the type gains or loses fails to compile here
 * rather than going unread by the commands or the project format.
 */
const OVERRIDABLE: Readonly<Record<OverridableField, true>> = {
  loudness: true,
  exportProfile: true,
  naming: true,
  destination: true,
  variation: true,
  bus: true,
};

/** Whether a member may set `field` over its group. */
export function isOverridableField(field: PolicyField): field is OverridableField {
  return field in OVERRIDABLE;
}

/** The fields a member may override, in the policy's order: the one list of them. */
export const OVERRIDABLE_FIELDS: readonly OverridableField[] =
  POLICY_FIELDS.filter(isOverridableField);

/** What a member sets over its group. */
export type PolicyOverrides = { readonly [F in OverridableField]?: PolicyValues[F] };

/** `policy` with `field` set to `value`, or reset to inherited where `value` is `undefined`. */
export function withPolicyField<F extends PolicyField>(
  policy: InheritedPolicy,
  field: F,
  value: PolicyValues[F] | undefined,
): InheritedPolicy {
  const changed: { -readonly [K in PolicyField]?: PolicyValues[K] } = { ...policy };
  if (value === undefined) Reflect.deleteProperty(changed, field);
  else changed[field] = value;
  return changed;
}

/** `overrides` with `field` set to `value`, or reset to inherited where `value` is `undefined`. */
export function withOverride<F extends OverridableField>(
  overrides: PolicyOverrides,
  field: F,
  value: PolicyValues[F] | undefined,
): PolicyOverrides {
  const changed: { -readonly [K in OverridableField]?: PolicyValues[K] } = { ...overrides };
  if (value === undefined) Reflect.deleteProperty(changed, field);
  else changed[field] = value;
  return changed;
}
