import { describe, expect, it } from 'vitest';

import { fingerprint } from '@audiogubbins/audio-engine/testing';

import { runProcessor } from '../testing/processor-run.js';
import { AMBISONIC_ROTATION } from './ambisonic-rotate.js';
import { SphereRotation } from './sphere-rotation.js';
import { largestDifference } from '../testing/sample-difference.js';
import { burst, encoded, setLayout } from '../testing/space-measures.js';

/** A third-order AmbiX field from a source at 30° left and 20° up, turned by all three angles. */
const SOURCE = { azimuth: 30, elevation: 20, order: 'third' } as const;
const GOLDEN = { yaw: -120, pitch: 25, roll: 70 } as const;

/** The largest difference between the matrices of `rotation` and the identity, every degree to 3. */
function distanceFromIdentity(rotation: SphereRotation): number {
  let most = 0;
  for (let l = 0; l <= 3; l += 1) {
    for (let m = -l; m <= l; m += 1) {
      for (let n = -l; n <= l; n += 1) {
        most = Math.max(most, Math.abs(rotation.entry(l, m, n) - (m === n ? 1 : 0)));
      }
    }
  }
  return most;
}

describe('the ambisonic rotation, held to a recorded render', () => {
  it('turns a third-order field to the recorded bits', () => {
    const field = encoded(SOURCE, burst());
    const rotated = runProcessor(
      AMBISONIC_ROTATION,
      { layout: setLayout(3, 'sn3d'), values: GOLDEN },
      field,
    );
    expect(rotated.map((channel) => fingerprint(channel))).toEqual([
      18364377527975720668n,
      1106671577418402909n,
      18414109578124564040n,
      2536723850321096301n,
      2268681447092573770n,
      2561136174472420014n,
      4418576494263984159n,
      6834337246798794860n,
      3473102220090222507n,
      8899596168258440482n,
      15986827736367329244n,
      14423923180475828985n,
      2618367542024798585n,
      4098646339288433536n,
      3693800943711713303n,
      11700582257253204738n,
    ]);
  });

  it("turns a source by a yaw of 90° to the encoder's field at the turned azimuth", () => {
    const source = burst();
    for (const normalisation of ['sn3d', 'n3d', 'fuma'] as const) {
      const field = encoded({ ...SOURCE, normalisation }, source);
      const rotated = runProcessor(
        AMBISONIC_ROTATION,
        { layout: setLayout(3, normalisation), values: { yaw: 90 } },
        field,
      );
      const expected = encoded({ ...SOURCE, azimuth: 120, normalisation }, source);
      expect(largestDifference(rotated, expected)).toBeLessThan(1e-6);
    }
  });

  it('is the identity, within 1e-9, after a full turn about any axis or all three', () => {
    const rotation = new SphereRotation(3);
    for (const [yaw, pitch, roll] of [
      [360, 0, 0],
      [0, 360, 0],
      [0, 0, 360],
      [360, 360, 360],
      [-360, 360, -360],
    ] as const) {
      rotation.design(yaw, pitch, roll);
      expect(distanceFromIdentity(rotation)).toBeLessThan(1e-9);
    }
  });

  it('designs an orthogonal matrix at every degree, so a turn keeps the energy of every degree', () => {
    const rotation = new SphereRotation(3);
    rotation.design(GOLDEN.yaw, GOLDEN.pitch, GOLDEN.roll);
    for (let l = 1; l <= 3; l += 1) {
      for (let row = -l; row <= l; row += 1) {
        for (let other = -l; other <= l; other += 1) {
          let dot = 0;
          for (let n = -l; n <= l; n += 1)
            dot += rotation.entry(l, row, n) * rotation.entry(l, other, n);
          expect(Math.abs(dot - (row === other ? 1 : 0))).toBeLessThan(1e-12);
        }
      }
    }
  });
});
