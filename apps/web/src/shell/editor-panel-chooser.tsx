/**
 * What an Editor panel showing no asset offers: the assets it can open, as
 * the panel's empty state, and why any of them cannot be listed.
 */

import { useSyncExternalStore, type ReactNode } from 'react';

import { Banner, BannerTone, Button, EmptyState, Icon } from '@audiogubbins/design-system';

import type { EditorPanelParts } from '../editor/panel-parts.js';

/**
 * The assets a view can open, as the panel's empty state: a button for each,
 * named by the asset and saying what it holds on hover or focus.
 */
export function AssetChooser({
  panel,
  parts,
}: {
  readonly panel: string;
  readonly parts: EditorPanelParts;
}): ReactNode {
  const { assets, problems } = useSyncExternalStore(parts.assets.subscribe, parts.assets.get);
  return (
    <div className="ag-editor-chooser">
      <EmptyState
        icon="waveform"
        title="Choose an asset to open"
        actions={
          <ul className="ag-editor-assets" aria-label="Assets to open">
            {assets.map((asset) => (
              <li key={asset.id} className="ag-editor-asset">
                <Button
                  hint={asset.description}
                  onClick={() => {
                    parts.run('editor.open-asset', { view: panel, asset: asset.id });
                  }}
                >
                  <Icon name="waveform" />
                  {asset.name}
                </Button>
              </li>
            ))}
          </ul>
        }
      />
      {problems.map((problem) => (
        <Banner key={problem} tone={BannerTone.Error} icon="unavailable">
          {problem}
        </Banner>
      ))}
    </div>
  );
}
