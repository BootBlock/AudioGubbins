/**
 * Reading a channel layout out of an untrusted value.
 *
 * A layout is never taken as it arrives. Its parts are read and handed to the
 * domain's own builders, `channelLayout` and `ambisonicLayout`, and the layout
 * they build is the one the descriptor carries, so a forged layout, such as an
 * ambisonic set without its convention or a centre channel named twice, cannot
 * pass as one the domain would have made (ADR-0033, REQ-ARCH-157).
 */

import {
  AmbisonicNormalisation,
  AmbisonicOrdering,
  ChannelRole,
  ambisonicLayout,
  channelLayout,
  type AmbisonicConvention,
  type ChannelLayout,
  type DomainResult,
} from '@audiogubbins/domain';

import {
  type Problems,
  readEach,
  readFiniteNumber,
  readRecord,
  readText,
  report,
} from './value-reading.js';

const CHANNEL_ROLES: ReadonlySet<unknown> = new Set(Object.values(ChannelRole));
const ORDERINGS: ReadonlySet<unknown> = new Set(Object.values(AmbisonicOrdering));
const NORMALISATIONS: ReadonlySet<unknown> = new Set(Object.values(AmbisonicNormalisation));

function isChannelRole(value: unknown): value is ChannelRole {
  return CHANNEL_ROLES.has(value);
}

function isOrdering(value: unknown): value is AmbisonicOrdering {
  return ORDERINGS.has(value);
}

function isNormalisation(value: unknown): value is AmbisonicNormalisation {
  return NORMALISATIONS.has(value);
}

/** Reads the convention of an ambisonic set. */
function readConvention(
  value: unknown,
  path: string,
  problems: Problems,
): AmbisonicConvention | undefined {
  const record = readRecord(value, path, problems);
  if (record === undefined) return undefined;
  const order = readFiniteNumber(record['order'], `${path}.order`, problems);
  const ordering = record['ordering'];
  const normalisation = record['normalisation'];
  if (!isOrdering(ordering)) {
    report(problems, 'shape-invalid', `${path}.ordering`, 'expected an ambisonic ordering.');
  }
  if (!isNormalisation(normalisation)) {
    report(
      problems,
      'shape-invalid',
      `${path}.normalisation`,
      'expected an ambisonic normalisation.',
    );
  }
  if (order === undefined || !isOrdering(ordering) || !isNormalisation(normalisation)) {
    return undefined;
  }
  return { order, ordering, normalisation };
}

/** The failure a layout the domain refused is reported as. */
function refused(
  result: DomainResult<ChannelLayout>,
  path: string,
  problems: Problems,
): ChannelLayout | undefined {
  if (result.ok) return result.value;
  report(
    problems,
    'layout-invalid',
    path,
    `not a channel layout AudioGubbins accepts: ${result.failures[0].summary}`,
    result.failures[0],
  );
  return undefined;
}

/**
 * The ambisonic set a convention describes, built from the convention alone,
 * with the roles and labels the value claims held to that set.
 */
function readAmbisonic(
  roles: readonly ChannelRole[],
  labels: readonly string[] | undefined,
  convention: AmbisonicConvention,
  path: string,
  problems: Problems,
): ChannelLayout | undefined {
  const set = refused(ambisonicLayout(convention), path, problems);
  if (set === undefined) return undefined;
  const agrees =
    labels === undefined &&
    roles.length === set.roles.length &&
    roles.every((role) => role === ChannelRole.Ambisonic);
  if (agrees) return set;
  report(
    problems,
    'layout-invalid',
    path,
    'an ambisonic layout has one ambisonic role for each component its order holds, and no labels.',
  );
  return undefined;
}

/** Reads a channel layout, rebuilt by the domain. */
export function readLayout(
  value: unknown,
  path: string,
  problems: Problems,
): ChannelLayout | undefined {
  const record = readRecord(value, path, problems);
  if (record === undefined) return undefined;
  const roles = readEach(record['roles'], `${path}.roles`, problems, (role, rolePath) => {
    if (isChannelRole(role)) return role;
    report(problems, 'shape-invalid', rolePath, 'expected a channel role.');
    return undefined;
  });
  const labels =
    record['labels'] === undefined
      ? undefined
      : readEach(record['labels'], `${path}.labels`, problems, (label, labelPath) =>
          readText(label, labelPath, problems),
        );
  const convention =
    record['ambisonic'] === undefined
      ? undefined
      : readConvention(record['ambisonic'], `${path}.ambisonic`, problems);
  if (roles === undefined) return undefined;
  if (record['labels'] !== undefined && labels === undefined) return undefined;
  if (record['ambisonic'] !== undefined && convention === undefined) return undefined;

  return convention === undefined
    ? refused(channelLayout(roles, labels), path, problems)
    : readAmbisonic(roles, labels, convention, path, problems);
}
