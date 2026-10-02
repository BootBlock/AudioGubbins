/**
 * Keeps each asset's selection valid for its content (REQ-EDIT-064, ADR-0042):
 * whenever the catalogue changes, as the project's markers, regions and edits
 * do, the selection of every asset open is reconciled with what it now holds,
 * so a removed marker leaves the selection, a range past a shortened end is cut
 * to it, and nothing else about the selection moves.
 *
 * A subscription the composition root makes once, rather than a step each
 * command remembers, so a later command that changes content cannot forget it.
 */

import type { AssetCatalogue } from './asset-catalogue.js';
import type { SelectionStore } from './selection-store.js';

/** Reconciles selections with content from now on, and gives back the function that stops. */
export function reconcileSelections(
  selections: SelectionStore,
  assets: AssetCatalogue,
): () => void {
  return assets.subscribe(() => {
    for (const asset of assets.get().assets) {
      selections.reconcile(asset.id, {
        length: asset.length,
        channelCount: asset.layout.roles.length,
        markers: new Set(asset.markers.map((marker) => marker.id)),
        regions: new Set(asset.regions.map((region) => region.id)),
      });
    }
  });
}
