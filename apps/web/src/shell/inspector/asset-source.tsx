/**
 * An asset's source in the Inspector (REQ-EDIT-072, REQ-STOR-166): the facts
 * of how its file was kept and what it was, and under them the metadata the
 * file carried, where its provenance kept any, each a term and its detail, in
 * a section that starts closed.
 */

import type { ReactNode } from 'react';

import type { Asset } from '@audiogubbins/domain';
import type { AssetSource } from '@audiogubbins/project-format';

import { Facts } from './facts.js';
import { InspectorSubpart } from './inspector-part.js';
import { metadataFacts } from './metadata-words.js';
import { sourceFacts } from './source-words.js';

/** The facts of `asset`'s source, and its file's metadata where it was kept. */
export function AssetSourceFacts({
  source,
  asset,
}: {
  readonly source: AssetSource | undefined;
  readonly asset: Asset;
}): ReactNode {
  const metadata = source?.provenance?.metadata;
  const metadataShown = metadata === undefined ? undefined : metadataFacts(metadata);
  return (
    <>
      <Facts facts={sourceFacts(source, asset)} />
      {metadataShown === undefined ? null : (
        // What a file carried beyond its audio is seldom wanted, so it waits closed.
        <InspectorSubpart
          heading="Its file’s metadata"
          title="File metadata"
          summary={String(metadataShown.length)}
          defaultOpen={false}
        >
          {metadataShown.length === 0 ? (
            <p className="ag-inspector-detail">The file carried none.</p>
          ) : (
            <Facts facts={metadataShown} />
          )}
        </InspectorSubpart>
      )}
    </>
  );
}
