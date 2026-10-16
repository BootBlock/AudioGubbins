import { describe, expect, it } from 'vitest';

import {
  DEFAULT_EMITTER_RULES,
  DEFAULT_VOICE_VARIATION,
  emitterRulesProblems,
  voiceVariationProblems,
  type EmitterRules,
  type VoiceVariation,
} from './playback-rules.js';

function emitterParts(rules: EmitterRules): readonly unknown[] {
  return emitterRulesProblems(rules).map((one) => {
    expect(one.code).toBe('game.emitter-invalid');
    return one.details?.['part'];
  });
}

function variationParts(variation: VoiceVariation): readonly unknown[] {
  return voiceVariationProblems(variation).map((one) => {
    expect(one.code).toBe('game.variation-invalid');
    return one.details?.['part'];
  });
}

const rolloff = {
  kind: 'inverse',
  unitSize: 1,
  maxDistance: 50,
  ceilingDecibels: 0,
} as const;

describe('emitter rules (ADR-0104)', () => {
  it('default to rules the policy takes: uniform, 8 voices stealing the oldest, no cooldown or attenuation', () => {
    expect(DEFAULT_EMITTER_RULES).toEqual({
      selection: { kind: 'uniform' },
      voices: { limit: 8, stealing: 'oldest' },
      cooldownMilliseconds: 0,
      attenuation: { kind: 'none' },
    });
    expect(emitterParts(DEFAULT_EMITTER_RULES)).toEqual([]);
  });

  it('take every value at the ends of its range', () => {
    for (const rules of [
      { ...DEFAULT_EMITTER_RULES, selection: { kind: 'avoid-recent', depth: 1 } },
      { ...DEFAULT_EMITTER_RULES, selection: { kind: 'avoid-recent', depth: 16 } },
      {
        ...DEFAULT_EMITTER_RULES,
        voices: { limit: 64, stealing: 'reject' },
        cooldownMilliseconds: 60_000,
      },
      { ...DEFAULT_EMITTER_RULES, attenuation: { ...rolloff, ceilingDecibels: -80 } },
      { ...DEFAULT_EMITTER_RULES, attenuation: { ...rolloff, ceilingDecibels: 24 } },
      {
        ...DEFAULT_EMITTER_RULES,
        attenuation: { kind: 'exponent', maxDistance: 1, exponent: 0.01 },
      },
      { ...DEFAULT_EMITTER_RULES, filter: { cutoffHertz: 20, decibels: -80 } },
      { ...DEFAULT_EMITTER_RULES, filter: { cutoffHertz: 20_000, decibels: 0 } },
    ] satisfies EmitterRules[]) {
      expect(emitterParts(rules)).toEqual([]);
    }
  });

  it('refuse each value past its range, naming the part', () => {
    expect(
      emitterParts({
        selection: { kind: 'avoid-recent', depth: 17 },
        voices: { limit: 0, stealing: 'oldest' },
        cooldownMilliseconds: 60_001,
        attenuation: { ...rolloff, unitSize: 0, maxDistance: -1, ceilingDecibels: 25 },
        filter: { cutoffHertz: 19, decibels: 1 },
      }),
    ).toEqual([
      'selection.depth',
      'voices.limit',
      'cooldownMilliseconds',
      'attenuation.unitSize',
      'attenuation.maxDistance',
      'attenuation.ceilingDecibels',
      'filter.cutoffHertz',
      'filter.decibels',
    ]);
    expect(
      emitterParts({
        ...DEFAULT_EMITTER_RULES,
        voices: { limit: 2.5, stealing: 'quietest' },
        attenuation: { kind: 'exponent', maxDistance: 1_000_001, exponent: 17 },
      }),
    ).toEqual(['voices.limit', 'attenuation.maxDistance', 'attenuation.exponent']);
  });

  it('take a maximum distance of 0 as no limit, as Godot and the spatial panner do', () => {
    for (const attenuation of [
      { ...rolloff, maxDistance: 0 },
      { ...rolloff, unitSize: 1_000_000, maxDistance: 0 },
      { kind: 'exponent', maxDistance: 0, exponent: 1 },
    ] satisfies EmitterRules['attenuation'][]) {
      expect(emitterParts({ ...DEFAULT_EMITTER_RULES, attenuation })).toEqual([]);
    }
  });

  it("hold a distance to the spatial panner's range: a unit size from 0.01, every distance at most 1,000,000", () => {
    expect(
      emitterParts({ ...DEFAULT_EMITTER_RULES, attenuation: { ...rolloff, unitSize: 0.01 } }),
    ).toEqual([]);
    expect(
      emitterParts({
        ...DEFAULT_EMITTER_RULES,
        attenuation: { ...rolloff, unitSize: 0.009, maxDistance: 0 },
      }),
    ).toEqual(['attenuation.unitSize']);
    expect(
      emitterParts({
        ...DEFAULT_EMITTER_RULES,
        attenuation: { ...rolloff, unitSize: 1_000_001, maxDistance: 0 },
      }),
    ).toEqual(['attenuation.unitSize']);
    expect(
      emitterParts({
        ...DEFAULT_EMITTER_RULES,
        attenuation: { ...rolloff, maxDistance: 1_000_000 },
      }),
    ).toEqual([]);
    expect(
      emitterParts({
        ...DEFAULT_EMITTER_RULES,
        attenuation: { ...rolloff, maxDistance: 1_000_001 },
      }),
    ).toEqual(['attenuation.maxDistance']);
  });

  it('refuse a silent distance no further than the unit size', () => {
    expect(
      emitterParts({
        ...DEFAULT_EMITTER_RULES,
        attenuation: { ...rolloff, unitSize: 10, maxDistance: 10 },
      }),
    ).toEqual(['attenuation.maxDistance']);
  });

  it('refuse a value that is no number at all', () => {
    expect(emitterParts({ ...DEFAULT_EMITTER_RULES, cooldownMilliseconds: Number.NaN })).toEqual([
      'cooldownMilliseconds',
    ]);
  });
});

describe('voice variation (ADR-0104)', () => {
  it('defaults to none, which the policy takes', () => {
    expect(DEFAULT_VOICE_VARIATION).toEqual({
      pitchCents: { min: 0, max: 0 },
      gainDecibels: { min: 0, max: 0 },
      startOffsetMilliseconds: { max: 0 },
    });
    expect(variationParts(DEFAULT_VOICE_VARIATION)).toEqual([]);
  });

  it('takes the widest ranges', () => {
    expect(
      variationParts({
        pitchCents: { min: -2_400, max: 2_400 },
        gainDecibels: { min: -60, max: 12 },
        startOffsetMilliseconds: { max: 10_000 },
      }),
    ).toEqual([]);
  });

  it('refuses a pitch range whose least passes its most', () => {
    expect(
      variationParts({ ...DEFAULT_VOICE_VARIATION, pitchCents: { min: 10, max: -10 } }),
    ).toEqual(['pitchCents']);
  });

  it('refuses a range past its ends, one whose least passes its most, and a pitch of part of a cent', () => {
    expect(
      variationParts({
        pitchCents: { min: -2_401, max: 0 },
        gainDecibels: { min: -60, max: 12.5 },
        startOffsetMilliseconds: { max: 10_001 },
      }),
    ).toEqual(['pitchCents', 'gainDecibels', 'startOffsetMilliseconds']);
    expect(
      variationParts({
        ...DEFAULT_VOICE_VARIATION,
        pitchCents: { min: 0.5, max: 1 },
        gainDecibels: { min: 3, max: -3 },
      }),
    ).toEqual(['pitchCents', 'gainDecibels']);
  });
});
