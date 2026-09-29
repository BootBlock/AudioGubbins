/**
 * Ambisonic channel sets.
 *
 * REQ-ARCH-157 asks for ambisonic channel sets with their ordering and
 * normalisation conventions. An ambisonic channel is a spherical-harmonic
 * component, not a speaker, so which component a channel carries is decided by
 * the set's ordering rather than by a role: the layout states the convention,
 * and this module answers which component sits in each channel (ADR-0033).
 */

import {
  AmbisonicNormalisation,
  AmbisonicOrdering,
  ChannelRole,
  MAXIMUM_CHANNEL_COUNT,
  type AmbisonicConvention,
  type ChannelLayout,
} from './channel-layout.js';
import { failure, FailureKind, type DomainResult, fail, succeed } from '../result.js';

/** The highest order the Furse-Malham conventions define. */
const HIGHEST_FUMA_ORDER = 3;

/**
 * The ACN of each Furse-Malham channel, W X Y Z R S T U V K L M N O P Q.
 *
 * FuMa names its components by letter in an order of its own; the ACN of the
 * component in FuMa channel `i` is `FUMA_TO_ACN[i]`.
 */
const FUMA_TO_ACN: readonly number[] = [0, 3, 1, 2, 6, 7, 5, 8, 4, 12, 13, 11, 14, 10, 15, 9];

/** The spherical-harmonic component one channel carries. */
export interface AmbisonicComponent {
  /** The degree `l`, from 0. */
  readonly degree: number;

  /** The index `m`, from `-degree` to `degree`. */
  readonly index: number;

  /** The component's Ambisonic Channel Number, `l(l + 1) + m`. */
  readonly acn: number;
}

/** How many channels a full-sphere set of an order holds. */
export function ambisonicChannelCount(order: number): number {
  return (order + 1) * (order + 1);
}

/** Why a convention cannot describe a set, or `undefined` when it can. */
function problemWithConvention(convention: AmbisonicConvention): DomainResult<never> | undefined {
  const { order, ordering, normalisation } = convention;
  if (
    !Number.isInteger(order) ||
    order < 0 ||
    ambisonicChannelCount(order) > MAXIMUM_CHANNEL_COUNT
  ) {
    return fail(
      failure(
        'channel.ambisonic-order-invalid',
        FailureKind.Rejected,
        `An ambisonic order must be a whole number whose set fits in ${String(MAXIMUM_CHANNEL_COUNT)} channels.`,
        { details: { order: String(order) } },
      ),
    );
  }
  const fuma = ordering === AmbisonicOrdering.FuMa;
  if (fuma !== (normalisation === AmbisonicNormalisation.FuMa)) {
    // No format pairs the FuMa order with another scaling or the reverse, so a
    // layout claiming one would be a set nothing could read correctly.
    return fail(
      failure(
        'channel.ambisonic-convention-mixed',
        FailureKind.Rejected,
        'The Furse-Malham ordering and normalisation are used together or not at all.',
        { details: { ordering, normalisation } },
      ),
    );
  }
  if (fuma && order > HIGHEST_FUMA_ORDER) {
    return fail(
      failure(
        'channel.ambisonic-fuma-order-too-high',
        FailureKind.Rejected,
        `The Furse-Malham convention is defined to order ${String(HIGHEST_FUMA_ORDER)}.`,
        { details: { order } },
      ),
    );
  }
  return undefined;
}

/** Builds a full-sphere ambisonic layout of a stated convention. */
export function ambisonicLayout(convention: AmbisonicConvention): DomainResult<ChannelLayout> {
  const problem = problemWithConvention(convention);
  if (problem !== undefined) return problem;

  const rest = Array.from(
    { length: ambisonicChannelCount(convention.order) - 1 },
    () => ChannelRole.Ambisonic,
  );
  return succeed({
    roles: [ChannelRole.Ambisonic, ...rest],
    ambisonic: {
      order: convention.order,
      ordering: convention.ordering,
      normalisation: convention.normalisation,
    },
  });
}

/**
 * The component channel `channel` of an ambisonic layout carries, or
 * `undefined` when the layout is not ambisonic or has no such channel.
 */
export function ambisonicComponentOf(
  layout: ChannelLayout,
  channel: number,
): AmbisonicComponent | undefined {
  const convention = layout.ambisonic;
  if (convention === undefined || channel < 0 || channel >= layout.roles.length) return undefined;

  const acn = convention.ordering === AmbisonicOrdering.FuMa ? FUMA_TO_ACN[channel] : channel;
  if (acn === undefined) return undefined;
  const degree = Math.floor(Math.sqrt(acn));
  return { degree, index: acn - degree * degree - degree, acn };
}

/** The first-order AmbiX set: ACN ordering, SN3D normalisation. */
export const FIRST_ORDER_AMBIX: AmbisonicConvention = {
  order: 1,
  ordering: AmbisonicOrdering.Acn,
  normalisation: AmbisonicNormalisation.Sn3d,
};
