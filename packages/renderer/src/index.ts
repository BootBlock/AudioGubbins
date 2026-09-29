/**
 * The public contract of the AudioGubbins renderer.
 *
 * The render frame as a value, the backend contract, the three browser backends
 * in the order they are tried, and the renderer that chooses among them,
 * reports its choice and recovers from a lost device by drawing the latest
 * frame again (ADR-0044, REQ-AUDIO-152). It holds no editor state: every frame
 * is composed from state by the view that draws it.
 */

export {
  type Colour,
  type ImageBatch,
  type PlacedImage,
  type Rectangle,
  type RectangleBatch,
  type RenderBatch,
  type RenderFrame,
  type RenderLayer,
  type SegmentBatch,
  type TextBatch,
  type TextLabel,
} from './render-frame.js';

export {
  type BackendEvents,
  type BackendFactory,
  type RendererBackend,
  RendererKind,
} from './renderer-backend.js';

export { type Painter } from './canvas-painting.js';

export { browserBackends } from './backends.js';

export {
  type OverlayEvents,
  type RenderSurface,
  Renderer,
  type RendererAttempt,
  type RendererReport,
  RendererState,
} from './renderer.js';
