/**
 * The geometry of the Game preview's pad (ADR-0104): how it maps the
 * scenario's positions onto its drawing, centred on the listener and scaled to
 * show every point, and back; and how a key or a pointer moves the listener or
 * a still emitter on it. Nothing here draws.
 */

import { useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';

import type { GamePreviewScenario, Position } from '@audiogubbins/game-audio';

/** The pad's drawing size, in its own units. */
export const SIZE = 240;

/** How far a key moves a point: a tenth of a unit, or a unit with Shift. */
const STEP = 0.1;
const BIG_STEP = 1;

/** The least extent the pad shows either side of the listener, and the margin round its points. */
const LEAST_EXTENT = 4;
const MARGIN = 1.25;

const KEY_STEPS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/** What is moved: the listener, or the emitter at a place. */
export type Moved =
  { readonly kind: 'listener' } | { readonly kind: 'emitter'; readonly index: number };

/** Where the pad draws a point. */
export interface PadPoint {
  readonly x: number;
  readonly y: number;
}

/** The axis the pad shows down the page: z in 3D, y in 2D. */
function downAxis(space: GamePreviewScenario['space']): 'y' | 'z' {
  return space === '3d' ? 'z' : 'y';
}

/** A tenth to its nearest, so steps of a tenth add up exactly as typed. */
function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Where `emitter` is drawn: where it stands, or where its path starts. */
export function shownAt(emitter: GamePreviewScenario['emitters'][number]): Position | undefined {
  return emitter.motion.kind === 'still' ? emitter.motion.at : emitter.motion.points[0]?.at;
}

/** How the pad maps the scenario's positions onto its drawing, and back. */
export function padGeometry(scenario: GamePreviewScenario) {
  const { listener, space } = scenario;
  const down = downAxis(space);
  const points = [
    listener.at,
    ...scenario.emitters.flatMap((emitter) =>
      emitter.motion.kind === 'still'
        ? [emitter.motion.at]
        : emitter.motion.points.map((one) => one.at),
    ),
  ];
  const extent =
    MARGIN *
    Math.max(
      LEAST_EXTENT,
      ...points.map((at) =>
        Math.max(Math.abs(at.x - listener.at.x), Math.abs(at[down] - listener.at[down])),
      ),
    );
  const scale = SIZE / 2 / extent;
  return {
    down,
    toPad: (at: Position): PadPoint => ({
      x: SIZE / 2 + (at.x - listener.at.x) * scale,
      y: SIZE / 2 + (at[down] - listener.at[down]) * scale,
    }),
    fromPad: (at: Position, padX: number, padY: number): Position => ({
      ...at,
      x: round(listener.at.x + (padX - SIZE / 2) / scale),
      [down]: round(listener.at[down] + (padY - SIZE / 2) / scale),
    }),
  };
}

/** `scenario` with `which` moved to `at`. */
function placed(scenario: GamePreviewScenario, which: Moved, at: Position): GamePreviewScenario {
  if (which.kind === 'listener') return { ...scenario, listener: { ...scenario.listener, at } };
  return {
    ...scenario,
    emitters: scenario.emitters.map((emitter, index) =>
      index === which.index && emitter.motion.kind === 'still'
        ? { ...emitter, motion: { kind: 'still', at } }
        : emitter,
    ),
  };
}

/** Where `which` stands, where it can be moved. */
function positionOf(scenario: GamePreviewScenario, which: Moved): Position | undefined {
  if (which.kind === 'listener') return scenario.listener.at;
  const motion = scenario.emitters[which.index]?.motion;
  return motion?.kind === 'still' ? motion.at : undefined;
}

/** The handlers that move a point by key and by pointer. */
export function useMoves(
  scenario: GamePreviewScenario,
  onScenario: (scenario: GamePreviewScenario) => void,
  svg: RefObject<SVGSVGElement | null>,
) {
  const [dragging, setDragging] = useState<Moved | undefined>(undefined);
  const geometry = padGeometry(scenario);
  return {
    onKey: (which: Moved) => (event: KeyboardEvent<SVGElement>) => {
      const steps = KEY_STEPS[event.key];
      const at = positionOf(scenario, which);
      if (steps === undefined || at === undefined) return;
      event.preventDefault();
      const step = event.shiftKey ? BIG_STEP : STEP;
      const axis = geometry.down;
      onScenario(
        placed(scenario, which, {
          ...at,
          x: round(at.x + steps[0] * step),
          [axis]: round(at[axis] + steps[1] * step),
        }),
      );
    },
    grab: (which: Moved) => (event: PointerEvent<SVGElement>) => {
      event.currentTarget.focus();
      setDragging(which);
    },
    drag: (event: PointerEvent<SVGSVGElement>) => {
      const bounds = svg.current?.getBoundingClientRect();
      const at = dragging === undefined ? undefined : positionOf(scenario, dragging);
      if (
        dragging === undefined ||
        at === undefined ||
        bounds === undefined ||
        bounds.width === 0
      ) {
        return;
      }
      const padX = ((event.clientX - bounds.left) / bounds.width) * SIZE;
      const padY = ((event.clientY - bounds.top) / bounds.height) * SIZE;
      onScenario(placed(scenario, dragging, geometry.fromPad(at, padX, padY)));
    },
    release: () => {
      setDragging(undefined);
    },
  };
}

export type Moves = ReturnType<typeof useMoves>;
