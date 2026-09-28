import { describe, expect, it } from 'vitest';

import { unsafeBrandId, type ParameterId, type ProcessorId } from '../identity/branded-id.js';
import type { SampleCount } from '../time/sample-time.js';
import { expectFailureCode, expectSuccess } from '../testing/unwrap.js';
import { ParameterTaper, type ParameterDescriptor } from './parameter.js';
import {
  type EffectChain,
  type ProcessorDescriptor,
  type ProcessorInstance,
  chainLatency,
  instantiateProcessor,
  processorsInSignalOrder,
  validateProcessorInstance,
} from './effect-chain.js';

const cutoffId = unsafeBrandId<'ParameterId'>('11111111-cutoff') as ParameterId;
const bypassId = unsafeBrandId<'ParameterId'>('11111111-bypass') as ParameterId;

const cutoff: ParameterDescriptor = {
  kind: 'numeric',
  id: cutoffId,
  key: 'cutoff-frequency',
  label: 'Cutoff frequency',
  minimum: 20,
  maximum: 20_000,
  defaultValue: 1_000,
  taper: ParameterTaper.Logarithmic,
  unit: 'Hz',
};

const gentle: ParameterDescriptor = {
  kind: 'toggle',
  id: bypassId,
  key: 'gentle-slope',
  label: 'Gentle slope',
  defaultValue: false,
};

const filter: ProcessorDescriptor = {
  typeKey: 'low-pass-filter',
  label: 'Low-pass filter',
  implementationVersion: 1,
  parameters: [cutoff, gentle],
  latency: 0 as SampleCount,
};

const lookAheadLimiter: ProcessorDescriptor = {
  typeKey: 'look-ahead-limiter',
  label: 'Look-ahead limiter',
  implementationVersion: 1,
  parameters: [],
  latency: 480 as SampleCount,
};

const descriptors = new Map([
  [filter.typeKey, filter],
  [lookAheadLimiter.typeKey, lookAheadLimiter],
]);

function processorId(suffix: string): ProcessorId {
  return unsafeBrandId<'ProcessorId'>(`22222222-${suffix}`);
}

function chain(...processors: ProcessorInstance[]): EffectChain {
  return { id: unsafeBrandId<'EffectChainId'>('33333333-chain'), processors };
}

describe('instantiateProcessor', () => {
  it('starts every parameter at its declared default', () => {
    const instance = instantiateProcessor(processorId('aaaa'), filter);
    expect(instance.values.get(cutoffId)).toBe(1_000);
    expect(instance.values.get(bypassId)).toBe(false);
  });

  it('starts enabled and not soloed', () => {
    const instance = instantiateProcessor(processorId('aaaa'), filter);
    expect(instance.enabled).toBe(true);
    expect(instance.soloed).toBe(false);
  });
});

describe('processorsInSignalOrder', () => {
  it('keeps enabled processors in the order they were placed', () => {
    const first = instantiateProcessor(processorId('aaaa'), filter);
    const second = instantiateProcessor(processorId('bbbb'), lookAheadLimiter);
    expect(processorsInSignalOrder(chain(first, second)).map((p) => p.id)).toEqual([
      first.id,
      second.id,
    ]);
  });

  it('omits a disabled processor', () => {
    const enabled = instantiateProcessor(processorId('aaaa'), filter);
    const disabled = { ...instantiateProcessor(processorId('bbbb'), filter), enabled: false };
    expect(processorsInSignalOrder(chain(enabled, disabled))).toEqual([enabled]);
  });

  it('hears only the soloed processor, without needing the rest disabled', () => {
    const ordinary = instantiateProcessor(processorId('aaaa'), filter);
    const soloed = { ...instantiateProcessor(processorId('bbbb'), filter), soloed: true };
    expect(processorsInSignalOrder(chain(ordinary, soloed))).toEqual([soloed]);
  });

  it('hears a soloed processor even when it is disabled, because solo is the stronger intent', () => {
    const soloedButDisabled = {
      ...instantiateProcessor(processorId('aaaa'), filter),
      soloed: true,
      enabled: false,
    };
    expect(processorsInSignalOrder(chain(soloedButDisabled))).toEqual([soloedButDisabled]);
  });

  it('produces nothing for an empty chain', () => {
    expect(processorsInSignalOrder(chain())).toEqual([]);
  });
});

