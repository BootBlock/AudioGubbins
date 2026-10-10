/**
 * The public contract of AudioGubbins spectrograms.
 *
 * A spectrogram is a pyramid of disposable tiles analysed in a worker from the
 * edited sound (ADR-0080): its settings, the pyramid's shape and the exact
 * placement of its columns, the tile and the key that names it, the quantised
 * level a tile's byte stands for, the messages the page sends the worker, and
 * the host that shares one job per sound among every view, asks the cache
 * before the worker, and draws an older revision's tiles as stale until the
 * current one's replace them. The worker's own module is
 * `./threads/spectrogram-worker`, for the application to give the bundler; its
 * behaviour is `SpectrogramWorkerCore`, tested without a worker.
 */

export {
  DEFAULT_SPECTROGRAM_CONFIG,
  type SpectrogramConfig,
  type SpectrogramOverlap,
  spectrogramConfig,
} from './spectrogram-config.js';

export {
  type FrameRange,
  type LevelGeometry,
  type SpectrogramGeometry,
  TILE_COLUMNS,
  type TileSpan,
  levelFor,
  tileSpan,
  tilesOver,
} from './tile-geometry.js';

export { type SpectralTile, type SpectralTileKey, tileKeyText } from './spectral-tile.js';

export { LEVEL_FLOOR_DECIBELS, LEVEL_STEP_DECIBELS, levelDecibels } from './level-quantisation.js';

export { type SpectrogramSubject } from './spectrogram-subject.js';

export { ToSpectrogramWorkerKind, type ToSpectrogramWorker } from './spectrogram-messages.js';

export {
  type SpectralTileCache,
  type SpectrogramEvent,
  type SpectrogramStatus,
  type SpectrogramView,
} from './spectrogram-ports.js';

export {
  type ShownTile,
  type SpectrogramHandle,
  SpectrogramHost,
  type SpectrogramHostEvent,
  type SpectrogramWorkerPort,
} from './spectrogram-host.js';
