/**
 * Keeps each asset's selection valid for its content (REQ-EDIT-064,
 * ADR-0042): whenever the session's content changes, the selection of every
 * asset whose content is held is reconciled with it, so a removed marker
 * leaves the selection and nothing else about it moves.
 *
 * A subscription the composition root makes once, rather than a step each
 * marker command remembers, so a later command that changes content cannot
 * forget it.
 */

import type { AssetCatalogue } from './asset-catalogue.js';
import type { SelectionStore } from './selection-store.js';
import type { SessionContent } from './session-content.js';

/** Reconciles selections with content from now on, and gives back the function that stops. */
export function reconcileSelections(
  content: SessionContent,
  selections: SelectionStore,
  assets: AssetCatalogue,
): () => void {
  return content.subscribe(() => {
    for (const [id, held] of content.get()) {
      const asset = assets.find(id);
      if (asset === undefined) continue;
      selections.reconcile(id, {
        length: asset.length,
        channelCount: asset.layout.roles.length,
        markers: new Set(held.markers.map((marker) => marker.id)),
        regions: new Set(held.regions.map((region) => region.id)),
      });
    }
  });
}
