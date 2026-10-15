/**
 * What another package's tests may take from the loop analysis's test
 * support: the loops with known seams the golden suite pins, so the detection
 * worker's and the workflows' tests analyse the same audio.
 */

export {
  LOOP_FIXTURE_RATE,
  type LoopFixture,
  antiPhaseStereo,
  clickBeforeSeam,
  cutNoise,
  dcStep,
  directCurrentOnly,
  drone,
  drumBars,
  fixtureSource,
  levelStep,
  nonFinite,
  quarterPeriodShort,
  rightChannelDiscontinuous,
  seamlessSine,
  silentLoop,
  singleCycle,
  wholeSoundSine,
} from './loop-fixtures.js';