describe('chainLatency', () => {
  it('reports zero for an empty chain', () => {
    expect(expectSuccess(chainLatency(chain(), descriptors))).toBe(0);
  });

  it('sums the latency of every applied processor', () => {
    const one = instantiateProcessor(processorId('aaaa'), lookAheadLimiter);
    const two = instantiateProcessor(processorId('bbbb'), lookAheadLimiter);
    expect(expectSuccess(chainLatency(chain(one, two), descriptors))).toBe(960);
  });

  it('excludes a bypassed processor, which delays nothing', () => {
    const active = instantiateProcessor(processorId('aaaa'), lookAheadLimiter);
    const bypassed = {
      ...instantiateProcessor(processorId('bbbb'), lookAheadLimiter),
      enabled: false,
    };
    expect(expectSuccess(chainLatency(chain(active, bypassed), descriptors))).toBe(480);
  });

  it('counts only the soloed processor when one is soloed', () => {
    // Each way round, so a total of every processor, of none, or of the ones
    // not soloed, each gives a wrong answer to one of the two.
    const limiter = instantiateProcessor(processorId('aaaa'), lookAheadLimiter);
    const soloedFilter = { ...instantiateProcessor(processorId('bbbb'), filter), soloed: true };
    expect(expectSuccess(chainLatency(chain(limiter, soloedFilter), descriptors))).toBe(0);

    const plainFilter = instantiateProcessor(processorId('cccc'), filter);
    const soloedLimiter = {
      ...instantiateProcessor(processorId('dddd'), lookAheadLimiter),
      soloed: true,
    };
    expect(expectSuccess(chainLatency(chain(plainFilter, soloedLimiter), descriptors))).toBe(480);
  });

  it('refuses to guess the latency of a processor type it does not know', () => {
    const unknown: ProcessorInstance = {
      id: processorId('cccc'),
      typeKey: 'processor-from-a-later-version',
      enabled: true,
      soloed: false,
      values: new Map(),
    };
    expect(expectFailureCode(chainLatency(chain(unknown), descriptors))).toBe(
      'effect-chain.unknown-processor-type',
    );
  });
});

describe('validateProcessorInstance', () => {
  it('accepts an instance built from its own descriptor', () => {
    const instance = instantiateProcessor(processorId('aaaa'), filter);
    expect(expectSuccess(validateProcessorInstance(instance, filter))).toHaveLength(2);
  });

  it('rejects an instance checked against a descriptor for another type', () => {
    const instance = instantiateProcessor(processorId('aaaa'), filter);
    expect(expectFailureCode(validateProcessorInstance(instance, lookAheadLimiter))).toBe(
      'effect-chain.descriptor-mismatch',
    );
  });

  it('reports a parameter the instance has no value for', () => {
    const instance = instantiateProcessor(processorId('aaaa'), filter);
    const missing: ProcessorInstance = {
      ...instance,
      values: new Map([[cutoffId, 1_000]]),
    };
    expect(expectFailureCode(validateProcessorInstance(missing, filter))).toBe(
      'effect-chain.missing-parameter-value',
    );
  });

  it('reports a value for a parameter the descriptor does not declare', () => {
    const instance = instantiateProcessor(processorId('aaaa'), filter);
    const extra: ProcessorInstance = {
      ...instance,
      values: new Map([...instance.values, [unsafeBrandId<'ParameterId'>('11111111-ghost'), 1]]),
    };
    expect(expectFailureCode(validateProcessorInstance(extra, filter))).toBe(
      'effect-chain.unexpected-parameter-value',
    );
  });

  it('reports every problem at once rather than only the first', () => {
    const broken: ProcessorInstance = {
      id: processorId('aaaa'),
      typeKey: filter.typeKey,
      enabled: true,
      soloed: false,
      values: new Map([[cutoffId, 999_999]]),
    };
    const failures = validateProcessorInstance(broken, filter);
    expect(failures.ok).toBe(false);
    if (!failures.ok) {
      expect(failures.failures.map((problem) => problem.code)).toEqual([
        'parameter.out-of-range',
        'effect-chain.missing-parameter-value',
      ]);
    }
  });
});
