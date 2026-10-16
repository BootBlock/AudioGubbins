/**
 * The loop analysis's golden results (`REQ-GAME-121`'s acceptance criterion
 * of reproducible suggestions on known discontinuity fixtures, ADR-0103):
 * every metric's value, verdict, worst channel and reference, and the ranked
 * candidates, pinned exactly for each fixture of `testing/loop-fixtures.ts`.
 *
 * The analysis uses the basic operations and the canonical primitives alone,
 * in a stated order (ADR-0032), so these values are the same on every machine
 * and with either implementation of the canonical port. A change to a metric,
 * a threshold or the search changes `LOOP_ANALYSIS_VERSION` and these values
 * together (`REQ-EXEC-180`).
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { REFERENCE_DSP, wasmDsp, type CanonicalDsp } from '@audiogubbins/audio-engine';
import { dspModuleExports } from '@audiogubbins/audio-engine/testing';
import { createCancellationSource } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import { LOOP_ANALYSIS_VERSION, analyseLoop, type LoopAnalysis } from './analyse-loop.js';
import { defaultLoopSearch } from './loop-request.js';
import type { LoopMetric } from './verdicts.js';
import {
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
} from './testing/loop-fixtures.js';

/** A metric as pinned: verdict, value, worst channel, reference. */
type Pinned = readonly [string, number, number | undefined, string | undefined];

/** A candidate as pinned: start, end, cost, crossfade, whether it makes room for it. */
type PinnedCandidate = readonly [
  number,
  number,
  number,
  readonly [number, string] | undefined,
  boolean,
];

interface Golden {
  readonly name: string;
  readonly verdict: string;
  /** Discontinuity, DC mismatch, net DC, level, phase, spectral, zero crossings at start and end, signs, seam, drift. */
  readonly metrics: readonly Pinned[];
  /** Shape, level change, correlation and verdict of the loop's crossfade. */
  readonly crossfade: readonly [string, number, number, string] | undefined;
  readonly candidates: readonly PinnedCandidate[];
}

/** How each fixture is analysed: no search, a search with the length free, or kept; and a crossfade. */
const CASES: readonly (readonly [() => LoopFixture, 'none' | 'free' | 'kept', number])[] = [
  [seamlessSine, 'free', 0],
  [wholeSoundSine, 'free', 0],
  [quarterPeriodShort, 'free', 0],
  [dcStep, 'none', 0],
  [levelStep, 'none', 0],
  [drone, 'none', 0],
  [drumBars, 'free', 0],
  [cutNoise, 'free', 0],
  [cutNoise, 'kept', 0],
  [rightChannelDiscontinuous, 'none', 0],
  [antiPhaseStereo, 'free', 0],
  [clickBeforeSeam, 'none', 0],
  [singleCycle, 'none', 0],
  [silentLoop, 'none', 0],
  [directCurrentOnly, 'none', 0],
  [seamlessSine, 'none', 480],
];

function pinned(metric: LoopMetric): Pinned {
  return [metric.verdict, metric.value, metric.channel, metric.reference];
}

/** An analysis as the goldens pin it. */
function asPinned(name: string, analysis: LoopAnalysis): Golden {
  const current = analysis.current;
  return {
    name,
    verdict: analysis.verdict,
    metrics: [
      current.discontinuity,
      current.dcMismatch,
      current.netDc,
      current.levelMismatch,
      current.phaseMismatch,
      current.spectralMismatch,
      current.zeroCrossing.start,
      current.zeroCrossing.end,
      current.zeroCrossing.signs,
      current.cycleStability.seam,
      current.cycleStability.drift,
    ].map(pinned),
    crossfade:
      current.crossfade === undefined
        ? undefined
        : [
            current.crossfade.shape,
            current.crossfade.levelChangeDb,
            current.crossfade.correlation,
            current.crossfade.verdict,
          ],
    candidates: analysis.candidates.map((candidate) => [
      candidate.start,
      candidate.end,
      candidate.cost,
      candidate.crossfade === undefined
        ? undefined
        : [candidate.crossfade.lengthFrames, candidate.crossfade.shape],
      candidate.makesRoomForCrossfade,
    ]),
  };
}

