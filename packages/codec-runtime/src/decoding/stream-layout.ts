/**
 * The channel layout a decoded stream is kept in: the one the stream states,
 * as the codec module describes it, by the read contract's own rules
 * (ADR-0090, ADR-0093, REQ-ARCH-157).
 *
 * The module decodes every codec's channels into speaker-mask order, so a
 * stated mask is read as a WAV file's is (`speakerMaskLayout`). An ambisonic
 * stream is in ACN order; the containers that name an order (Opus's mapping
 * families 2 and 3, and the Matroska and MP4 tracks Symphonia reads) state
 * AmbiX, so its normalisation is SN3D. A stream that states nothing takes the
 * layout a WAV or AIFF file that states nothing is read with (`layoutRead`),
 * so no layout is inferred past what any file of that count is given.
 */

import { layoutRead, speakerMaskLayout } from '@audiogubbins/codecs';
import {
  AmbisonicNormalisation,
  AmbisonicOrdering,
  FailureKind,
  ambisonicLayout,
  fail,
  failure,
  type ChannelLayout,
  type DomainResult,
} from '@audiogubbins/domain';

import type { StreamDescription } from '../stream-description.js';

/** The layout `description`'s channels are decoded in, or why the domain cannot hold it. */
export function streamLayout(description: StreamDescription): DomainResult<ChannelLayout> {
  const { layout, channelCount } = description;
  switch (layout.kind) {
    case 'speakers': {
      const stated = speakerMaskLayout(layout.mask, channelCount);
      return layoutRead(stated, channelCount);
    }
    case 'ambisonic': {
      const ambisonic = ambisonicLayout({
        order: layout.order,
        ordering: AmbisonicOrdering.Acn,
        normalisation: AmbisonicNormalisation.Sn3d,
      });
      if (ambisonic.ok && ambisonic.value.roles.length !== channelCount) {
        return fail(
          failure(
            'codec-runtime.layout-mismatch',
            FailureKind.IntegrityViolation,
            `The stream states ambisonics of order ${String(layout.order)} over ${String(channelCount)} channels, which that order does not have.`,
          ),
        );
      }
      return ambisonic;
    }
    case 'unstated':
      return layoutRead(undefined, channelCount);
  }
}
