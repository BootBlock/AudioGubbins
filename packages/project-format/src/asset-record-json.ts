/**
 * Writing and reading one asset with its source as JSON, for a value that
 * carries an asset outside a project document, such as the command that adds
 * one (REQ-STOR-026, REQ-EDIT-073, REQ-EXEC-136.12).
 *
 * The record is an object of two members, each in the document's own shape:
 * `asset`, as the project's list of assets holds it, and `source`, as the list
 * of sources holds its entry. It is read by the document's own readers and
 * checked by the document's own rule that the source belongs to the asset and
 * gives its storage key, so a record read here is exactly one the document
 * would hold.
 */

import type { Asset } from '@audiogubbins/domain';

import type { JsonObject } from './canonical-json.js';
import { objectOf, pathOf, required, type Converter } from './document-reading.js';
import type { AssetSource } from './project-state.js';
import { writeAsset, writeSourceEntry } from './project-writing.js';
import { checkAgainstAsset, readSourceEntry } from './source-reading.js';
import { WRITTEN_ASSET_DEPTH, asAsset } from './timeline-reading.js';

/** One asset and its source. */
export interface AssetRecord {
  readonly asset: Asset;
  readonly source: AssetSource;
}

const RECORD_MEMBERS: ReadonlySet<string> = new Set(['asset', 'source']);

/**
 * How many levels of arrays and objects a written record takes: its own
 * object, then its asset, which nests deeper than its source.
 */
export const WRITTEN_ASSET_RECORD_DEPTH = 1 + WRITTEN_ASSET_DEPTH;

/** Writes an asset with its source. */
export function writeAssetRecord(record: AssetRecord): JsonObject {
  return {
    asset: writeAsset(record.asset),
    source: writeSourceEntry(record.asset.id, record.source),
  };
}

/** Reads an asset with its source. */
export const readAssetRecord: Converter<AssetRecord> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, RECORD_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);

  const asset = required(reading, object, at, 'asset', asAsset);
  const entry = required(reading, object, at, 'source', readSourceEntry);
  if (asset === undefined || entry === undefined) return undefined;

  const [assetId, source] = entry;
  const assets = new Map([[asset.id, asset]]);
  return checkAgainstAsset(reading, assetId, source, assets, pathOf(at, 'source'))
    ? { asset, source }
    : undefined;
};
