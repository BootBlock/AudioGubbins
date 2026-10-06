/**
 * The threads playback starts beside the page's: the feeder worker, the
 * channel it feeds the processor on, and its connection to the preview
 * worker. The page makes them, so a test plays each itself.
 */

import type { PreviewConnection } from '../preview/preview-host.js';
import type { FeederWorkerPort } from './feeder-link.js';
import type { ChannelEnds } from './channel-ends.js';

/** The threads playback starts beside the page's, which a test plays itself. */
export interface PlaybackThreads {
  /** Starts the feeder worker, the module `threads/feeder-worker.ts`. */
  readonly createFeeder: () => FeederWorkerPort;
  /** Makes a channel between the feeder and the processor: a `MessageChannel`. */
  readonly createChannel: () => ChannelEnds;
  /**
   * Connects the feeder to the preview worker, whose renders it reads the
   * chains it cannot run as they play from (ADR-0061); without one, the
   * feeder runs every chain itself.
   */
  readonly connectPreviews?: () => PreviewConnection;
}
