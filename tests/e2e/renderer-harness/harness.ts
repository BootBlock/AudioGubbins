/**
 * The page of the renderer harness (ADR-0082): the editor's renderer on the
 * editor's own canvases, drawing frames of field batches the renderer suites
 * choose, on whichever backend they name, so a field is drawn by the browser's
 * real WebGPU, WebGL2 and Canvas 2D and read back from the page's pixels. The
 * editor view draws no field yet, and a field's every rule is read here rather
 * than through whatever a view happens to draw.
 *
 * Before any renderer is made, the page wraps its own WebGPU and WebGL2
 * texture calls to count the one-byte textures a field is uploaded as, which
 * is how a suite sees what a backend holds against its budget. The renderer
 * itself is unchanged: it is handed the browser's objects as the editor hands
 * them.
 */

import { browserSchedule } from '../../../apps/web/src/audio/browser-schedule.js';
import { EditorCanvases } from '../../../apps/web/src/editor/editor-canvases.js';
import { canvas2dBackend } from '../../../packages/renderer/src/canvas2d-backend.js';
import {
  Renderer,
  RendererKind,
  RendererState,
  type BackendFactory,
  type FieldBatch,
  type RectangleBatch,
  type RenderFrame,
} from '../../../packages/renderer/src/index.js';
import { webGl2Backend } from '../../../packages/renderer/src/webgl2-context.js';
import { isGpu, webGpuBackend } from '../../../packages/renderer/src/webgpu-device.js';
import {
  CLEAR,
  FIELD,
  FIELD_AT,
  FIELD_COLUMNS,
  OVER,
  OVER_AT,
  SURFACE,
  UNDER,
  rampEntry,
  rowAt,
  type Rgb,
} from './field-pattern.js';
import { HARNESS_GLOBAL, TILE, type FieldTextures, type RendererHarness } from './harness-api.js';

/** A member of a value, or nothing where it is no object. */
function member(value: unknown, name: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, name) : undefined;
}

/** A field texture held: its bytes, and whether its device or context still has it. */
interface Held {
  readonly bytes: number;
  readonly alive: () => boolean;
}

/** Every field texture made, by the texture, until it is released. */
const held = new Map<object, Held>();
let made = 0;
let madeBytes = 0;

function madeTexture(texture: object, bytes: number, alive: () => boolean): void {
  held.set(texture, { bytes, alive });
  made += 1;
  madeBytes += bytes;
}

function fieldTextures(): FieldTextures {
  let count = 0;
  let bytes = 0;
  for (const texture of held.values()) {
    if (!texture.alive()) continue;
    count += 1;
    bytes += texture.bytes;
  }
  return { made, madeBytes, held: count, heldBytes: bytes };
}

/**
 * Counts WebGPU's `r8unorm` textures, which only a field is uploaded as. The
 * WebGPU type definitions are not among the suites', so the browser's classes
 * are read by name.
 */
function watchWebGpu(): void {
  const device: unknown = Reflect.get(globalThis, 'GPUDevice');
  const texture: unknown = Reflect.get(globalThis, 'GPUTexture');
  if (typeof device !== 'function' || typeof texture !== 'function') return;
  const lost = new WeakSet<object>();
  const watched = new WeakSet<object>();
  const create: unknown = Reflect.get(device.prototype, 'createTexture');
  const destroy: unknown = Reflect.get(texture.prototype, 'destroy');
  if (typeof create !== 'function' || typeof destroy !== 'function') return;
  Reflect.set(device.prototype, 'createTexture', function (this: object, descriptor: unknown) {
    const made: unknown = Reflect.apply(create, this, [descriptor]);
    if (member(descriptor, 'format') === 'r8unorm' && typeof made === 'object' && made !== null) {
      if (!watched.has(this)) {
        watched.add(this);
        const gone: unknown = member(this, 'lost');
        if (gone instanceof Promise) {
          void gone.then(() => {
            lost.add(this);
          });
        }
      }
      const size = member(descriptor, 'size');
      const bytes = Number(member(size, 'width')) * Number(member(size, 'height'));
      madeTexture(made, bytes, () => !lost.has(this));
    }
    return made;
  });
  Reflect.set(texture.prototype, 'destroy', function (this: object) {
    held.delete(this);
    Reflect.apply(destroy, this, []);
  });
}

/**
 * Counts WebGL2's `R8` textures, which only a field is given storage as. A
 * texture deleted, or of a context lost, is no texture to `isTexture`.
 */
function watchWebGl2(): void {
  const prototype = WebGL2RenderingContext.prototype;
  const storage: unknown = Reflect.get(prototype, 'texStorage2D');
  if (typeof storage !== 'function') return;
  Reflect.set(
    prototype,
    'texStorage2D',
    function (
      this: WebGL2RenderingContext,
      target: number,
      levels: number,
      format: number,
      width: number,
      height: number,
    ) {
      Reflect.apply(storage, this, [target, levels, format, width, height]);
      const bound: unknown = this.getParameter(this.TEXTURE_BINDING_2D);
      if (format === this.R8 && bound instanceof WebGLTexture) {
        madeTexture(bound, width * height, () => this.isTexture(bound));
      }
    },
  );
}

watchWebGpu();
watchWebGl2();

/** A colour of 0 to 255 as a frame gives one, from 0 to 1. */
function colour([red, green, blue]: Rgb): readonly [number, number, number, number] {
  return [red / 255, green / 255, blue / 255, 1];
}

function rectangles(at: typeof FIELD_AT | typeof OVER_AT, of: Rgb): RectangleBatch {
  return {
    kind: 'rectangles',
    colour: colour(of),
    values: new Float32Array([at.x, at.y, at.width, at.height]),
    count: 1,
  };
}

