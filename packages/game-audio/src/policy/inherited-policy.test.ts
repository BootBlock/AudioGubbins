import { describe, expect, it } from 'vitest';

import type { EffectChainId } from '@audiogubbins/domain';

import { withOverride, withPolicyField } from './inherited-policy.js';
import { DEFAULT_VOICE_VARIATION } from './playback-rules.js';

const chain = 'chain-a' as EffectChainId;
const loud = { integratedLufs: -16, toleranceLu: 1 };

describe('setting and resetting a policy field (ADR-0101)', () => {
  it('sets one field of a group, leaving the others and the policy it was given', () => {
    const before = { tags: ['ui'] };
    const after = withPolicyField(before, 'processing', chain);

    expect(after).toEqual({ tags: ['ui'], processing: chain });
    expect(before).toEqual({ tags: ['ui'] });
  });

  it('resets a field by removing it, so nothing is left to hide what is inherited', () => {
    const after = withPolicyField({ processing: chain, loudness: loud }, 'processing', undefined);

    expect(after).toEqual({ loudness: loud });
    expect('processing' in after).toBe(false);
  });

  it('sets and resets a member’s override the same way', () => {
    const set = withOverride({ loudness: loud }, 'variation', DEFAULT_VOICE_VARIATION);
    expect(set).toEqual({ loudness: loud, variation: DEFAULT_VOICE_VARIATION });

    const reset = withOverride(set, 'loudness', undefined);
    expect(reset).toEqual({ variation: DEFAULT_VOICE_VARIATION });
    expect('loudness' in reset).toBe(false);
  });
});
