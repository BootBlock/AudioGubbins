/**
 * The dials and the meters in every state they have: the slider, the knob and
 * the fader at rest, under the pointer, with the keyboard on them, dragged,
 * bypassed, disabled and unavailable; the level meters quiet, loud, with a
 * peak held and clipping, in rows and in columns; the correlation meter in
 * phase and out of it.
 *
 * Hover, focus-visible, active and pressed are forced by the harness through
 * `data-ag-force-state`; a drag is the active state, and its specimen forces
 * it itself so it reads the same whatever the harness forces. A meter runs
 * on a clock that never draws a frame, so it stands still at the reading it
 * is shown at: a held peak is the reading of a moment ago, caught as the
 * meter appears.
 */

import { useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';

import {
  CorrelationMeter,
  Fader,
  type FaderMark,
  type FrameClock,
  Knob,
  LevelMeter,
  type MeterScale,
  MeterOrientation,
  type SliderScale,
  ValueSlider,
} from '@audiogubbins/design-system';

import type { Specimen } from '../specimen.js';

/** A setting nothing listens to: a specimen only shows. */
const ignore = (): void => undefined;

const REASON = 'Turn the processor on first';

/** Decibels in the words a screen reader would say them in. */
const decibels = (value: number): string => `${value.toFixed(1)} decibels`;

/** The linear peak of a level in decibels of full scale, as the engine reports one. */
const gain = (level: number): number => 10 ** (level / 20);

/** Forces the drag's look on what it holds, whatever the harness forces round it. */
function Dragged({ children }: { readonly children: ReactNode }): ReactNode {
  return <div data-ag-force-state="active">{children}</div>;
}

// ---------- The slider ----------

function slider(extra: { readonly disabled?: boolean; readonly unavailableReason?: string } = {}) {
  return (
    <ValueSlider
      label="Mix"
      value={70}
      minimum={0}
      maximum={100}
      step={1}
      onValueChange={ignore}
      describeValue={(value) => `${String(value)} per cent`}
      displayValue="70%"
      {...extra}
    />
  );
}

/** A balance, which rests at its centre and moves either way from it. */
function centredSlider(value: number): ReactNode {
  return (
    <ValueSlider
      label="Balance"
      value={value}
      minimum={-100}
      maximum={100}
      step={1}
      detent={0}
      onValueChange={ignore}
      describeValue={(balance) =>
        `${String(Math.abs(balance))} per cent ${balance < 0 ? 'left' : 'right'}`
      }
      displayValue={value < 0 ? `L ${String(-value)}` : `R ${String(value)}`}
    />
  );
}

// ---------- The knob ----------

/**
 * A dial with its value field open for typing. The field opens on a click on
 * its value, which this makes once it is drawn, as the person would.
 */
function Typing({ children }: { readonly children: ReactNode }): ReactNode {
  const stage = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    stage.current?.querySelector<HTMLButtonElement>('button.ag-dial-field')?.click();
  }, []);
  return <div ref={stage}>{children}</div>;
}

function knob(
  extra: {
    readonly bypassed?: boolean;
    readonly disabled?: boolean;
    readonly unavailableReason?: string;
    readonly typed?: boolean;
  } = {},
) {
  const { typed = true, ...rest } = extra;
  return (
    <Knob
      label="Threshold"
      value={-18}
      minimum={-60}
      maximum={0}
      step={0.5}
      onValueChange={ignore}
      describeValue={decibels}
      displayValue="−18 dB"
      {...(typed
        ? { typing: { label: 'Threshold in dB, typed', text: '-18', onSubmit: ignore } }
        : {})}
      {...rest}
    />
  );
}

// ---------- The fader ----------

/** A gain fader's taper, through the language's marks: +10 dB at the top, unity a quarter down. */
const FADER_POINTS: readonly (readonly [number, number])[] = [
  [-60, 0],
  [-40, 0.14],
  [-30, 0.23],
  [-20, 0.35],
  [-10, 0.51],
  [-5, 0.63],
  [0, 0.75],
  [5, 0.9],
  [10, 1],
];

/** Where a level stands along the fader, between the taper's points. */
function faderPosition(level: number): number {
  if (level <= -60) return 0;
  for (let index = 1; index < FADER_POINTS.length; index += 1) {
    const [toLevel, toAt] = FADER_POINTS[index] ?? [0, 0];
    const [fromLevel, fromAt] = FADER_POINTS[index - 1] ?? [0, 0];
    if (level <= toLevel) {
      return fromAt + ((level - fromLevel) / (toLevel - fromLevel)) * (toAt - fromAt);
    }
  }
  return 1;
}

