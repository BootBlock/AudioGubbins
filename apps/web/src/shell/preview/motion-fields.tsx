/**
 * How an emitter is triggered and how it moves, as the person sets them: by
 * hand or repeatedly, every so often with a jitter for a count; still at a
 * position, or along waypoints played once, looped or back and forth.
 */

import type { ReactNode } from 'react';

import { Button } from '@audiogubbins/design-system';
import type { Motion, TriggerPattern, Waypoint } from '@audiogubbins/game-audio';

import { ChoiceField, NumberField, type Choice } from '../export/setting-fields.js';
import { PositionFields } from './position-fields.js';

const TRIGGERS: readonly Choice<TriggerPattern['kind']>[] = [
  { value: 'by-hand', label: 'By hand' },
  { value: 'repeat', label: 'Repeatedly' },
];

const MOTIONS: readonly Choice<Motion['kind']>[] = [
  { value: 'still', label: 'Still' },
  { value: 'waypoints', label: 'Along waypoints' },
];

type Repeat = Extract<Motion, { readonly kind: 'waypoints' }>['repeat'];

const REPEATS: readonly Choice<Repeat>[] = [
  { value: 'once', label: 'Once, then held' },
  { value: 'loop', label: 'Looped' },
  { value: 'back-and-forth', label: 'Back and forth' },
];

/** A repeat a person starts from: four times a second, sixteen times. */
const FIRST_REPEAT: TriggerPattern = {
  kind: 'repeat',
  intervalMilliseconds: 250,
  jitterMilliseconds: 0,
  count: 16,
};

/** How far along x, and how long, a new path's second waypoint is from its first. */
const FIRST_STEP = { across: 4, milliseconds: 2_000 };

/** How long after the last waypoint a new one is added. */
const WAYPOINT_STEP_MILLISECONDS = 1_000;

/** `motion` changed to the `kind` chosen, starting where it stood. */
function motionOf(motion: Motion, kind: Motion['kind']): Motion {
  const at = motion.kind === 'still' ? motion.at : (motion.points[0]?.at ?? { x: 0, y: 0, z: 0 });
  if (kind === 'still') return { kind, at };
  return {
    kind,
    points: [
      { at, milliseconds: 0 },
      { at: { ...at, x: at.x + FIRST_STEP.across }, milliseconds: FIRST_STEP.milliseconds },
    ],
    repeat: 'back-and-forth',
  };
}

export function TriggerFields({
  trigger,
  onTrigger,
}: {
  readonly trigger: TriggerPattern;
  readonly onTrigger: (trigger: TriggerPattern) => void;
}): ReactNode {
  return (
    <>
      <ChoiceField
        label="Triggered"
        value={trigger.kind}
        choices={TRIGGERS}
        onChoose={(kind) => {
          onTrigger(kind === 'by-hand' ? { kind } : FIRST_REPEAT);
        }}
      />
      {trigger.kind === 'repeat' ? (
        <>
          <NumberField
            label="Every"
            unit="milliseconds, 20 to 60,000"
            value={trigger.intervalMilliseconds}
            onNumber={(intervalMilliseconds) => {
              onTrigger({ ...trigger, intervalMilliseconds });
            }}
          />
          <NumberField
            label="Jitter"
            unit="milliseconds either way, at most half the interval"
            value={trigger.jitterMilliseconds}
            onNumber={(jitterMilliseconds) => {
              onTrigger({ ...trigger, jitterMilliseconds });
            }}
          />
          <NumberField
            label="Times"
            value={trigger.count}
            onNumber={(count) => {
              onTrigger({ ...trigger, count });
            }}
          />
        </>
      ) : null}
    </>
  );
}

/** One waypoint's position and time, and its removal where the path keeps two. */
function WaypointFields({
  point,
  index,
  space,
  onPoint,
  onRemove,
}: {
  readonly point: Waypoint;
  readonly index: number;
  readonly space: '2d' | '3d';
  readonly onPoint: (point: Waypoint) => void;
  readonly onRemove: (() => void) | undefined;
}): ReactNode {
  const name = `Waypoint ${String(index + 1)}`;
  return (
    <li>
      <PositionFields
        label={name}
        at={point.at}
        space={space}
        onPosition={(at) => {
          onPoint({ ...point, at });
        }}
      />
      <NumberField
        label={`${name} at`}
        unit="milliseconds from the start"
        value={point.milliseconds}
        onNumber={(milliseconds) => {
          onPoint({ ...point, milliseconds });
        }}
      />
      {onRemove === undefined ? null : (
        <Button compact tone="quiet" onClick={onRemove}>
          {`Remove ${name.toLowerCase()}`}
        </Button>
      )}
    </li>
  );
}

/** Each waypoint of a path, in order. */
function WaypointList({
  motion,
  space,
  onMotion,
}: {
  readonly motion: Extract<Motion, { readonly kind: 'waypoints' }>;
  readonly space: '2d' | '3d';
  readonly onMotion: (motion: Motion) => void;
}): ReactNode {
  const { points } = motion;
  return (
    <ol className="ag-preview-waypoints">
      {points.map((point, index) => (
        <WaypointFields
          key={index}
          point={point}
          index={index}
          space={space}
          onPoint={(changed) => {
            onMotion({
              ...motion,
              points: points.map((one, at) => (at === index ? changed : one)),
            });
          }}
          onRemove={
            points.length > 2
              ? () => {
                  onMotion({ ...motion, points: points.filter((_, at) => at !== index) });
                }
              : undefined
          }
        />
      ))}
    </ol>
  );
}

/** A moving emitter's path: how it is played, and each waypoint. */
function PathFields({
  motion,
  space,
  onMotion,
}: {
  readonly motion: Extract<Motion, { readonly kind: 'waypoints' }>;
  readonly space: '2d' | '3d';
  readonly onMotion: (motion: Motion) => void;
}): ReactNode {
  const { points } = motion;
  const last = points.at(-1);
  return (
    <>
      <ChoiceField
        label="Path played"
        value={motion.repeat}
        choices={REPEATS}
        onChoose={(repeat) => {
          onMotion({ ...motion, repeat });
        }}
      />
      <WaypointList motion={motion} space={space} onMotion={onMotion} />
      {last === undefined ? null : (
        <Button
          compact
          onClick={() => {
            const next = {
              at: last.at,
              milliseconds: last.milliseconds + WAYPOINT_STEP_MILLISECONDS,
            };
            onMotion({ ...motion, points: [...points, next] });
          }}
        >
          Add a waypoint
        </Button>
      )}
    </>
  );
}

export function MotionFields({
  motion,
  space,
  onMotion,
}: {
  readonly motion: Motion;
  readonly space: '2d' | '3d';
  readonly onMotion: (motion: Motion) => void;
}): ReactNode {
  return (
    <>
      <ChoiceField
        label="Moves"
        value={motion.kind}
        choices={MOTIONS}
        onChoose={(kind) => {
          onMotion(motionOf(motion, kind));
        }}
      />
      {motion.kind === 'still' ? (
        <PositionFields
          label="Position"
          at={motion.at}
          space={space}
          onPosition={(at) => {
            onMotion({ kind: 'still', at });
          }}
        />
      ) : (
        <PathFields motion={motion} space={space} onMotion={onMotion} />
      )}
    </>
  );
}
