import { describe, expect, it } from 'vitest';

import { unsafeBrandId, type ProcessorId } from '../identity/branded-id.js';
import { sampleRate } from '../time/sample-time.js';
import {
  CUTOFF,
  GENTLE,
  LOOK_AHEAD,
  TEST_CATALOGUE,
  TEST_DENOISER,
  TEST_FILTER,
  TEST_LIMITER,
} from '../testing/test-processors.js';
import { expectFailureCode, expectSuccess } from '../testing/unwrap.js';
import {
  type ChainSettings,
  type ChainSlot,
  type ParallelGroup,
  type ProcessorInstance,
  SummingLaw,
  appliedSlots,
  chainLatency,
  instantiateProcessor,
  processorsOf,
  summingFactor,
  validateProcessorInstance,
} from './effect-chain.js';
import { MAXIMUM_QUALITY } from './quality-mode.js';

const SETTINGS: ChainSettings = {
  sampleRate: expectSuccess(sampleRate(48_000)),
  quality: MAXIMUM_QUALITY.settings,
};

/** A latency known to be `frames` frames. */
function known(frames: number) {
  return { kind: 'known', frames };
}

function processorId(suffix: string): ProcessorId {
  return unsafeBrandId<'ProcessorId'>(`22222222-${suffix}`);
}

function limiter(suffix: string, lookAhead = 480): ProcessorInstance {
  const made = instantiateProcessor(processorId(suffix), TEST_LIMITER);
  return { ...made, values: new Map([[LOOK_AHEAD, lookAhead]]) };
}

function group(suffix: string, ...branches: (readonly ChainSlot[])[]): ParallelGroup {
  return {
    kind: 'group',
    id: unsafeBrandId<'ProcessorGroupId'>(`44444444-${suffix}`),
    enabled: true,
    soloed: false,
    mix: 1,
    summing: SummingLaw.Sum,
    branches: branches.map((slots) => ({ slots })),
  };
}

function latencyOf(...slots: ChainSlot[]) {
  return expectSuccess(chainLatency({ slots }, TEST_CATALOGUE, SETTINGS));
}

describe('instantiateProcessor', () => {
  it('starts every parameter at its declared default, applied fully, stamped with its versions', () => {
    const instance = instantiateProcessor(processorId('aaaa'), TEST_FILTER);
    expect(instance.values.get(CUTOFF)).toBe(1_000);
    expect(instance.values.get(GENTLE)).toBe(false);
    expect(instance).toMatchObject({ enabled: true, soloed: false, mix: 1 });
    expect(instance.version).toEqual(TEST_FILTER.version);
  });
});

describe('appliedSlots', () => {
  it('keeps the enabled slots in the order they were placed', () => {
    const first = instantiateProcessor(processorId('aaaa'), TEST_FILTER);
    const off = { ...instantiateProcessor(processorId('bbbb'), TEST_FILTER), enabled: false };
    const last = limiter('cccc');
    expect(appliedSlots([first, off, last])).toEqual([first, last]);
  });

  it('hears only the soloed slots, even a bypassed one, without the rest bypassed by hand', () => {
    const ordinary = instantiateProcessor(processorId('aaaa'), TEST_FILTER);
    const soloed = { ...limiter('bbbb'), soloed: true, enabled: false };
    expect(appliedSlots([ordinary, soloed])).toEqual([soloed]);
  });

  it('decides solo within each list, so a solo inside a group leaves the chain around it applied', () => {
    const inner = { ...limiter('aaaa'), soloed: true };
    const sibling = limiter('bbbb');
    const outer = instantiateProcessor(processorId('cccc'), TEST_FILTER);
    const parallel = group('dddd', [inner, sibling]);
    expect(appliedSlots([outer, parallel])).toEqual([outer, parallel]);
    expect(appliedSlots(parallel.branches[0]?.slots ?? [])).toEqual([inner]);
  });
});

describe('processorsOf', () => {
  it('lists every processor depth first, inside groups too, applied or not', () => {
    const one = limiter('aaaa');
    const two = { ...limiter('bbbb'), enabled: false };
    const three = limiter('cccc');
    expect([...processorsOf([one, group('dddd', [two], [three])])].map((each) => each.id)).toEqual([
      one.id,
      two.id,
      three.id,
    ]);
  });
});

describe('summingFactor', () => {
  it('states each law as a factor of the branches’ sum', () => {
    expect(summingFactor(SummingLaw.Sum, 4)).toBe(1);
    expect(summingFactor(SummingLaw.Mean, 4)).toBe(0.25);
    expect(summingFactor(SummingLaw.EqualPower, 4)).toBe(0.5);
  });
});

