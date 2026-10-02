/**
 * The marker commands (ADR-0047): adding, moving and removing the markers of an
 * asset of the project, each one project command, or one change of several,
 * that the project's history keeps and undo reverses. A marker made from a
 * tool, a key, the palette or the picture panel is made here, and every view of
 * the asset shows it (REQ-EDIT-061). Audio no project holds takes no marker,
 * and the commands say why.
 *
 * A command names its asset with the `asset` argument, or acts on the asset of
 * the view it names or of the editor last in use. Positions are the view's: a
 * region's view places a marker on its asset at the region's start plus the
 * position, anchored to the asset's chain as it stands.
 */

import {
  CommandCategory,
  unchanged,
  type Command,
  type CommandInvocation,
} from '@audiogubbins/commands';
import {
  isWellFormedId,
  unsafeBrandId,
  type Marker,
  type MarkerId,
  type SampleCount,
} from '@audiogubbins/domain';
import {
  addMarkerInvocation,
  removeMarkerInvocation,
  setMarkerInvocation,
} from '@audiogubbins/project-commands';
import {
  SelectionFacet,
  TimeFormatKind,
  formatPosition,
  type MadeFacet,
  type TargetRequest,
  type TimeFormat,
} from '@audiogubbins/timeline';

import type { EditorAsset } from '../assets/editor-asset.js';
import { boundaryArgument, editorTarget, playheadOf, selectedTarget } from './editor-target.js';
import {
  changeProject,
  currentBasis,
  needsProjectAsset,
  onAsset,
  projectTarget,
  type ProjectTarget,
} from './project-edits.js';
import { markerIdsOf } from './selection-commands.js';
import { shellCommand, textArgument, type BodyAnswer } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** An asset a marker command acts on, the format it speaks positions in, and its project. */
export interface MarkedAsset {
  readonly asset: EditorAsset;
  readonly format: TimeFormat;
  readonly project: ProjectTarget;
}

/** The asset a command names, or the asset of its view; the format it speaks in; or why none. */
function assetOf(
  context: ShellContext,
  invocation: CommandInvocation,
): { readonly asset: EditorAsset; readonly format: TimeFormat } | string {
  const named = textArgument(invocation, 'asset');
  if (named !== undefined) {
    const asset = context.assets.find(named);
    return asset === undefined
      ? 'That asset is not open in this session.'
      : { asset, format: { kind: TimeFormatKind.Clock } };
  }
  const target = editorTarget(context, invocation);
  return typeof target === 'string'
    ? target
    : { asset: target.asset, format: target.state.timeFormat };
}

/** The asset a marker command acts on, as the project holds it, or why there is none. */
export function markedAsset(
  context: ShellContext,
  invocation: CommandInvocation,
): MarkedAsset | string {
  const found = assetOf(context, invocation);
  if (typeof found === 'string') return found;
  const project = projectTarget(context, found.asset);
  return typeof project === 'string' ? project : { ...found, project };
}

/** The markers of the asset `project` shows, as the project holds them. */
function heldMarkers(project: ProjectTarget): readonly Marker[] {
  const id = project.owner.asset.id;
  return [...project.state.project.markers.values()].filter((marker) => marker.assetId === id);
}

/** The first "Marker n" not in use on the asset. */
function nextName(markers: readonly Marker[]): string {
  const taken = new Set(markers.map((marker) => marker.displayName));
  let number = markers.length + 1;
  while (taken.has(`Marker ${String(number)}`)) number += 1;
  return `Marker ${String(number)}`;
}

/** A marker command, available where the editor last in use shows an asset of the project. */
export function markerCommand(
  id: string,
  label: string,
  run: (context: ShellContext, invocation: CommandInvocation) => BodyAnswer,
  extra: {
    readonly keywords?: readonly string[];
    readonly discoverable?: boolean;
    readonly availability?: Command<ShellContext>['availability'];
  } = {},
): Command<ShellContext> {
  const { availability = needsProjectAsset, ...rest } = extra;
  return shellCommand(id, label, CommandCategory.Edit, run, { availability, ...rest });
}

/**
 * Adds a marker to the asset at `position` of its view, named `name` or the
 * next free "Marker n", under identity `id` or a new one.
 */
export function addMarker(
  context: ShellContext,
  found: MarkedAsset,
  position: SampleCount,
  options: { readonly id?: string; readonly name?: string } = {},
): void {
  const { asset, format, project } = found;
  const marker: Marker = {
    id:
      options.id !== undefined && isWellFormedId(options.id)
        ? unsafeBrandId<'MarkerId'>(options.id)
        : context.ids.next<'MarkerId'>(),
    assetId: project.owner.asset.id,
    displayName: options.name ?? nextName(heldMarkers(project)),
    basis: currentBasis(project.owner),
    position: onAsset(project.owner, position),
  };
  changeProject(context, project.session, {
    description: `Add ${marker.displayName}`,
    invocations: [addMarkerInvocation(marker)],
    said: `${marker.displayName} added at ${formatPosition(position, asset.sampleRate, format)}.`,
  });
}

