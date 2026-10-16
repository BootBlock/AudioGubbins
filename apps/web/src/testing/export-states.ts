/**
 * The page's export as a test of the surfaces that show it sets it: a batch
 * and its files, with what every shown state carries beside them, the
 * settings, each file's destination and the names delivered, made what a test
 * does not read unless it says otherwise.
 */

import type { ExportBatch, ExportSettings, PlannedFile } from '@audiogubbins/import-export';

import type { ExportDestinationChoice, ExportRunState } from '../export/export-types.js';
import { rateOf } from './export-contexts.js';

/** 24-bit WAV at 48 kHz of the whole asset, named after the project. */
export const SHOWN_SETTINGS: ExportSettings = {
  format: 'wav',
  encoding: { kind: 'integer', bits: 24 },
  sampleRate: rateOf(48_000),
  channels: { kind: 'keep' },
  dither: { kind: 'none' },
  range: { kind: 'project' },
  metadata: { policy: 'full', edits: [] },
  fileName: '{project}',
};

/** What every shown state of the export carries. */
export type ShownRun = Pick<
  ExportRunState & { readonly kind: 'held' },
  'batch' | 'files' | 'settings' | 'destinations' | 'names'
>;

/** `batch` and its `files` as a shown state carries them, with `more` where a test reads it. */
export function shownRun(
  batch: ExportBatch,
  files: ReadonlyMap<string, PlannedFile> = new Map(),
  more: {
    readonly settings?: ExportSettings;
    readonly destinations?: ReadonlyMap<string, ExportDestinationChoice>;
    readonly names?: ReadonlyMap<string, string>;
  } = {},
): ShownRun {
  return {
    batch,
    files,
    settings: new Map([...files.keys()].map((id) => [id, more.settings ?? SHOWN_SETTINGS])),
    destinations: more.destinations ?? new Map(),
    names: more.names ?? new Map(),
  };
}