/** The analysis of case `index` with `dsp`. */
async function analysed(index: number, dsp: CanonicalDsp): Promise<LoopAnalysis> {
  const [make, search, crossfadeLength] = CASES[index] ?? [seamlessSine, 'none', 0];
  const fixture = make();
  const source = fixtureSource(fixture);
  const result = await analyseLoop(
    source,
    source,
    {
      loop: { ...fixture.loop, crossfadeLength },
      ...(search === 'none'
        ? {}
        : { search: { ...defaultLoopSearch(fixture.sampleRate), keepLength: search === 'kept' } }),
    },
    {
      dsp,
      signal: createCancellationSource().signal,
      yieldToHost: () => Promise.resolve(),
      onProgress: () => undefined,
    },
  );
  return expectSuccess(result);
}

const GOLDEN: readonly Golden[] = [
  {
    name: 'seamless sine',
    verdict: 'pass',
    metrics: [
      ['pass', 0, 0, 'post-end'],
      ['pass', -144.49439791871097, 0, 'post-end'],
      ['pass', -144.49439791871097, 0, undefined],
      ['pass', 0, 0, 'post-end'],
      ['pass', 0, 0, 'post-end'],
      ['pass', 0, 0, 'post-end'],
      ['pass', 0, undefined, undefined],
      ['pass', 0, undefined, undefined],
      ['pass', 0, undefined, 'post-end'],
      ['pass', 0.36262469468838515, 0, undefined],
      ['pass', 0, 0, 'post-end'],
    ],
    crossfade: undefined,
    candidates: [
      [4800, 28800, 0.12093450287423711, undefined, false],
      [4801, 28801, 0.12145533620757044, undefined, false],
      [4700, 28800, 0.14697616954090378, undefined, false],
      [4701, 28801, 0.14697616954090378, undefined, false],
      [4750, 28850, 0.14697616954090378, undefined, false],
    ],
  },
  {
    name: 'whole-sound sine',
    verdict: 'warn',
    metrics: [
      ['pass', 0, 0, 'adjacent'],
      ['pass', -144.49439791871097, 0, 'adjacent'],
      ['pass', -144.49439791871097, 0, undefined],
      ['pass', 0, 0, 'adjacent'],
      ['pass', 0.2627508773922216, 0, 'adjacent'],
      ['pass', 0, 0, 'adjacent'],
      ['pass', 1, undefined, undefined],
      ['warn', 49, undefined, undefined],
      ['pass', 0, undefined, 'adjacent'],
      ['pass', 0.36262469468838515, 0, undefined],
      ['pass', 0, 0, 'adjacent'],
    ],
    crossfade: undefined,
    candidates: [
      [1, 23701, 0.21657491498160886, undefined, false],
      [51, 23751, 0.21657491498160886, undefined, false],
      [50, 23750, 0.21657622803371857, undefined, false],
      [1, 23601, 0.24261658164827554, undefined, false],
      [51, 23651, 0.24261658164827554, undefined, false],
      [2400, 24000, 0.7459345028742371, [2400, 'linear'], true],
    ],
  },
  {
    name: 'quarter period short',
    verdict: 'fail',
    metrics: [
      ['fail', 1413.4698888761252, 0, 'post-end'],
      ['pass', -127.10800528964378, 0, 'post-end'],
      ['pass', -69.3134640481752, 0, undefined],
      ['pass', 1.928654933106574e-15, 0, 'post-end'],
      ['fail', 89.99999998161815, 0, 'post-end'],
      ['pass', 0.002269559080061591, 0, 'post-end'],
      ['pass', 0, undefined, undefined],
      ['warn', 24, undefined, undefined],
      ['pass', 0, undefined, 'post-end'],
      ['pass', 0.5878607559413879, 0, undefined],
      ['pass', 0.0056932729097471935, 0, 'post-end'],
    ],
    crossfade: undefined,
    candidates: [
      [4800, 28800, 0.12744491954090378, undefined, false],
      [4801, 28801, 0.12796575287423712, undefined, false],
      [4751, 28751, 0.13994491954090377, undefined, false],
      [4750, 28750, 0.14046575287423713, undefined, false],
      [4800, 28700, 0.14046575287423713, undefined, false],
    ],
  },
  {
    name: 'DC step',
    verdict: 'fail',
    metrics: [
      ['fail', 140.36984382111876, 0, 'post-end'],
      ['fail', -26.020599308195134, 0, 'post-end'],
      ['fail', -32.04119922147476, 0, undefined],
      ['pass', 0.08600162883956163, 0, 'post-end'],
      ['pass', 0, 0, 'post-end'],
      ['pass', 4.0657028616131085e-8, 0, 'post-end'],
      ['pass', 0, undefined, undefined],
      ['pass', 1, undefined, undefined],
      ['pass', 0, undefined, 'post-end'],
      ['pass', 0.04429411223715955, 0, undefined],
      ['pass', 0.08577908162257941, 0, 'post-end'],
    ],
    crossfade: undefined,
    candidates: [],
  },
  {
    name: 'level step',
    verdict: 'fail',
    metrics: [
      ['fail', 56.15217543812994, 0, 'post-end'],
      ['pass', -144.49439791871097, 0, 'post-end'],
      ['pass', -144.49439791871097, 0, undefined],
      ['fail', 6.020599913279624, 0, 'post-end'],
      ['pass', 0, 0, 'post-end'],
      ['warn', 1.972884738265816, 0, 'post-end'],
      ['pass', 0, undefined, undefined],
      ['pass', 0, undefined, undefined],
      ['pass', 0, undefined, 'post-end'],
      ['fail', 13.485085657041566, 0, undefined],
      ['fail', 6.020599913279623, 0, 'post-end'],
    ],
    crossfade: undefined,
    candidates: [],
  },
  {
    name: 'drone',
    verdict: 'warn',
    metrics: [
      ['pass', 0, 0, 'post-end'],
      ['pass', -144.49439791871097, 0, 'post-end'],
      ['warn', -47.95878943916141, 0, undefined],
      ['pass', 0, 0, 'post-end'],
      ['pass', 0, 0, 'post-end'],
      ['pass', 0, 0, 'post-end'],
      ['pass', 0, undefined, undefined],
      ['pass', 0, undefined, undefined],
      ['pass', 0, undefined, 'post-end'],
      ['pass', 0.8426911450976594, 0, undefined],
      ['pass', 0, 0, 'post-end'],
    ],
    crossfade: undefined,
    candidates: [],
  },
  {
    name: 'drum bars',
    verdict: 'warn',
    metrics: [
      ['pass', 0, 0, 'post-end'],
      ['pass', -144.49439791871097, 0, 'post-end'],
      ['warn', -50.31746724197739, 0, undefined],
      ['pass', 0, 0, 'post-end'],
      ['pass', 0, 0, 'post-end'],
      ['pass', 0, 0, 'post-end'],
      ['pass', 1, undefined, undefined],
      ['pass', 1, undefined, undefined],
      ['pass', 0, undefined, 'post-end'],
      ['pass', 1.2893767022774252, 0, undefined],
      ['pass', 0, 0, 'post-end'],
    ],
    crossfade: undefined,
    candidates: [
      [24001, 48001, 0.43058487774089194, undefined, false],
      [24003, 48003, 0.4329805635841856, undefined, false],
      [24007, 48007, 0.4366243723578278, undefined, false],
      [24008, 48008, 0.4377938092059472, undefined, false],
      [24009, 48009, 0.43861974108586305, undefined, false],
    ],
  },
  {
    name: 'cut noise',
    verdict: 'warn',
    metrics: [
      ['pass', 0.12784200150235447, 0, 'post-end'],
      ['pass', -78.59522220254294, 0, 'post-end'],
      ['pass', -73.85828483786618, 0, undefined],
      ['pass', 0.008698143367624213, 0, 'post-end'],
      ['not-applicable', 0, undefined, undefined],
      ['pass', 0.4674308526477021, 0, 'post-end'],
      ['warn', 3, undefined, undefined],
      ['warn', 2, undefined, undefined],
      ['pass', 0, undefined, 'post-end'],
      ['pass', 0.027086583157370163, 0, undefined],
      ['pass', 0.002557031054804426, 0, 'post-end'],
    ],
    crossfade: undefined,
    candidates: [
      [12092, 36092, 0.05388783217363552, undefined, false],
      [11982, 35982, 0.05389218211950252, undefined, false],
      [11984, 35984, 0.06766472265062384, undefined, false],
      [12043, 36043, 0.06851545268337134, undefined, false],
      [12094, 36094, 0.07313427357230683, undefined, false],
    ],
  },
  {
    name: 'cut noise, length kept',
    verdict: 'warn',
    metrics: [
      ['pass', 0.12784200150235447, 0, 'post-end'],
      ['pass', -78.59522220254294, 0, 'post-end'],
      ['pass', -73.85828483786618, 0, undefined],
      ['pass', 0.008698143367624213, 0, 'post-end'],
      ['not-applicable', 0, undefined, undefined],
      ['pass', 0.4674308526477021, 0, 'post-end'],
      ['warn', 3, undefined, undefined],
      ['warn', 2, undefined, undefined],
      ['pass', 0, undefined, 'post-end'],
      ['pass', 0.027086583157370163, 0, undefined],
      ['pass', 0.002557031054804426, 0, 'post-end'],
    ],
    crossfade: undefined,
    candidates: [
      [12049, 35988, 0.45061249270401094, undefined, false],
      [12041, 35980, 0.4577453926352681, undefined, false],
      [12039, 35978, 0.46305834935709705, undefined, false],
      [12047, 35986, 0.4662780561867303, undefined, false],
      [12040, 35979, 0.46966977805080473, undefined, false],
    ],
  },
  {
    name: 'right channel discontinuous',
    verdict: 'fail',
    metrics: [
      ['fail', 179.3707740066533, 1, 'post-end'],
      ['pass', -121.11411652498548, 1, 'post-end'],
      ['pass', -63.66075023163071, 1, undefined],
      ['pass', 0, 0, 'post-end'],
      ['fail', 180, 1, 'post-end'],
      ['pass', 0, 0, 'post-end'],
      ['pass', 0, undefined, undefined],
      ['pass', 0, undefined, undefined],
      ['pass', 0, undefined, 'post-end'],
      ['pass', 0.8953384940141828, 1, undefined],
      ['pass', 0, 0, 'post-end'],
    ],
    crossfade: undefined,
    candidates: [],
  },
  {
    name: 'anti-phase stereo',
    verdict: 'fail',
    metrics: [
      ['fail', 1402.709203965504, 0, 'post-end'],
      ['pass', -128.22772369329783, 0, 'post-end'],
      ['pass', -71.07801898672963, 0, undefined],
      ['pass', 1.928654933106574e-15, 0, 'post-end'],
      ['fail', 82.80000004706488, 0, 'post-end'],
      ['pass', 0.0021720938960549455, 0, 'post-end'],
      ['pass', 0, undefined, undefined],
      ['warn', 22, undefined, undefined],
      ['pass', 0, undefined, 'post-end'],
      ['pass', 0.6489835502069347, 0, undefined],
      ['pass', 0.0038921735214874076, 0, 'pre-start'],
    ],
    crossfade: undefined,
    candidates: [
      [4800, 28800, 0.12692408620757045, undefined, false],
      [4801, 28801, 0.12692408620757045, undefined, false],
      [4750, 28850, 0.14098658620757046, undefined, false],
      [4751, 28851, 0.14098658620757046, undefined, false],
      [4800, 28900, 0.14098658620757046, undefined, false],
    ],
  },
  {
    name: 'click before seam',
    verdict: 'fail',
    metrics: [
      ['fail', 329.3936722768238, 0, 'pre-start'],
      ['pass', -144.49439791871097, 0, 'post-end'],
      ['pass', -93.62482468279683, 0, undefined],
      ['pass', 0, 0, 'post-end'],
      ['pass', 0, 0, 'post-end'],
      ['pass', 0, 0, 'post-end'],
      ['pass', 0, undefined, undefined],
      ['pass', 0, undefined, undefined],
      ['pass', 0, undefined, 'post-end'],
      ['pass', 0.46590951778705136, 0, undefined],
      ['pass', 0, 0, 'post-end'],
    ],
    crossfade: undefined,
    candidates: [],
  },
  {
    name: 'single cycle',
    verdict: 'pass',
    metrics: [
      ['pass', 0, 0, 'adjacent'],
      ['pass', -144.49439791871097, 0, 'adjacent'],
      ['pass', -144.49439791871097, 0, undefined],
      ['pass', 0, 0, 'adjacent'],
      ['not-applicable', 0, undefined, undefined],
      ['not-applicable', 0, undefined, undefined],
      ['pass', 0, undefined, undefined],
      ['pass', 0, undefined, undefined],
      ['pass', 0, undefined, 'adjacent'],
      ['not-applicable', 0, undefined, undefined],
      ['not-applicable', 0, undefined, undefined],
    ],
    crossfade: undefined,
    candidates: [],
  },
  {
    name: 'silence',
    verdict: 'pass',
    metrics: [
      ['pass', 0, 0, 'post-end'],
      ['pass', -144.49439791871097, 0, 'post-end'],
      ['pass', -144.49439791871097, 0, undefined],
      ['pass', 0, 0, 'post-end'],
      ['not-applicable', 0, undefined, undefined],
      ['pass', 0, 0, 'post-end'],
      ['pass', 0, undefined, undefined],
      ['pass', 0, undefined, undefined],
      ['pass', 0, undefined, 'post-end'],
      ['pass', 0.9999999999999432, 0, undefined],
      ['pass', 0, 0, 'post-end'],
    ],
    crossfade: undefined,
    candidates: [],
  },
  {
    name: 'DC only',
    verdict: 'fail',
    metrics: [
      ['pass', 0, 0, 'post-end'],
      ['pass', -144.49439791871097, 0, 'post-end'],
      ['fail', -12.041199826559248, 0, undefined],
      ['pass', 0, 0, 'post-end'],
      ['not-applicable', 0, undefined, undefined],
      ['pass', 0, 0, 'post-end'],
      ['warn', 49, undefined, undefined],
      ['warn', 49, undefined, undefined],
      ['pass', 0, undefined, 'post-end'],
      ['pass', 0.17600346881497586, 0, undefined],
      ['pass', 0, 0, 'post-end'],
    ],
    crossfade: undefined,
    candidates: [],
  },
  {
    name: 'seamless sine with a crossfade',
    verdict: 'pass',
    metrics: [
      ['pass', 0, 0, 'post-end'],
      ['pass', -144.49439791871097, 0, 'post-end'],
      ['pass', -144.49439791871097, 0, undefined],
      ['pass', 0, 0, 'post-end'],
      ['pass', 0, 0, 'post-end'],
      ['pass', 0, 0, 'post-end'],
      ['pass', 0, undefined, undefined],
      ['pass', 0, undefined, undefined],
      ['pass', 0, undefined, 'post-end'],
      ['pass', 0.36262469468838515, 0, undefined],
      ['pass', 0, 0, 'post-end'],
    ],
    crossfade: ['linear', 9.643274665532871e-16, 1, 'pass'],
    candidates: [],
  },
];

