/**
 * Why an editor view's spectrogram is not drawn, above the display, whose
 * spectrogram lanes then show the reason only as text drawn in pixels.
 */

import type { ReactNode } from 'react';

import { Banner, BannerTone } from '@audiogubbins/design-system';
import type { SpectrogramStatus } from '@audiogubbins/spectral-analysis';

/**
 * The spectrogram's failure, raised as an alert, as the waveform's is
 * (`peaks-note.tsx`): nothing else a screen reader reads says why the lanes
 * are empty. A spectrogram being made says nothing, its tiles drawn pending
 * until they come.
 */
export function SpectrogramNote({
  status,
}: {
  readonly status: SpectrogramStatus | undefined;
}): ReactNode {
  return status?.kind === 'failed' ? (
    <div role="alert">
      <Banner tone={BannerTone.Error} icon="error" title="The spectrogram could not be made">
        {status.reason}
      </Banner>
    </div>
  ) : null;
}
