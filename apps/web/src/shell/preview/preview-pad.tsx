/**
 * The listener-and-emitter pad (ADR-0104, the plan's section 11): the scenario
 * seen from above, the listener at its place, each emitter where it stands and
 * each moving one's path.
 *
 * The listener and each still emitter are focusable: the arrow keys move one by
 * a tenth of a unit, by a whole unit with Shift, and a pointer drags it; a
 * moving emitter's path is set by its waypoints' fields. Nothing on the pad
 * moves of its own accord, so it honours reduced motion as it is. A list beside
 * it says each emitter's distance and direction in words.
 */

import {
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';

import type { GamePreviewScenario, Position } from '@audiogubbins/game-audio';

import { whereWords } from './preview-words.js';

/** The pad's drawing size, in its own units. */
const SIZE = 240;

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
type Moved = { readonly kind: 'listener' } | { readonly kind: 'emitter'; readonly index: number };

/** Where the pad draws a point. */
interface PadPoint {
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
function shownAt(emitter: GamePreviewScenario['emitters'][number]): Position | undefined {
  return emitter.motion.kind === 'still' ? emitter.motion.at : emitter.motion.points[0]?.at;
}

/** How the pad maps the scenario's positions onto its drawing, and back. */
function padGeometry(scenario: GamePreviewScenario) {
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
function useMoves(
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

type Moves = ReturnType<typeof useMoves>;

/** One point on the pad: a square for an emitter, numbered, or the listener's circle. */
function Point({
  shown,
  label,
  mark,
  which,
  moves,
}: {
  readonly shown: PadPoint;
  readonly label: string;
  readonly mark: string;
  /** What moving it moves; nothing for a moving emitter. */
  readonly which: Moved | undefined;
  readonly moves: Moves;
}): ReactNode {
  const outline = { stroke: 'var(--ag-chrome-text-primary)' };
  return (
    <g
      aria-label={label}
      {...(which === undefined
        ? {}
        : {
            tabIndex: 0,
            role: 'button',
            onKeyDown: moves.onKey(which),
            onPointerDown: moves.grab(which),
          })}
    >
      {which?.kind === 'listener' ? (
        <circle
          cx={shown.x}
          cy={shown.y}
          r={8}
          style={{ ...outline, fill: 'var(--ag-chrome-surface-raised)' }}
        />
      ) : (
        <rect
          x={shown.x - 7}
          y={shown.y - 7}
          width={14}
          height={14}
          style={{ ...outline, fill: 'var(--ag-chrome-surface-base)' }}
        />
      )}
      <text
        x={shown.x}
        y={shown.y + 4}
        textAnchor="middle"
        style={{ fill: 'var(--ag-chrome-text-primary)', fontSize: 10 }}
      >
        {mark}
      </text>
    </g>
  );
}

/** Each moving emitter's path, the listener, and each emitter, as the pad draws them. */
function PadPoints({
  scenario,
  moves,
}: {
  readonly scenario: GamePreviewScenario;
  readonly moves: Moves;
}): ReactNode {
  const { toPad, down } = padGeometry(scenario);
  const { listener } = scenario;
  return (
    <>
      {scenario.emitters.map((emitter) =>
        emitter.motion.kind === 'waypoints' ? (
          <polyline
            key={`path-${emitter.id}`}
            aria-hidden="true"
            points={emitter.motion.points
              .map((one) => `${String(toPad(one.at).x)},${String(toPad(one.at).y)}`)
              .join(' ')}
            style={{
              fill: 'none',
              stroke: 'var(--ag-chrome-text-secondary)',
              strokeDasharray: '4 3',
            }}
          />
        ) : null,
      )}
      <Point
        shown={toPad(listener.at)}
        label={`Listener at x ${String(listener.at.x)}, ${down} ${String(listener.at[down])}`}
        mark="L"
        which={{ kind: 'listener' }}
        moves={moves}
      />
      {scenario.emitters.map((emitter, index) => {
        const at = shownAt(emitter);
        if (at === undefined) return null;
        const still = emitter.motion.kind === 'still';
        return (
          <Point
            key={emitter.id}
            shown={toPad(at)}
            label={`${emitter.name} at x ${String(at.x)}, ${down} ${String(at[down])}${still ? '' : ', moving'}`}
            mark={String(index + 1)}
            which={still ? { kind: 'emitter', index } : undefined}
            moves={moves}
          />
        );
      })}
    </>
  );
}

/** Each emitter's distance and direction from the listener, in words. */
function WhereList({ scenario }: { readonly scenario: GamePreviewScenario }): ReactNode {
  return (
    <ul className="ag-preview-where">
      {scenario.emitters.map((emitter) => {
        const at = shownAt(emitter);
        const path = emitter.motion.kind === 'still' ? '' : ', where its path starts';
        return at === undefined ? null : (
          <li key={emitter.id}>
            {`${emitter.name}: ${whereWords(at, scenario.listener.at, scenario.space)}${path}.`}
          </li>
        );
      })}
    </ul>
  );
}

/** The pad of `scenario`, which `onScenario` changes as a point is moved. */
export function PreviewPad({
  scenario,
  onScenario,
}: {
  readonly scenario: GamePreviewScenario;
  readonly onScenario: (scenario: GamePreviewScenario) => void;
}): ReactNode {
  const svg = useRef<SVGSVGElement>(null);
  const moves = useMoves(scenario, onScenario, svg);
  const unit = scenario.space === '3d' ? 'metres' : 'pixels';
  return (
    <div className="ag-preview-pad">
      <svg
        ref={svg}
        viewBox={`0 0 ${String(SIZE)} ${String(SIZE)}`}
        width={SIZE}
        height={SIZE}
        role="group"
        aria-label={`The scenario seen from above, in ${unit}; arrow keys move the focused point.`}
        onPointerMove={moves.drag}
        onPointerUp={moves.release}
        onPointerLeave={moves.release}
        style={{ border: '1px solid var(--ag-chrome-border-subtle)', touchAction: 'none' }}
      >
        <PadPoints scenario={scenario} moves={moves} />
      </svg>
      <WhereList scenario={scenario} />
    </div>
  );
}