describe('the loop analysis on fixtures with known seams', () => {
  it('is the version these values were pinned at', () => {
    expect(LOOP_ANALYSIS_VERSION).toBe(1);
  });

  GOLDEN.forEach((golden, index) => {
    it(`pins ${golden.name}`, async () => {
      expect(asPinned(golden.name, await analysed(index, REFERENCE_DSP))).toEqual(golden);
    }, 60_000);
  });

  it('suggests whole periods for the sine loops, the current points where they are already seamless', () => {
    const [seamless, , short] = GOLDEN;
    expect(seamless?.candidates[0]?.slice(0, 2)).toEqual([4_800, 28_800]);
    expect(short?.candidates[0]?.slice(0, 2)).toEqual([4_800, 28_800]);
    for (const [start, end] of short?.candidates ?? []) expect((end - start) % 100).toBe(0);
  });

  it('refuses audio holding a sample that is not finite', async () => {
    const fixture = nonFinite();
    const source = fixtureSource(fixture);
    const result = await analyseLoop(
      source,
      source,
      { loop: fixture.loop },
      {
        dsp: REFERENCE_DSP,
        signal: createCancellationSource().signal,
        yieldToHost: () => Promise.resolve(),
        onProgress: () => undefined,
      },
    );
    expect(result.ok ? undefined : result.failures[0].code).toBe('loop.non-finite-audio');
  });
});

describe('the loop analysis with the WebAssembly module', () => {
  let wasm: CanonicalDsp;
  beforeAll(async () => {
    wasm = expectSuccess(wasmDsp(await dspModuleExports()));
  });

  // A sine searched, noise searched with its length kept, a stereo seam and a
  // loop read around itself: every primitive and transform the analysis uses.
  [0, 8, 9, 12].forEach((index) => {
    it(`gives the reference's bits for ${GOLDEN[index]?.name ?? ''}`, async () => {
      expect(asPinned(GOLDEN[index]?.name ?? '', await analysed(index, wasm))).toEqual(
        GOLDEN[index],
      );
    }, 60_000);
  });
});
