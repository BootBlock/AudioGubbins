/**
 * The marker commands (ADR-0047): adding, moving and removing an asset's
 * markers for the session, each giving the invocation that reverses it, so they
 * join the project's history unchanged when the project holds them (ADR-0021).
 * A marker made from a tool, a key, the palette or the picture panel is made
 * here, and every view of the asset shows it (REQ-EDIT-061).
 *
 * A command names its asset with the `asset` argument, as a reversal does, or
 * acts on the asset of the view it names or of the editor last in use.
 */

import {
  CommandCategory,
  commandId,
  refusal,
  type Command,
  type CommandInvocation,
  type CommandOutcome,
  type UnchangedOutcome,
  unchanged,
} from '@audiogubbins/commands';
import {
  combine,
  mapResult,
  sampleCount,
  unsafeBrandId,
  isWellFormedId,
  type DomainResult,
  type Marker,
  type MarkerId,
  type SampleCount,
} from '@audiogubbins/domain';
import {
  SelectionFacet,
  TimeFormatKind,
  formatPosition,
  type MadeFacet,
  type TargetRequest,
  type TimeFormat,
} from '@audiogubbins/timeline';

import type { EditorAsset } from '../assets/editor-asset.js';
import {
  boundaryArgument,
  editorTarget,
  needsEditor,
  playheadOf,
  selectedTarget,
} from './editor-target.js';
import { isRecord } from '../state/stored-value.js';
import { markerIdsOf } from './selection-commands.js';
import { textArgument } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** The asset a marker command acts on, the format it speaks positions in, or why there is none. */
export function assetOf(
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

/** What a marker command did: how to reverse it, and what to call it. */
export interface Done {
  readonly inverse: CommandInvocation;
  readonly description: string;
}

/** An undoable command that changes markers, saying what it did. */
export function markerCommand(
  id: string,
  label: string,
  run: (context: ShellContext, invocation: CommandInvocation) => Done | UnchangedOutcome | string,
  extra: {
    readonly keywords?: readonly string[];
    readonly discoverable?: boolean;
    readonly availability?: Command<ShellContext>['availability'];
  } = {},
): Command<ShellContext> {
  const { availability = needsEditor, ...rest } = extra;
  return {
    id: commandId(id),
    label,
    category: CommandCategory.Edit,
    undoable: true,
    availability,
    run(context, invocation): CommandOutcome<ShellContext> {
      const done = run(context, invocation);
      if (typeof done === 'string') return refusal(`${id}.refused`, done);
      if ('kind' in done) return done;
      context.interaction.announce(`${done.description}.`);
      return {
        kind: 'applied',
        next: context,
        inverse: done.inverse,
        description: done.description,
      };
    },
    ...rest,
  };
}

/** The first "Marker n" not in use in `markers`. */
function nextName(markers: readonly Marker[]): string {
  const taken = new Set(markers.map((marker) => marker.displayName));
  let number = markers.length + 1;
  while (taken.has(`Marker ${String(number)}`)) number += 1;
  return `Marker ${String(number)}`;
}

/** Markers as a reversal carries them: identity, name and position. */
function written(markers: readonly Marker[]): string {
  return JSON.stringify(
    markers.map((marker) => ({
      id: marker.id,
      name: marker.displayName,
      position: marker.position,
    })),
  );
}

/** Markers a reversal carries, each checked as a marker is checked anywhere, or why not. */
function readWritten(text: string | undefined): DomainResult<readonly Marker[]> | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text ?? '');
  } catch {
    return 'The markers to restore could not be read.';
  }
  if (!Array.isArray(parsed)) return 'The markers to restore could not be read.';
  const markers: DomainResult<Marker>[] = [];
  for (const value of parsed) {
    if (!isRecord(value)) return 'A marker to restore is not one.';
    const { id, name, position } = value;
    if (typeof id !== 'string' || !isWellFormedId(id) || typeof name !== 'string') {
      return 'A marker to restore has no usable identity or name.';
    }
    if (typeof position !== 'number') return 'A marker to restore has no position.';
    markers.push(
      mapResult(sampleCount(position), (at) => ({
        id: unsafeBrandId<'MarkerId'>(id),
        displayName: name,
        position: at,
      })),
    );
  }
  return combine(markers);
}

/**
 * Adds a marker to `asset` at `position`, named `name` or the next free
 * "Marker n", under identity `id` or a new one: what the add reverses by.
 */
