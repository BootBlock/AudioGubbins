/**
 * The public contract of AudioGubbins waveform peaks.
 *
 * The multi-resolution peak pyramid (ADR-0043): its shape, its progressive
 * filling on the page, the per-column reading a view draws from, the samples a
 * view reads where it is zoomed past the pyramid, the zero-crossing search for
 * snapping, the disposable cache format, and the host that shares one pyramid
 * per source among every view and talks to the one peak worker. The worker's
 * own module is `./threads/peak-worker`, for the application to give the
 * bundler; its behaviour is `PeakWorkerCore`, tested without a worker.
 */

export {
  BASE_BUCKET_FRAMES,
  type LevelGeometry,
  type PeakGeometry,
  peakGeometry,
} from './peak-geometry.js';

export {
  type PeakChannel,
  type PeakLevel,
  type PeakRun,
  WaveformPeakPyramid,
} from './peak-pyramid.js';

export {
  type ColumnPeaks,
  type ColumnSpan,
  type SampleWindow,
  columnPeaks,
  readPyramidColumns,
  readSampleColumns,
  readsPyramid,
  windowCovers,
  windowFrames,
} from './peak-columns.js';

export { type ZeroCrossingSearch } from './zero-crossings.js';

export { type PeakEvent, type PeakStatus } from './peak-job.js';

export { type PeakSubject } from './peak-subject.js';

export { type FrameRange } from './peak-messages.js';

export {
  type PeakCacheStore,
  type PeakHandle,
  PeakHost,
  type PeakWorkerPort,
} from './peak-host.js';
