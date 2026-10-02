/**
 * Adding, changing and removing markers, each with its inverse (ADR-0047,
 * ADR-0051).
 *
 * A marker is kept whole in an argument, in the project document's shape, so
 * moving and renaming are one command that sets the marker as given and whose
 * inverse sets it back as it was. Its position is checked against its asset's
 * timeline at its basis by the domain's own rule.
 */

import {
  CommandCategory,
  refusal,
  unchanged,
  type CommandInvocation,
  type CommandOutcome,
} from '@audiogubbins/commands';
import {
  FailureKind,
  fail,
  failure,
  validateMarker,
  type DomainResult,
  type Marker,
} from '@audiogubbins/domain';
import {
  canonicalJson,
  readMarker,
  writeMarker,
  type ProjectState,
} from '@audiogubbins/project-format';

import { jsonArgument, readNested, refusedBy } from '../invocation-arguments.js';
import {
  NO_PROVENANCE,
  ProjectCommandId,
  applied,
  projectCommand,
  quoted,
  type ProjectCommand,
} from '../project-command.js';
import { targetMarker } from './editing-arguments.js';
import { withMarker, withoutMarker } from './editing-state.js';

/** The commands that add, set and remove markers. */
export function markerCommands(): readonly ProjectCommand[] {
  return [
    projectCommand({
      id: ProjectCommandId.AddMarker,
      label: 'Add a marker',
      category: CommandCategory.Edit,
      description: 'Adds a marker to one of the project’s assets.',
      run: addMarker,
      provenance: NO_PROVENANCE,
    }),
    projectCommand({
      id: ProjectCommandId.SetMarker,
      label: 'Change a marker',
      category: CommandCategory.Edit,
      description: 'Moves or renames a marker, setting it as given.',
      run: setMarker,
      provenance: NO_PROVENANCE,
    }),
    projectCommand({
      id: ProjectCommandId.RemoveMarker,
      label: 'Remove a marker',
      category: CommandCategory.Edit,
      description: 'Removes a marker from its asset.',
      run: removeMarker,
      provenance: NO_PROVENANCE,
    }),
  ];
}

/** The marker the argument `marker` holds, where it stands on an asset of the project. */
function markerArgument(state: ProjectState, invocation: CommandInvocation): DomainResult<Marker> {
  const value = jsonArgument(invocation, 'marker');
  if (!value.ok) return value;
  const marker = readNested(readMarker, value.value, '');
  if (!marker.ok) return marker;
  const asset = state.project.assets.get(marker.value.assetId);
  return asset === undefined
    ? fail(
        failure(
          'marker.asset-unknown',
          FailureKind.Rejected,
          'The project has no asset for this marker.',
        ),
      )
    : validateMarker(asset, marker.value);
}

function addMarker(
  state: ProjectState,
  invocation: CommandInvocation,
): CommandOutcome<ProjectState> {
  const read = markerArgument(state, invocation);
  if (!read.ok) return refusedBy(read);
  const marker = read.value;
  if (state.project.markers.has(marker.id)) {
    return refusal('marker.duplicate-id', 'The project already has a marker with that identifier.');
  }
  return applied(
    withMarker(state, marker),
    removeMarkerInvocation(marker),
    `Add marker ${quoted(marker.displayName)}`,
  );
}

function setMarker(
  state: ProjectState,
  invocation: CommandInvocation,
): CommandOutcome<ProjectState> {
  const read = markerArgument(state, invocation);
  if (!read.ok) return refusedBy(read);
  const marker = read.value;
  const old = state.project.markers.get(marker.id);
  if (old === undefined)
    return refusal('marker.unknown', 'The project has no marker with that identifier.');
  if (old.assetId !== marker.assetId) {
    return refusal('marker.asset-changed', 'A marker stays on the asset it was placed on.');
  }
  if (canonicalJson(writeMarker(old)) === canonicalJson(writeMarker(marker))) {
    return unchanged('marker.unchanged', 'The marker is already as given.');
  }
  const description =
    old.displayName === marker.displayName
      ? `Move marker ${quoted(marker.displayName)}`
      : `Rename marker ${quoted(old.displayName)} to ${quoted(marker.displayName)}`;
  return applied(withMarker(state, marker), setMarkerInvocation(old), description);
}

function removeMarker(
  state: ProjectState,
  invocation: CommandInvocation,
): CommandOutcome<ProjectState> {
  const marker = targetMarker(state, invocation);
  if (!marker.ok) return refusedBy(marker);
  return applied(
    withoutMarker(state, marker.value.id),
    addMarkerInvocation(marker.value),
    `Remove marker ${quoted(marker.value.displayName)}`,
  );
}

/** Adds `marker`. */
export function addMarkerInvocation(marker: Marker): CommandInvocation {
  return {
    commandId: ProjectCommandId.AddMarker,
    arguments: { marker: canonicalJson(writeMarker(marker)) },
  };
}

/** Sets an existing marker as `marker` gives it. */
export function setMarkerInvocation(marker: Marker): CommandInvocation {
  return {
    commandId: ProjectCommandId.SetMarker,
    arguments: { marker: canonicalJson(writeMarker(marker)) },
  };
}

/** Removes `marker`. */
export function removeMarkerInvocation(marker: Pick<Marker, 'id'>): CommandInvocation {
  return { commandId: ProjectCommandId.RemoveMarker, arguments: { markerId: marker.id } };
}