export function addedMarker(
  context: ShellContext,
  asset: EditorAsset,
  format: TimeFormat,
  position: SampleCount,
  options: { readonly id?: string; readonly name?: string } = {},
): Done | string {
  const marker: Marker = {
    id:
      options.id !== undefined && isWellFormedId(options.id)
        ? unsafeBrandId<'MarkerId'>(options.id)
        : context.ids.next<'MarkerId'>(),
    displayName: options.name ?? nextName(context.content.of(asset).markers),
    position,
  };
  const added = context.content.addMarker(asset, marker);
  if (!added.ok) return added.failures[0].summary;
  return {
    inverse: {
      commandId: commandId('editor.remove-markers'),
      arguments: { asset: asset.id, markers: marker.id },
    },
    description: `${marker.displayName} added at ${formatPosition(position, asset.sampleRate, format)}`,
  };
}

function addMarker(): Command<ShellContext> {
  return markerCommand(
    'editor.add-marker',
    'Add a marker at the playhead',
    (context, invocation) => {
      const found = assetOf(context, invocation);
      if (typeof found === 'string') return found;
      const { asset, format } = found;
      const id = textArgument(invocation, 'id');
      const name = textArgument(invocation, 'name');
      return addedMarker(
        context,
        asset,
        format,
        boundaryArgument(invocation, 'at', asset) ?? playheadOf(context, asset),
        { ...(id === undefined ? {} : { id }), ...(name === undefined ? {} : { name }) },
      );
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

function removeMarkers(): Command<ShellContext> {
  return markerCommand(
    'editor.remove-markers',
    'Remove the selected markers',
    (context, invocation) => {
      const found = assetOf(context, invocation);
      if (typeof found === 'string') return found;
      const { asset } = found;
      const named = markerIdsOf(textArgument(invocation, 'markers'));
      const ids = named.length > 0 ? named : selectedMarkers(context, asset);
      if (typeof ids === 'string') return ids;
      const removed: Marker[] = [];
      for (const id of ids) {
        const gone = context.content.removeMarker(asset, id);
        if (gone.ok) removed.push(gone.value);
      }
      if (removed.length === 0) return `None of those markers is in ${asset.name}.`;
      return {
        inverse: {
          commandId: commandId('editor.restore-markers'),
          arguments: { asset: asset.id, markers: written(removed) },
        },
        description:
          removed.length === 1
            ? `${removed[0]?.displayName ?? 'The marker'} removed`
            : `${String(removed.length)} markers removed`,
      };
    },
    { keywords: ['marker', 'remove', 'delete', 'clear'] },
  );
}

function restoreMarkers(): Command<ShellContext> {
  return markerCommand(
    'editor.restore-markers',
    'Restore markers',
    (context, invocation) => {
      const found = assetOf(context, invocation);
      if (typeof found === 'string') return found;
      const read = readWritten(textArgument(invocation, 'markers'));
      if (typeof read === 'string') return read;
      if (!read.ok) return read.failures[0].summary;
      for (const marker of read.value) {
        const added = context.content.addMarker(found.asset, marker);
        if (!added.ok) return added.failures[0].summary;
      }
      return {
        inverse: {
          commandId: commandId('editor.remove-markers'),
          arguments: {
            asset: found.asset.id,
            markers: read.value.map((marker) => marker.id).join(','),
          },
        },
        description:
          read.value.length === 1
            ? 'A marker restored'
            : `${String(read.value.length)} markers restored`,
      };
    },
    { discoverable: false },
  );
}

function moveMarker(): Command<ShellContext> {
  return markerCommand(
    'editor.move-marker',
    'Move a marker',
    (context, invocation) => {
      const found = assetOf(context, invocation);
      if (typeof found === 'string') return found;
      const { asset, format } = found;
      const [id] = markerIdsOf(textArgument(invocation, 'marker'));
      const to = boundaryArgument(invocation, 'to', asset);
      if (id === undefined || to === undefined) {
        return 'A move needs a marker and a position within the asset.';
      }
      const moved = context.content.moveMarker(asset, id, to);
      if (!moved.ok) return moved.failures[0].summary;
      if (moved.value === to)
        return unchanged('editor.marker-there', 'The marker is there already.');
      const name = context.content
        .of(asset)
        .markers.find((marker) => marker.id === id)?.displayName;
      return {
        inverse: {
          commandId: commandId('editor.move-marker'),
          arguments: { asset: asset.id, marker: id, to: moved.value },
        },
        description: `${name ?? 'The marker'} moved to ${formatPosition(to, asset.sampleRate, format)}`,
      };
    },
    { discoverable: false },
  );
}

/** The commands that add, move and remove markers. */
export function markerCommands(): readonly Command<ShellContext>[] {
  return [addMarker(), removeMarkers(), restoreMarkers(), moveMarker()];
}
