import { describe, expect, it } from 'vitest';

import { motionFor } from '../../tokens/motion.js';
import { MotionLevel } from '../../tokens/preferences.js';
import { CorrelationGlide, PeakBallistics, decibelsOf } from './meter-ballistics.js';

/**
 * The meter's ballistics, read at times the test chooses: a rise at once, a
 * fall of 20 dB a second, a peak held 1.2 s then falling at 12 dB a second, a
 * clip lamp held 1.5 s after an over, and a correlation pointer gliding with a
 * 170 ms time constant (the design language's MotionSpec).
 */

const BALLISTICS = motionFor(MotionLevel.Full).ballistics;
const FLOOR = -60;

describe('PeakBallistics', () => {
  it('rises to a new reading at once', () => {
    const meter = new PeakBallistics(BALLISTICS, FLOOR, 0);
    meter.report(-6, 0);

    expect(meter.read(0).level).toBe(-6);
  });

  it('falls back towards a quieter reading at the fall rate, and stops there', () => {
    const meter = new PeakBallistics(BALLISTICS, FLOOR, 0);
    meter.report(-6, 0);
    meter.report(-40, 0);

    expect(meter.read(500).level).toBeCloseTo(-16, 6);
    expect(meter.read(1000).level).toBeCloseTo(-26, 6);
    expect(meter.read(5000).level).toBe(-40);
  });

  it('holds a steady reading still, however long it is reported', () => {
    const meter = new PeakBallistics(BALLISTICS, FLOOR, 0);
    meter.report(-12, 0);
    meter.report(-12, 400);

    expect(meter.read(3000).level).toBe(-12);
    expect(meter.settledAt(3000)).toBe(true);
  });

  it('holds its peak for the hold, then lets it fall at the peak rate, never below the level', () => {
    const meter = new PeakBallistics(BALLISTICS, FLOOR, 0);
    meter.report(-3, 0);
    meter.report(-30, 0);

    expect(meter.read(1200).peak).toBe(-3);
    expect(meter.read(1700).peak).toBeCloseTo(-9, 6);
    // By then the level has fallen to its reading, and the peak falls to it.
    expect(meter.read(10_000).peak).toBe(-30);
  });

  it('catches a louder reading as its new peak and holds it afresh', () => {
    const meter = new PeakBallistics(BALLISTICS, FLOOR, 0);
    meter.report(-10, 0);
    meter.report(-20, 0);
    meter.report(-4, 1000);
    meter.report(-20, 1000);

    expect(meter.read(2100).peak).toBe(-4);
  });

  it('lights the clip lamp on an over and keeps it lit for the hold after the over ends', () => {
    const meter = new PeakBallistics(BALLISTICS, FLOOR, 0);
    meter.report(decibelsOf(1.4), 0);

    expect(meter.read(0).clipping).toBe(true);
    expect(meter.read(5000).clipping).toBe(true);

    meter.report(-10, 100);
    expect(meter.read(1599).clipping).toBe(true);
    expect(meter.read(1600).clipping).toBe(false);
  });

  it('does not light the clip lamp below full scale', () => {
    const meter = new PeakBallistics(BALLISTICS, FLOOR, 0);
    meter.report(decibelsOf(0.99), 0);

    expect(meter.read(0).clipping).toBe(false);
  });

  it('shows silence at its floor, and comes to rest there', () => {
    const meter = new PeakBallistics(BALLISTICS, FLOOR, 0);
    meter.report(-6, 0);
    meter.report(decibelsOf(0), 0);

    expect(meter.settledAt(1000)).toBe(false);
    expect(meter.read(10_000)).toEqual({ level: FLOOR, peak: FLOOR, clipping: false });
    expect(meter.settledAt(10_000)).toBe(true);
  });
});

describe('CorrelationGlide', () => {
  it('glides towards a new reading with the time constant, and comes to rest at it', () => {
    const pointer = new CorrelationGlide(BALLISTICS, 0, 0);
    pointer.report(1, 0);

    expect(pointer.read(0)).toBe(0);
    expect(pointer.read(170)).toBeCloseTo(1 - Math.exp(-1), 6);
    expect(pointer.settledAt(170)).toBe(false);
    expect(pointer.settledAt(2000)).toBe(true);
  });

  it('starts at the reading it appears with', () => {
    const pointer = new CorrelationGlide(BALLISTICS, -0.4, 0);

    expect(pointer.read(0)).toBe(-0.4);
    expect(pointer.settledAt(0)).toBe(true);
  });

  it('turns from where it is when a reading arrives mid-glide', () => {
    const pointer = new CorrelationGlide(BALLISTICS, 0, 0);
    pointer.report(1, 0);
    const midway = pointer.read(170);
    pointer.report(0, 170);

    expect(pointer.read(170)).toBeCloseTo(midway, 9);
    expect(pointer.read(340)).toBeCloseTo(midway * Math.exp(-1), 6);
  });
});
