/**
 * The known signal the loopback calibration plays (`REQ-REC-095`, ADR-0070).
 *
 * A maximum-length sequence: a burst of pseudo-random full-scale steps whose
 * correlation with itself is one sharp peak, so its delay through a speaker, a
 * room and a microphone is found to the frame even under noise, since the
 * correlation gathers the whole burst's energy into that peak. A sweep would
 * do, but its correlation peak is broader for the same length, and a tone's
 * repeats every period, which is the ambiguity a delay must not have.
 *
 * ADR-0045's signal recipes describe the engine's generated audio and live in
 * the audio engine, which this package may not depend on; the burst is defined
 * here, sample for sample, and the application plays it as given. It is the
 * same at every rate: a sequence of frames, so its duration scales with the
 * rate and the correlation's sharpness does not.
 */

/**
 * The sequence's order: 4,095 frames, 85 milliseconds at 48 kHz. Long enough
 * that the correlation peak stands 36 dB above uncorrelated noise of the same
 * level, short enough to be heard as a click rather than a hiss.
 */
const ORDER = 12;

/**
 * The feedback taps of x¹² + x⁶ + x⁴ + x + 1, a primitive polynomial, so the
 * register passes through every non-zero state before it repeats, which is
 * what makes the sequence's correlation a single peak.
 */
const TAPS = 0b1000_0010_1001;

/** The burst's level: a quarter of full scale, loud enough to be heard back, gentle on speakers and ears. */
export const CALIBRATION_SIGNAL_PEAK = 0.25;

/** The burst's length in frames. */
export const CALIBRATION_SIGNAL_LENGTH = 2 ** ORDER - 1;

/** The burst, made once: a Galois shift register's output, each bit a step up or down. */
const SEQUENCE: Float32Array = (() => {
  const steps = new Float32Array(CALIBRATION_SIGNAL_LENGTH);
  let register = 1;
  for (let index = 0; index < steps.length; index += 1) {
    const bit = register & 1;
    register >>>= 1;
    if (bit === 1) register ^= TAPS;
    steps[index] = bit === 1 ? CALIBRATION_SIGNAL_PEAK : -CALIBRATION_SIGNAL_PEAK;
  }
  return steps;
})();

/**
 * A copy of the burst, to play. A copy, because a caller posting it to the
 * audio thread transfers it, which would empty the one the analysis reads.
 */
export function calibrationSignal(): Float32Array {
  return SEQUENCE.slice();
}

/** The burst the analysis correlates against, which nothing outside this package may change. */
export function calibrationSequence(): Readonly<Float32Array> {
  return SEQUENCE;
}