/** The ramp of `field-pattern.ts`, as a frame carries it. */
const PATTERN_RAMP = {
  key: 'pattern-ramp',
  colours: Uint8Array.from({ length: 1024 }, (_, at) => rampEntry(Math.floor(at / 4))[at % 4] ?? 0),
};

/** The field row each device row of `height` CSS pixels reads, at the page's ratio. */
function rowMap(height: number, read: (y: number) => number): Float32Array {
  const ratio = devicePixelRatio;
  return Float32Array.from({ length: Math.round(height * ratio) }, (_, row) =>
    read((row + 0.5) / ratio),
  );
}

function patternFrame(): RenderFrame {
  const field: FieldBatch = {
    kind: 'field',
    field: {
      key: 'pattern',
      width: FIELD.width,
      height: FIELD.height,
      values: Uint8Array.from(FIELD.values),
    },
    ramp: PATTERN_RAMP,
    at: FIELD_AT,
    columns: FIELD_COLUMNS,
    rows: rowMap(FIELD_AT.height, rowAt),
  };
  return {
    width: SURFACE.width,
    height: SURFACE.height,
    pixelRatio: devicePixelRatio,
    clear: colour(CLEAR),
    layers: [{ batches: [rectangles(FIELD_AT, UNDER), field, rectangles(OVER_AT, OVER)] }],
  };
}

/** Tile `index` of the long field: its own key, and bytes that differ from tile to tile. */
function tileField(index: number): FieldBatch['field'] {
  return {
    key: `tile-${String(index)}`,
    width: TILE.width,
    height: TILE.height,
    values: Uint8Array.from(
      { length: TILE.width * TILE.height },
      (_, at) => (index * 7 + (at % TILE.width)) % 256,
    ),
  };
}

function tilesFrame(first: number, count: number): RenderFrame {
  const width = SURFACE.width / count;
  const rows = rowMap(SURFACE.height, (y) => (y / SURFACE.height) * TILE.height);
  const fields = Array.from({ length: count }, (_, index): FieldBatch => ({
    kind: 'field',
    field: tileField(first + index),
    ramp: PATTERN_RAMP,
    at: { x: index * width, y: 0, width, height: SURFACE.height },
    columns: { from: 0, to: TILE.width },
    rows,
  }));
  return {
    width: SURFACE.width,
    height: SURFACE.height,
    pixelRatio: devicePixelRatio,
    clear: colour(CLEAR),
    layers: [{ batches: fields }],
  };
}

const host = document.querySelector<HTMLElement>('#surface');
if (host === null) throw new Error('The harness page has no surface.');
const surfaceHost = host;

/** The renderer on the surface, its canvases, and the canvases it composed fields on. */
let current:
  | {
      readonly renderer: Renderer;
      readonly canvases: EditorCanvases;
      readonly composing: { count: number };
    }
  | undefined;

/**
 * The backends a browser offers, from `kind` on, in the renderer's order, as
 * `browserBackends` lists them, with the field budget given where there is one.
 */
function backendsFrom(
  kind: RendererKind,
  budget: number | undefined,
  offscreen: () => HTMLCanvasElement,
): readonly BackendFactory[] {
  const gpu: unknown = Reflect.get(navigator, 'gpu');
  const all = [
    ...(isGpu(gpu) ? [webGpuBackend(gpu, budget)] : []),
    webGl2Backend(browserSchedule, budget),
    canvas2dBackend(offscreen),
  ];
  const from = all.findIndex((factory) => factory.kind === kind);
  if (from < 0) throw new Error(`This browser offers no ${kind} backend to start from.`);
  return all.slice(from);
}

function opened(): Renderer {
  if (current === undefined) throw new Error('No renderer is open on the harness.');
  return current.renderer;
}

const harness: RendererHarness = {
  async offered() {
    const kinds: RendererKind[] = [];
    const gpu: unknown = Reflect.get(navigator, 'gpu');
    for (const kind of Object.values(RendererKind)) {
      if (kind === RendererKind.WebGpu && !isGpu(gpu)) continue;
      const factory = backendsFrom(kind, undefined, () => document.createElement('canvas'))[0];
      if (factory === undefined) continue;
      const trial = document.createElement('div');
      trial.className = 'trial';
      document.body.append(trial);
      const canvases = new EditorCanvases(trial);
      const renderer = new Renderer({ surface: canvases, backends: [factory] });
      await renderer.start();
      if (renderer.report.active === kind) kinds.push(kind);
      renderer.dispose();
      canvases.dispose();
      trial.remove();
    }
    return kinds;
  },

  async open(kind, budget) {
    current?.renderer.dispose();
    current?.canvases.dispose();
    const canvases = new EditorCanvases(surfaceHost);
    const composing = { count: 0 };
    const renderer = new Renderer({
      surface: canvases,
      backends: backendsFrom(kind, budget, () => {
        composing.count += 1;
        return canvases.offscreen();
      }),
    });
    current = { renderer, canvases, composing };
    await renderer.start();
    return renderer.report;
  },

  report: () => opened().report,

  drawPattern() {
    opened().draw(patternFrame());
  },

  drawTiles(first, count) {
    const renderer = opened();
    if (renderer.report.state !== RendererState.Drawing) {
      throw new Error(`The renderer is ${renderer.report.state}, and draws no tiles.`);
    }
    renderer.draw(tilesFrame(first, count));
    return fieldTextures();
  },

  fieldTextures,

  composingCanvases: () => current?.composing.count ?? 0,
};

Reflect.set(window, HARNESS_GLOBAL, harness);
