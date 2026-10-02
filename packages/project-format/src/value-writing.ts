/**
 * Writing the domain values a document's parts share, as `value-reading.ts`
 * reads them: one writer per shape, so a layout an asset states and a layout
 * a plan's stream states are written the same way (REQ-STOR-026).
 */

import type { ChannelLayout } from '@audiogubbins/domain';

import type { JsonObject } from './canonical-json.js';

/** Writes a layout whole: its roles, and its labels or its ambisonic convention where it has them. */
export function writeLayout(layout: ChannelLayout): JsonObject {
  const { labels, ambisonic } = layout;
  return {
    roles: [...layout.roles],
    ...(labels === undefined ? {} : { labels: [...labels] }),
    ...(ambisonic === undefined
      ? {}
      : {
          ambisonic: {
            order: ambisonic.order,
            ordering: ambisonic.ordering,
            normalisation: ambisonic.normalisation,
          },
        }),
  };
}