describe('chainLatency', () => {
  it('reports zero for an empty chain', () => {
    expect(latencyOf()).toEqual(known(0));
  });

  it('sums the latency each applied processor states for its own settings', () => {
    expect(latencyOf(limiter('aaaa', 100), limiter('bbbb', 380))).toEqual(known(480));
  });

  it('leaves out a bypassed processor, which delays nothing', () => {
    expect(latencyOf(limiter('aaaa'), { ...limiter('bbbb'), enabled: false })).toEqual(known(480));
  });

  it('counts only the soloed processor when one is soloed', () => {
    // Each way round, so a total of every processor, of none, or of the ones
    // not soloed, gives a wrong answer to one of the two.
    const filter = instantiateProcessor(processorId('bbbb'), TEST_FILTER);
    expect(latencyOf(limiter('aaaa'), { ...filter, soloed: true })).toEqual(known(0));
    expect(latencyOf(filter, { ...limiter('cccc'), soloed: true })).toEqual(known(480));
  });

  it('takes a group’s longest branch, since the shorter are delayed to meet it', () => {
    const parallel = group(
      'eeee',
      [limiter('aaaa', 100)],
      [limiter('bbbb', 300), limiter('cccc', 50)],
      [],
    );
    expect(latencyOf(limiter('dddd', 10), parallel)).toEqual(known(360));
  });

  it('adds nothing for a mix of dry and wet, since the dry input is delayed to the wet output', () => {
    expect(latencyOf({ ...limiter('aaaa', 200), mix: 0.5 })).toEqual(known(200));
  });

  it('is unknown, naming each processor and its reason, where an applied one cannot say its own', () => {
    // A total that left the unknown processor out would be a number the engine
    // compensated by, and wrongly (REQ-ARCH-144).
    const first = instantiateProcessor(processorId('bbbb'), TEST_DENOISER);
    const second = instantiateProcessor(processorId('cccc'), TEST_DENOISER);
    expect(latencyOf(limiter('aaaa'), group('dddd', [first], [second]))).toEqual({
      kind: 'unknown',
      reason:
        'the latency of processor 22222222-bbbb (adaptive-denoiser) is not known: its look-ahead follows the material; the latency of processor 22222222-cccc (adaptive-denoiser) is not known: its look-ahead follows the material',
    });
  });

  it('is known where the processor that cannot say its latency is bypassed', () => {
    const bypassed = {
      ...instantiateProcessor(processorId('bbbb'), TEST_DENOISER),
      enabled: false,
    };
    expect(latencyOf(limiter('aaaa'), bypassed)).toEqual(known(480));
  });

  it('refuses to guess the latency of a processor type it does not know', () => {
    const unknown = { ...limiter('cccc'), typeKey: 'processor-from-a-later-version' };
    expect(expectFailureCode(chainLatency({ slots: [unknown] }, TEST_CATALOGUE, SETTINGS))).toBe(
      'effect-chain.unknown-processor-type',
    );
  });
});

describe('validateProcessorInstance', () => {
  it('accepts an instance built from its own descriptor', () => {
    const instance = instantiateProcessor(processorId('aaaa'), TEST_FILTER);
    expect(expectSuccess(validateProcessorInstance(instance, TEST_FILTER))).toHaveLength(2);
  });

  it('rejects an instance checked against a descriptor for another type', () => {
    const instance = instantiateProcessor(processorId('aaaa'), TEST_FILTER);
    expect(expectFailureCode(validateProcessorInstance(instance, TEST_LIMITER))).toBe(
      'effect-chain.descriptor-mismatch',
    );
  });

  it('refuses an instance saved by an implementation or parameter schema this build does not have', () => {
    const instance = instantiateProcessor(processorId('aaaa'), TEST_FILTER);
    for (const version of [
      { implementation: 2, parameters: 1 },
      { implementation: 1, parameters: 2 },
      { implementation: 1, parameters: 1, resampler: 1 },
    ]) {
      expect(
        expectFailureCode(validateProcessorInstance({ ...instance, version }, TEST_FILTER)),
      ).toBe('processor.version-unknown');
    }
  });

  it('reports every parameter problem at once rather than only the first', () => {
    const instance = instantiateProcessor(processorId('aaaa'), TEST_FILTER);
    const broken = {
      ...instance,
      values: new Map([
        [CUTOFF, 999_999],
        [unsafeBrandId<'ParameterId'>('11111111-ghost'), 1],
      ]),
    };
    const failures = validateProcessorInstance(broken, TEST_FILTER);
    expect(failures.ok).toBe(false);
    if (!failures.ok) {
      expect(failures.failures.map((problem) => problem.code)).toEqual([
        'parameter.out-of-range',
        'effect-chain.missing-parameter-value',
        'effect-chain.unexpected-parameter-value',
      ]);
    }
  });
});