/** The level at a place along the fader. */
function faderLevel(position: number): number {
  for (let index = 1; index < FADER_POINTS.length; index += 1) {
    const [toLevel, toAt] = FADER_POINTS[index] ?? [0, 0];
    const [fromLevel, fromAt] = FADER_POINTS[index - 1] ?? [0, 0];
    if (position <= toAt) {
      return fromLevel + ((position - fromAt) / (toAt - fromAt)) * (toLevel - fromLevel);
    }
  }
  return 10;
}

const FADER_SCALE: SliderScale = { steps: 200, positionOf: faderPosition, valueAt: faderLevel };

const FADER_MARKS: readonly FaderMark[] = [
  { value: 10, label: '+10' },
  { value: 5, label: '+5', minor: true },
  { value: 0, label: '0', emphasised: true },
  { value: -5, label: '−5', minor: true },
  { value: -10, label: '−10' },
  { value: -20, label: '−20' },
  { value: -30, label: '−30', minor: true },
  { value: -40, label: '−40' },
  { value: -60, label: '−60', minor: true },
];

function fader(
  extra: {
    readonly bypassed?: boolean;
    readonly disabled?: boolean;
    readonly unavailableReason?: string;
    readonly short?: boolean;
  } = {},
) {
  const { short = false, ...rest } = extra;
  return (
    // A fader takes its container's height: a long travel, or a short one that
    // leaves out its minor marks.
    <div style={{ blockSize: short ? '120px' : '240px', display: 'flex' }}>
      <Fader
        label="Gain"
        value={3}
        minimum={-60}
        maximum={10}
        scale={FADER_SCALE}
        marks={FADER_MARKS}
        onValueChange={ignore}
        describeValue={decibels}
        displayValue="3 dB"
        {...rest}
      />
    </div>
  );
}

// ---------- The meters ----------

/** The transport's printed levels, spread evenly along the meter as its scale reads. */
const METER_MARKS = [-60, -36, -24, -12, -6, -3, 0];

function meterPosition(level: number): number {
  const last = METER_MARKS.length - 1;
  for (let index = 1; index <= last; index += 1) {
    const to = METER_MARKS[index] ?? 0;
    const from = METER_MARKS[index - 1] ?? 0;
    if (level <= to) return (index - 1 + (level - from) / (to - from)) / last;
  }
  return 1;
}

const METER_SCALE: MeterScale = {
  floor: -60,
  positionOf: meterPosition,
  marks: METER_MARKS.map((level) => ({
    decibels: level,
    label: level === 0 ? '0' : `−${String(-level)}`,
  })),
};

/**
 * A clock that never draws a frame, its time moved only by the specimen, so a
 * meter shows one moment and holds it.
 */
function stillClock(): FrameClock & { advance: (milliseconds: number) => void } {
  let time = 0;
  return {
    now: () => time,
    requestFrame: () => 0,
    cancelFrame: ignore,
    advance: (milliseconds) => {
      time += milliseconds;
    },
  };
}

/** Each channel's reading: the one it shows now, and a louder one of a moment ago, if any. */
interface Readings {
  readonly now: readonly [number, number];
  readonly before?: readonly [number, number];
}

const QUIET: Readings = { now: [gain(-36), gain(-38)] };
const LOUD: Readings = { now: [gain(-6), gain(-8)] };
const PEAK_HELD: Readings = { before: [gain(-3), gain(-4)], now: [gain(-14), gain(-16)] };
const CLIPPING: Readings = { now: [1.4, gain(-2)] };

/** The reading a still meter shows, moved from a moment ago to now once. */
interface ReadingsInTurn {
  readonly shown: () => readonly [number, number];
  readonly subscribe: (changed: () => void) => () => void;
  readonly moveOn: () => void;
}

/**
 * `readings` shown in turn: the one of a moment ago, if any, until `moveOn`,
 * then the present one. Held outside React, as the still clock is, so the
 * meter is drawn again from the specimen's own time rather than from a state
 * an effect sets.
 */
function readingsInTurn(readings: Readings): ReadingsInTurn {
  let shown = readings.before ?? readings.now;
  const watchers = new Set<() => void>();
  return {
    shown: () => shown,
    subscribe: (changed) => {
      watchers.add(changed);
      return () => watchers.delete(changed);
    },
    moveOn: () => {
      shown = readings.now;
      for (const changed of watchers) changed();
    },
  };
}

/**
 * A stereo meter at `readings`: a reading of a moment ago is shown first and
 * the present one 0.3 s later, before the first paint, so its peak is held.
 */
