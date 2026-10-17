/**
 * The listener-and-emitter pad (ADR-0104, the plan's section 11): the scenario
 * seen from above, the listener at its place, each emitter where it stands and
 * each moving one's path.
 *
 * The listener and each still emitter are focusable: the arrow keys move one by
 * a tenth of a unit, by a whole unit with Shift, and a pointer drags it; a
 * moving emitter's path is set by its waypoints' fields. Nothing on the pad
 * moves of its own accord, so it honours reduced motion as it is. A list beside
 * it says each emitter's distance and direction in words, for a reader who
 * cannot see the pad.
 *
 * It is drawn in the display palette, the light one in the light theme (design
 * language, section 8): a grid, rings of distance round the listener, the way
 * the listener faces, and each emitter in its own colour.
 */

import { useRef, type ReactNode } from 'react';

import type { GamePreviewScenario } from '@audiogubbins/game-audio';

import { emitterColour } from './emitter-colours.js';
import {
  SIZE,
  padGeometry,
  shownAt,
  useMoves,
  type Moved,
  type Moves,
  type PadPoint,
} from './pad-moves.js';
import { whereWords } from './preview-words.js';

/** How many squares the grid divides the pad into along each side. */
const GRID_SQUARES = 8;

/** The rings of distance round the listener, as shares of the pad's half-width. */
const RINGS = [1 / 3, 2 / 3, 1];

/** How far the listener's facing reaches, and how wide it opens either side, in radians. */
const FACING_REACH = 46;
const FACING_SPREAD = 0.5;

/** One point on the pad: a square for an emitter, numbered in its colour, or the listener's circle. */
function Point({
  shown,
  label,
  mark,
  which,
  colour,
  sounding,
  moves,
}: {
  readonly shown: PadPoint;
  readonly label: string;
  readonly mark: string;
  /** What moving it moves; nothing for a moving emitter. */
  readonly which: Moved | undefined;
  /** An emitter's colour; nothing for the listener. */
  readonly colour: string | undefined;
  /** Whether a run is sounding it, drawn with rings round it. */
  readonly sounding: boolean;
  readonly moves: Moves;
}): ReactNode {
  return (
    <g
      className="ag-preview-point"
      aria-label={label}
      {...(colour === undefined ? {} : { 'data-ag-category': colour })}
      {...(which === undefined
        ? {}
        : {
            tabIndex: 0,
            role: 'button',
            onKeyDown: moves.onKey(which),
            onPointerDown: moves.grab(which),
          })}
    >
      {sounding &&
        [14, 22].map((r) => (
          <circle key={r} className="ag-preview-point-wave" cx={shown.x} cy={shown.y} r={r} />
        ))}
      {colour === undefined ? (
        <circle className="ag-preview-point-mark" cx={shown.x} cy={shown.y} r={10} />
      ) : (
        <rect
          className="ag-preview-point-mark"
          x={shown.x - 9}
          y={shown.y - 9}
          width={18}
          height={18}
          rx={4}
        />
      )}
      <text className="ag-preview-point-text" x={shown.x} y={shown.y} textAnchor="middle">
        {mark}
      </text>
    </g>
  );
}

/** The grid, and the rings of distance round the listener, who is always at the centre. */
function PadGround(): ReactNode {
  const centre = SIZE / 2;
  const lines = Array.from(
    { length: GRID_SQUARES - 1 },
    (_, at) => ((at + 1) * SIZE) / GRID_SQUARES,
  );
  return (
    <g aria-hidden="true">
      {lines.map((at) => (
        <g key={at}>
          <line className="ag-preview-grid" x1={at} x2={at} y1={0} y2={SIZE} />
          <line className="ag-preview-grid" x1={0} x2={SIZE} y1={at} y2={at} />
        </g>
      ))}
      {RINGS.map((share) => (
        <circle
          key={share}
          className="ag-preview-ring"
          cx={centre}
          cy={centre}
          r={(share * SIZE) / 2}
        />
      ))}
    </g>
  );
}

/** The way the listener faces: a wedge from it, turned by its facing, ahead being up. */
function Facing({ at, turns }: { readonly at: PadPoint; readonly turns: number }): ReactNode {
  const angle = turns * 2 * Math.PI - Math.PI / 2;
  const edge = (offset: number): string =>
    `${String(at.x + FACING_REACH * Math.cos(angle + offset))} ${String(at.y + FACING_REACH * Math.sin(angle + offset))}`;
  return (
    <path
      className="ag-preview-facing"
      aria-hidden="true"
      d={`M ${String(at.x)} ${String(at.y)} L ${edge(-FACING_SPREAD)} A ${String(FACING_REACH)} ${String(FACING_REACH)} 0 0 1 ${edge(FACING_SPREAD)} Z`}
    />
  );
}

/** Each moving emitter's path, the listener, and each emitter, as the pad draws them. */
function PadPoints({
  scenario,
  sounding,
  moves,
}: {
  readonly scenario: GamePreviewScenario;
  readonly sounding: ReadonlySet<string>;
  readonly moves: Moves;
}): ReactNode {
  const { toPad, down } = padGeometry(scenario);
  const { listener } = scenario;
  return (
    <>
      <Facing at={toPad(listener.at)} turns={listener.facingTurns} />
      {scenario.emitters.map((emitter, index) =>
        emitter.motion.kind === 'waypoints' ? (
          <polyline
            key={`path-${emitter.id}`}
            className="ag-preview-path"
            data-ag-category={emitterColour(index)}
            aria-hidden="true"
            points={emitter.motion.points
              .map((one) => `${String(toPad(one.at).x)},${String(toPad(one.at).y)}`)
              .join(' ')}
          />
        ) : null,
      )}
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
            colour={emitterColour(index)}
            sounding={sounding.has(emitter.id)}
            moves={moves}
          />
        );
      })}
      <Point
        shown={toPad(listener.at)}
        label={`Listener at x ${String(listener.at.x)}, ${down} ${String(listener.at[down])}`}
        mark="L"
        which={{ kind: 'listener' }}
        colour={undefined}
        sounding={false}
        moves={moves}
      />
    </>
  );
}

/** Each emitter's distance and direction from the listener, in words. */
function WhereList({ scenario }: { readonly scenario: GamePreviewScenario }): ReactNode {
  return (
    <ul className="ag-visually-hidden">
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
  sounding,
  onScenario,
}: {
  readonly scenario: GamePreviewScenario;
  /** The emitters a run is sounding now, by their identity. */
  readonly sounding: ReadonlySet<string>;
  readonly onScenario: (scenario: GamePreviewScenario) => void;
}): ReactNode {
  const svg = useRef<SVGSVGElement>(null);
  const moves = useMoves(scenario, onScenario, svg);
  const unit = scenario.space === '3d' ? 'metres' : 'pixels';
  return (
    <div className="ag-preview-pad">
      <svg
        ref={svg}
        className="ag-preview-pad-drawing"
        viewBox={`0 0 ${String(SIZE)} ${String(SIZE)}`}
        role="group"
        aria-label={`The scenario seen from above, in ${unit}; arrow keys move the focused point.`}
        onPointerMove={moves.drag}
        onPointerUp={moves.release}
        onPointerLeave={moves.release}
      >
        <PadGround />
        <PadPoints scenario={scenario} sounding={sounding} moves={moves} />
      </svg>
      <WhereList scenario={scenario} />
    </div>
  );
}
