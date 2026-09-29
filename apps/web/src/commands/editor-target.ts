/**
 * Which editor view, and which asset, an editor command acts on.
 *
 * A command names its view with the `view` argument, as a pointer gesture in
 * one view does; without it, it acts on the editor last in use, as a shortcut
 * or the palette does. The answer is read afresh on each run, and a view that
 * shows no asset, or an asset no longer open, is a refusal with the reason,
 * never a guess at another view.
 */

import {
  AVAILABLE,
  unavailable,
  type CommandAvailability,
  type CommandInvocation,
} from '@audiogubbins/commands';
import { sampleCount, type SampleCount } from '@audiogubbins/domain';
import type { EditorViewState } from '@audiogubbins/editor-view';

import type { EditorAsset } from '../assets/editor-asset.js';
import type { EditorViewEntry } from '../state/editor-view-store.js';
import { textArgument } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** The view a command acts on, and what it shows. */
export interface EditorTarget {
  readonly panel: string;
  readonly entry: EditorViewEntry;
  readonly state: EditorViewState;
  readonly asset: EditorAsset;
}

const NO_VIEW = 'No editor view shows an asset. Open one from an Editor panel first.';

/** The target of `panel`, or why there is none. */
function targetOf(context: ShellContext, panel: string | undefined): EditorTarget | string {
  if (panel === undefined) return NO_VIEW;
  const entry = context.editorViews.entry(panel);
  if (entry === undefined) return NO_VIEW;
  const asset = context.assets.find(entry.asset);
  if (asset === undefined) {
    return 'The asset this view showed is not open in this session. Choose another in the view.';
  }
  return { panel, entry, state: entry.state, asset };
}

/** The target an invocation names, or the editor last in use; or why there is none. */
export function editorTarget(
  context: ShellContext,
  invocation: CommandInvocation,
): EditorTarget | string {
  return targetOf(context, textArgument(invocation, 'view') ?? context.editorViews.get().focused);
}

/** The target of the editor last in use, or why there is none. */
export function focusedEditor(context: ShellContext): EditorTarget | string {
  return targetOf(context, context.editorViews.get().focused);
}

/** Available where the editor last in use shows an asset, as a command that names none acts on it. */
export function needsEditor(context: ShellContext): CommandAvailability {
  const target = focusedEditor(context);
  return typeof target === 'string' ? unavailable(target) : AVAILABLE;
}

/**
 * A boundary argument, a whole number of frames within `asset`, or
 * `undefined` where it is absent or is not one: an invocation's arguments are
 * read rather than trusted, since a macro or a journal can carry any value.
 */
export function boundaryArgument(
  invocation: CommandInvocation,
  name: string,
  asset: EditorAsset,
): SampleCount | undefined {
  const value = invocation.arguments?.[name];
  if (typeof value !== 'number' || value > asset.length) return undefined;
  const read = sampleCount(value);
  return read.ok ? read.value : undefined;
}

/** A finite number argument, or `undefined`. */
export function numberArgument(invocation: CommandInvocation, name: string): number | undefined {
  const value = invocation.arguments?.[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * A channel list argument, written as indices separated by commas, each a
 * channel of `asset`; `undefined` where it is absent or names no channel.
 */
export function channelsArgument(
  invocation: CommandInvocation,
  name: string,
  channelCount: number,
): readonly number[] | undefined {
  const text = textArgument(invocation, name);
  if (text === undefined) return undefined;
  const channels = text
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((channel) => Number.isInteger(channel) && channel >= 0 && channel < channelCount);
  return channels.length === 0 ? undefined : channels;
}

/**
 * Where `asset`'s playhead is: the transport's position while the transport
 * holds the asset, and where it is parked otherwise.
 */
export function playheadOf(context: ShellContext, asset: EditorAsset): SampleCount {
  if (context.playback.programme() === asset.id) {
    const heard = context.playback.playheadPosition();
    const read = heard === undefined ? undefined : sampleCount(Math.min(heard, asset.length));
    if (read?.ok === true) return read.value;
  }
  return context.cues.of(asset.id);
}

/**
 * Parks the playhead of the asset the transport holds where the transport is,
 * so it is kept when the transport lets the asset go.
 */
export function parkHeld(context: ShellContext): void {
  const key = context.playback.programme();
  const asset = key === undefined ? undefined : context.assets.find(key);
  if (asset === undefined) return;
  const heard = context.playback.playheadPosition();
  const at = heard === undefined ? undefined : sampleCount(Math.min(heard, asset.length));
  if (at?.ok === true) context.cues.park(asset.id, at.value);
}
