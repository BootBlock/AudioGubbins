/**
 * Reading the editing commands' arguments: which marker, region or operation
 * an invocation names, each refused with a stable code and a reason when the
 * project has none by that identifier.
 */

import {
  FailureKind,
  fail,
  failure,
  isWellFormedId,
  succeed,
  unsafeBrandId,
  type Branded,
  type DomainResult,
  type Marker,
  type Region,
} from '@audiogubbins/domain';
import type { CommandInvocation } from '@audiogubbins/commands';
import type { ProjectState } from '@audiogubbins/project-format';

import { textArgument } from '../invocation-arguments.js';

function rejected(code: string, summary: string): DomainResult<never> {
  return fail(failure(code, FailureKind.Rejected, summary));
}

/** An identifier the argument `name` holds, of the brand the caller names. */
export function idArgument<TBrand extends string>(
  invocation: CommandInvocation,
  name: string,
): DomainResult<Branded<TBrand>> {
  const text = textArgument(invocation, name);
  if (!text.ok) return text;
  return isWellFormedId(text.value)
    ? succeed(unsafeBrandId<TBrand>(text.value))
    : rejected('argument.id-malformed', `The argument “${name}” is not an identifier AudioGubbins makes.`);
}

/** The marker the argument `markerId` names. */
export function targetMarker(state: ProjectState, invocation: CommandInvocation): DomainResult<Marker> {
  const id = idArgument<'MarkerId'>(invocation, 'markerId');
  if (!id.ok) return id;
  const marker = state.project.markers.get(id.value);
  return marker === undefined
    ? rejected('marker.unknown', 'The project has no marker with that identifier.')
    : succeed(marker);
}

/** The region the argument `regionId` names. */
export function targetRegion(state: ProjectState, invocation: CommandInvocation): DomainResult<Region> {
  const id = idArgument<'RegionId'>(invocation, 'regionId');
  if (!id.ok) return id;
  const region = state.project.regions.get(id.value);
  return region === undefined
    ? rejected('region.unknown', 'The project has no region with that identifier.')
    : succeed(region);
}