function addMarkerCommand(): Command<ShellContext> {
  return markerCommand(
    'editor.add-marker',
    'Add a marker at the playhead',
    (context, invocation) => {
      const found = markedAsset(context, invocation);
      if (typeof found === 'string') return found;
      const id = textArgument(invocation, 'id');
      const name = textArgument(invocation, 'name');
      addMarker(
        context,
        found,
        boundaryArgument(invocation, 'at', found.asset) ?? playheadOf(context, found.asset),
        { ...(id === undefined ? {} : { id }), ...(name === undefined ? {} : { name }) },
      );
      return undefined;
    },
    { keywords: ['marker', 'add', 'mark', 'cue', 'point'] },
  );
}

/** Objects, and nothing else: a delete never falls back to a range, nor to everything. */
const MARKERS_SELECTED: TargetRequest = {
  accepts: new Set<MadeFacet>([SelectionFacet.Objects]),
  whenNothing: 'refuse',
};

/** The markers the active selection in `asset` holds, or why it holds none. */
export function selectedMarkers(
  context: ShellContext,
  asset: EditorAsset,
): readonly MarkerId[] | string {
  const target = selectedTarget(context, asset, MARKERS_SELECTED);
  if (typeof target === 'string') return target;
  if (target.kind !== 'objects' || target.objects.kind !== 'markers') {
    return 'The active selection holds no markers. Click a marker first.';
  }
  return target.objects.ids;
}

/** The markers named, as the project holds them, or why one of them is not the asset's. */
export function markersNamed(
  found: MarkedAsset,
  ids: readonly MarkerId[],
): readonly [Marker, ...Marker[]] | string {
  const named = heldMarkers(found.project).filter((marker) => ids.includes(marker.id));
  const [first, ...rest] = named;
  if (first === undefined || named.length !== new Set(ids).size) {
    return `Those markers are not all in ${found.asset.name}.`;
  }
  return [first, ...rest];
}

function removeMarkersCommand(): Command<ShellContext> {
  return markerCommand(
    'editor.remove-markers',
    'Remove the selected markers',
    (context, invocation) => {
      const found = markedAsset(context, invocation);
      if (typeof found === 'string') return found;
      const named = markerIdsOf(textArgument(invocation, 'markers'));
      const ids = named.length > 0 ? named : selectedMarkers(context, found.asset);
      if (typeof ids === 'string') return ids;
      const markers = markersNamed(found, ids);
      if (typeof markers === 'string') return markers;
      const [first, ...rest] = markers;
      const many = `${String(markers.length)} markers`;
      changeProject(context, found.project.session, {
        description: rest.length === 0 ? `Remove ${first.displayName}` : `Remove ${many}`,
        invocations: [removeMarkerInvocation(first), ...rest.map(removeMarkerInvocation)],
        said: rest.length === 0 ? `${first.displayName} removed.` : `${many} removed.`,
      });
      return undefined;
    },
    { keywords: ['marker', 'remove', 'delete', 'clear'] },
  );
}

/**
 * Moves each marker to where `to` places it on the asset's view, as one
 * change; unchanged where every one is there already.
 */
export function moveMarkers(
  context: ShellContext,
  found: MarkedAsset,
  moves: readonly { readonly marker: Marker; readonly to: SampleCount }[],
): BodyAnswer {
  const { asset, format, project } = found;
  const placed = new Map(asset.markers.map((marker) => [marker.id, marker.position]));
  const moving = moves.filter(({ marker, to }) => placed.get(marker.id) !== to);
  const [first, ...rest] = moving;
  if (first === undefined) {
    return unchanged('editor.marker-there', 'The markers are there already.');
  }
  const basis = currentBasis(project.owner);
  const setAt = ({ marker, to }: (typeof moving)[number]): CommandInvocation =>
    setMarkerInvocation({ ...marker, basis, position: onAsset(project.owner, to) });
  const many = `${String(moving.length)} markers`;
  changeProject(context, project.session, {
    description: rest.length === 0 ? `Move ${first.marker.displayName}` : `Move ${many}`,
    invocations: [setAt(first), ...rest.map(setAt)],
    said:
      rest.length === 0
        ? `${first.marker.displayName} moved to ${formatPosition(first.to, asset.sampleRate, format)}.`
        : `${many} moved.`,
  });
  return undefined;
}

function moveMarkerCommand(): Command<ShellContext> {
  return markerCommand(
    'editor.move-marker',
    'Move a marker',
    (context, invocation) => {
      const found = markedAsset(context, invocation);
      if (typeof found === 'string') return found;
      const [id] = markerIdsOf(textArgument(invocation, 'marker'));
      const to = boundaryArgument(invocation, 'to', found.asset);
      if (id === undefined || to === undefined) {
        return 'A move needs a marker and a position within the asset.';
      }
      const markers = markersNamed(found, [id]);
      if (typeof markers === 'string') return markers;
      return moveMarkers(context, found, [{ marker: markers[0], to }]);
    },
    { discoverable: false },
  );
}

/** The commands that add, move and remove markers. */
export function markerCommands(): readonly Command<ShellContext>[] {
  return [addMarkerCommand(), removeMarkersCommand(), moveMarkerCommand()];
}
