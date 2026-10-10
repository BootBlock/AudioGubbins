/**
 * What the Export dialog is opened over (ADR-0092, REQ-EDIT-014): the asset
 * of the open project the editor shows, the range asked for, and the
 * selection it may offer beside it, planned against the asset as the project
 * now holds it. A dialog showing its target already is left as the person
 * set it.
 */

import { unchanged } from '@audiogubbins/commands';
import { derivedSampleCount, type AssetId } from '@audiogubbins/domain';
import type { ExportClock, ExportRange } from '@audiogubbins/import-export';
import { canonicalJson, writeExportSettings } from '@audiogubbins/project-format';
import type { RemoteProjectSession } from '@audiogubbins/storage-runtime';
import { SelectionFacet, type MadeFacet, type TargetRequest } from '@audiogubbins/timeline';

import { assetEntryId } from '../assets/project-entry.js';
import type { ExportServices } from '../export/export-types.js';
import type { ProjectStores } from '../state/project-stores.js';
import { reasonsOf } from '../state/reasons.js';
import { focusedEditor, selectedTarget } from './editor-target.js';
import { readyProjects, sessionOf } from './project-access.js';
import { onAsset } from './project-edits.js';
import type { BodyAnswer } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** Why nothing can be exported where the page offers no export. */
const NO_EXPORT = 'This browser offers no export here, since it cannot keep projects.';

/** A time range alone: an export of the selection needs one, and never falls back to the whole. */
const SELECTED_RANGE: TargetRequest = {
  accepts: new Set<MadeFacet>([SelectionFacet.Time]),
  whenNothing: 'refuse',
};

/** The moment `now`, with the offset from UTC this page's clock is set to then, for `{date}`. */
function exportClockAt(now: number): ExportClock {
  return {
    epochMilliseconds: now,
    utcOffsetMinutes: -new Date(now).getTimezoneOffset(),
  };
}

/** What an export from the open project is made with: its stores, the page's export and its session. */
export interface ExportParts {
  readonly stores: ProjectStores;
  readonly exports: ExportServices;
  readonly session: RemoteProjectSession;
}

/** What an export is made with, or why nothing can be exported now. */
export function exportParts(context: ShellContext): ExportParts | string {
  const stores = readyProjects(context);
  if (typeof stores === 'string') return stores;
  if (context.exports === undefined) return NO_EXPORT;
  const session = sessionOf(context);
  if (typeof session === 'string') return session;
  return { stores, exports: context.exports, session };
}

/** The asset of the open project the editor last in use shows, a region's asset for a region. */
export function editorProjectAsset(context: ShellContext): { readonly asset: AssetId } | string {
  const target = focusedEditor(context);
  if (typeof target === 'string') return target;
  const { owner } = target.asset;
  return owner.kind === 'project' ? { asset: owner.asset.id } : owner.reason;
}

/** What the dialog is opened over: the asset, the range, and the selection it may offer. */
export interface DialogTarget {
  readonly asset: AssetId;
  readonly range: ExportRange;
  readonly selection: Extract<ExportRange, { readonly kind: 'selection' }> | undefined;
}

/**
 * The selection of the editor last in use as a range of its asset, or why
 * there is none: a view of a region shows the region's slice, so its range
 * is moved on by the region's start.
 */
export function editorSelection(
  context: ShellContext,
): Extract<ExportRange, { readonly kind: 'selection' }> | string {
  const target = focusedEditor(context);
  if (typeof target === 'string') return target;
  const { owner } = target.asset;
  if (owner.kind === 'session') return owner.reason;
  const selected = selectedTarget(context, target.asset, SELECTED_RANGE);
  if (typeof selected === 'string') return selected;
  if (selected.kind !== 'time') return 'Select a range of time to export.';
  const { start, end } = selected.range;
  return {
    kind: 'selection',
    start: onAsset(owner, start),
    length: derivedSampleCount(end - start),
  };
}

/** The editor's selection, where it has one, as the dialog offers it beside the range it opens with. */
export function offeredSelection(
  context: ShellContext,
): Extract<ExportRange, { readonly kind: 'selection' }> | undefined {
  const selection = editorSelection(context);
  return typeof selection === 'string' ? undefined : selection;
}

/** Whether the dialog shows `target` already, as `session`'s project holds it. */
function showing(
  shown: ReturnType<ProjectStores['exportDialog']['get']>,
  session: RemoteProjectSession,
  target: DialogTarget,
): boolean {
  return (
    shown.kind === 'open' &&
    shown.project === session.project &&
    shown.asset === target.asset &&
    canonicalJson(writeExportSettings({ ...shown.settings, range: target.range })) ===
      canonicalJson(writeExportSettings(shown.settings))
  );
}

/**
 * Opens the Export dialog over `target`, planned against the asset as the
 * project now holds it; or why it cannot open. A dialog showing the target
 * already is left as the person set it.
 */
export function openOver(context: ShellContext, target: DialogTarget): BodyAnswer {
  const parts = exportParts(context);
  if (typeof parts === 'string') return parts;
  const { stores, exports, session } = parts;
  if (showing(stores.exportDialog.get(), session, target)) {
    return unchanged('export.dialog-open-already', 'The Export dialog shows this already.');
  }
  const editorAsset = context.assets.find(assetEntryId(target.asset));
  if (editorAsset === undefined) return 'The asset to export is not open in this session yet.';
  const { state } = session.getSnapshot().model;
  const planned = exports.contextOf(editorAsset, state);
  if (!planned.ok) return reasonsOf(planned.failures);
  stores.exportDialog.open({
    project: session.project,
    asset: target.asset,
    context: planned.value,
    clock: exportClockAt(context.clock.now()),
    range: target.range,
    selection: target.selection,
    kept: state.exportSettings,
    dialogs: exports.destinations.dialogs,
  });
  return undefined;
}
