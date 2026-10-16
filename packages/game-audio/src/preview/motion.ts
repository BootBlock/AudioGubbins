/**
 * Where an emitter is as the listener hears it (ADR-0104): its position in
 * the listener's frame, which is what the spatial panner is given, and a
 * moving emitter's path as automation of that position.
 *
 * The listener's frame has it at the origin facing −z (3D) or −y (2D), its
 * right +x: a 3D position is moved by the listener's and turned by the
 * inverse of its rotation about +y; a 2D one likewise about the axis out of
 * the screen. Turning is linear, so a path that is straight between waypoints
 * in the world is straight between them in the listener's frame too, and a
 * still listener's motion is exact as automation points at its waypoints,
 * which the panner reads at every 32-frame design interval, linear between.
 *
 * A waypoint at `ms` is at frame `framesOf(ms, rate)`. A looped path repeats
 * every last waypoint's time, a back-and-forth one runs forwards then
 * backwards over twice it, and a path played once holds its last point.
 */

import type { AutomationPoint } from '@audiogubbins/domain';
import { cosineOfTurns, sineOfTurns } from '@audiogubbins/audio-engine';

import { framesOf } from './preview-draws.js';
import type {
  GamePreviewScenario,
  Listener,
  Motion,
  Position,
  Waypoint,
} from './preview-scenario.js';

/** `at` in the frame of `listener`, by the canonical cosine and sine (ADR-0032). */
export function inListenerFrame(
  at: Position,
  listener: Listener,
  space: GamePreviewScenario['space'],
): Position {
  const dx = at.x - listener.at.x;
  const dy = at.y - listener.at.y;
  const dz = at.z - listener.at.z;
  const cosine = cosineOfTurns(listener.facingTurns);
  const sine = sineOfTurns(listener.facingTurns);
  if (space === '2d') return { x: cosine * dx + sine * dy, y: cosine * dy - sine * dx, z: 0 };
  return { x: cosine * dx - sine * dz, y: dy, z: sine * dx + cosine * dz };
}

/** The x, y and z of a moving emitter in the listener's frame, each a lane of points. */
export interface MotionLanes {
  readonly x: readonly AutomationPoint[];
  readonly y: readonly AutomationPoint[];
  readonly z: readonly AutomationPoint[];
}

/** One traversal of a path: its waypoints forwards, or backwards in time from its end. */
function* traversal(points: readonly Waypoint[], backwards: boolean): Generator<Waypoint> {
  const length = points.at(-1)?.milliseconds ?? 0;
  if (!backwards) {
    yield* points;
    return;
  }
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index];
    if (point !== undefined) yield { at: point.at, milliseconds: length - point.milliseconds };
  }
}

/** Every waypoint the path passes, in time, each traversal after the first without its first point, which the last one ended on. */
function* passage(motion: Extract<Motion, { readonly kind: 'waypoints' }>): Generator<Waypoint> {
  const length = motion.points.at(-1)?.milliseconds ?? 0;
  for (let cycle = 0; ; cycle += 1) {
    const backwards = motion.repeat === 'back-and-forth' && cycle % 2 === 1;
    let first = true;
    for (const point of traversal(motion.points, backwards)) {
      if (cycle > 0 && first) {
        first = false;
        continue;
      }
      first = false;
      yield { at: point.at, milliseconds: cycle * length + point.milliseconds };
    }
    if (motion.repeat === 'once') return;
  }
}

/**
 * The path of `motion` as heard by `listener` at `rate`, through the first
 * waypoint at or after frame `through`, so the lanes are whole to `through`;
 * extending them to a later frame only adds points.
 */
export function motionLanes(
  motion: Extract<Motion, { readonly kind: 'waypoints' }>,
  listener: Listener,
  space: GamePreviewScenario['space'],
  rate: number,
  through: number,
): MotionLanes {
  const x: AutomationPoint[] = [];
  const y: AutomationPoint[] = [];
  const z: AutomationPoint[] = [];
  for (const point of passage(motion)) {
    const frame = framesOf(point.milliseconds, rate);
    const heard = inListenerFrame(point.at, listener, space);
    x.push({ frame, value: heard.x });
    y.push({ frame, value: heard.y });
    z.push({ frame, value: heard.z });
    if (frame >= through) break;
  }
  return { x, y, z };
}