function StillMeter({
  readings,
  orientation,
  prominent = false,
}: {
  readonly readings: Readings;
  readonly orientation: MeterOrientation;
  readonly prominent?: boolean;
}): ReactNode {
  const [clock] = useState(stillClock);
  const [turn] = useState(() => readingsInTurn(readings));
  const [left, right] = useSyncExternalStore(turn.subscribe, turn.shown);
  useLayoutEffect(() => {
    if (readings.before === undefined) return;
    clock.advance(300);
    turn.moveOn();
  }, [clock, readings, turn]);
  const meter = (
    <LevelMeter
      label="Levels at the output"
      channels={[
        { name: 'Left peak', letter: 'L', peak: left },
        { name: 'Right peak', letter: 'R', peak: right },
      ]}
      scale={METER_SCALE}
      describePeak={(peak) => `${(20 * Math.log10(peak)).toFixed(1)} dB`}
      orientation={orientation}
      prominent={prominent}
      clock={clock}
    />
  );
  // Columns take their container's height, as a rack's do.
  return orientation === MeterOrientation.Vertical ? (
    <div style={{ blockSize: '120px' }}>{meter}</div>
  ) : (
    <div style={{ inlineSize: '300px' }}>{meter}</div>
  );
}

function correlation(reading: number): ReactNode {
  const shown = `${reading > 0 ? '+' : reading < 0 ? '−' : ''}${Math.abs(reading).toFixed(2)}`;
  return (
    <div style={{ inlineSize: '300px' }}>
      <CorrelationMeter
        label="Left and right correlation"
        caption="Corr"
        correlation={reading}
        displayValue={shown}
        describeCorrelation={() => shown}
        clock={stillClock()}
      />
    </div>
  );
}

const METER_STATES: readonly (readonly [string, Readings])[] = [
  ['quiet', QUIET],
  ['loud', LOUD],
  ['peak held', PEAK_HELD],
  ['clipping', CLIPPING],
];

const specimens: readonly Specimen[] = [
  { component: 'ValueSlider', state: 'default', render: () => slider() },
  { component: 'ValueSlider', state: 'hover', render: () => slider() },
  { component: 'ValueSlider', state: 'focus-visible', render: () => slider() },
  { component: 'ValueSlider', state: 'active', render: () => slider() },
  { component: 'ValueSlider', state: 'dragging', render: () => <Dragged>{slider()}</Dragged> },
  { component: 'ValueSlider', state: 'disabled', render: () => slider({ disabled: true }) },
  {
    component: 'ValueSlider',
    state: 'unavailable',
    render: () => slider({ unavailableReason: REASON }),
  },
  { component: 'ValueSlider', state: 'centred, right', render: () => centredSlider(40) },
  { component: 'ValueSlider', state: 'centred, left', render: () => centredSlider(-25) },

  { component: 'Knob', state: 'default', render: () => knob() },
  { component: 'Knob', state: 'hover', render: () => knob() },
  { component: 'Knob', state: 'focus-visible', render: () => knob() },
  { component: 'Knob', state: 'active', render: () => knob() },
  { component: 'Knob', state: 'dragging', render: () => <Dragged>{knob()}</Dragged> },
  { component: 'Knob', state: 'bypassed', render: () => knob({ bypassed: true }) },
  { component: 'Knob', state: 'disabled', render: () => knob({ disabled: true }) },
  { component: 'Knob', state: 'unavailable', render: () => knob({ unavailableReason: REASON }) },
  { component: 'Knob', state: 'value read only', render: () => knob({ typed: false }) },
  { component: 'Knob', state: 'typing a value', render: () => <Typing>{knob()}</Typing> },

  { component: 'Fader', state: 'default', render: () => fader() },
  { component: 'Fader', state: 'hover', render: () => fader() },
  { component: 'Fader', state: 'focus-visible', render: () => fader() },
  { component: 'Fader', state: 'active', render: () => fader() },
  { component: 'Fader', state: 'dragging', render: () => <Dragged>{fader()}</Dragged> },
  { component: 'Fader', state: 'bypassed', render: () => fader({ bypassed: true }) },
  { component: 'Fader', state: 'disabled', render: () => fader({ disabled: true }) },
  { component: 'Fader', state: 'unavailable', render: () => fader({ unavailableReason: REASON }) },
  { component: 'Fader', state: 'short travel', render: () => fader({ short: true }) },

  ...METER_STATES.map(([state, readings]): Specimen => ({
    component: 'LevelMeter',
    state,
    render: () => <StillMeter readings={readings} orientation={MeterOrientation.Horizontal} />,
  })),
  {
    component: 'LevelMeter',
    state: 'prominent, loud',
    render: () => (
      <StillMeter readings={LOUD} orientation={MeterOrientation.Horizontal} prominent />
    ),
  },
  ...METER_STATES.map(([state, readings]): Specimen => ({
    component: 'LevelMeter',
    state: `vertical, ${state}`,
    render: () => <StillMeter readings={readings} orientation={MeterOrientation.Vertical} />,
  })),

  { component: 'CorrelationMeter', state: 'in phase', render: () => correlation(0.72) },
  { component: 'CorrelationMeter', state: 'unrelated', render: () => correlation(0) },
  { component: 'CorrelationMeter', state: 'out of phase', render: () => correlation(-0.6) },
];

export default specimens;
