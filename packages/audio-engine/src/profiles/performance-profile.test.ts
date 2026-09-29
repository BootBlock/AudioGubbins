import { describe, expect, it } from 'vitest';

import type { DomainResult } from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';

import {
  PerformanceProfile,
  PRESET_SETTINGS,
  PRESETS_BY_STABILITY,
  settingsFor,
  validatePerformanceSettings,
  type PerformanceSettings,
} from './performance-profile.js';

const CUSTOM: PerformanceSettings = {
  latencyHint: 0.03,
  feedAheadMilliseconds: 300,
  backgroundConcurrencyWhileInteractive: 3,
  renderChunkMilliseconds: 250,
};

describe('the performance presets', () => {
  it('gives each preset its own settings', () => {
    for (const preset of PRESETS_BY_STABILITY) {
      expect(expectSuccess(settingsFor(preset))).toBe(PRESET_SETTINGS[preset]);
    }
  });

  it('orders the presets so each keeps its feed further ahead than the last', () => {
    const feeds = PRESETS_BY_STABILITY.map(
      (preset) => PRESET_SETTINGS[preset].feedAheadMilliseconds,
    );
    expect(feeds).toEqual([...feeds].sort((a, b) => a - b));
    expect(new Set(feeds).size).toBe(feeds.length);
  });

  it('holds only buffering and scheduling settings, with nothing to switch a feature off', () => {
    const allowed = [
      'backgroundConcurrencyWhileInteractive',
      'feedAheadMilliseconds',
      'latencyHint',
      'renderChunkMilliseconds',
    ];
    for (const preset of PRESETS_BY_STABILITY) {
      expect(Object.keys(expectSuccess(settingsFor(preset))).sort()).toEqual(allowed);
    }
    expect(
      Object.keys(expectSuccess(settingsFor(PerformanceProfile.Custom, CUSTOM))).sort(),
    ).toEqual(allowed);
  });

  it('passes every preset through its own validation', () => {
    for (const preset of PRESETS_BY_STABILITY) {
      expect(validatePerformanceSettings(PRESET_SETTINGS[preset]).ok).toBe(true);
    }
  });
});

describe('custom performance settings', () => {
  it('accepts valid custom settings, including a latency hint in seconds', () => {
    expect(expectSuccess(settingsFor(PerformanceProfile.Custom, CUSTOM))).toEqual(CUSTOM);
  });

  it('accepts a named latency hint', () => {
    const named = { ...CUSTOM, latencyHint: 'playback' as const };
    expect(expectSuccess(settingsFor(PerformanceProfile.Custom, named)).latencyHint).toBe(
      'playback',
    );
  });

  it('refuses the Custom profile without settings', () => {
    // Stored settings read back without their custom half, which the overloads cannot see.
    const untyped = settingsFor as (
      profile: PerformanceProfile,
    ) => DomainResult<PerformanceSettings>;
    expect(expectFailureCode(untyped(PerformanceProfile.Custom))).toBe(
      'performance-settings.custom-missing',
    );
  });

  it.each([
    ['latencyHint', 0, 'performance-settings.latencyHint-not-positive'],
    ['latencyHint', -0.01, 'performance-settings.latencyHint-not-positive'],
    ['latencyHint', Number.NaN, 'performance-settings.latencyHint-not-positive'],
    ['feedAheadMilliseconds', 0, 'performance-settings.feedAheadMilliseconds-not-positive'],
    ['feedAheadMilliseconds', Infinity, 'performance-settings.feedAheadMilliseconds-not-positive'],
    ['renderChunkMilliseconds', -5, 'performance-settings.renderChunkMilliseconds-not-positive'],
    [
      'renderChunkMilliseconds',
      Number.NaN,
      'performance-settings.renderChunkMilliseconds-not-positive',
    ],
    [
      'backgroundConcurrencyWhileInteractive',
      0,
      'performance-settings.backgroundConcurrencyWhileInteractive-not-positive-whole',
    ],
    [
      'backgroundConcurrencyWhileInteractive',
      1.5,
      'performance-settings.backgroundConcurrencyWhileInteractive-not-positive-whole',
    ],
  ] as const)('refuses %s of %s', (field, value, code) => {
    const result = settingsFor(PerformanceProfile.Custom, { ...CUSTOM, [field]: value });
    expect(expectFailureCode(result)).toBe(code);
  });

  it('reports every problem at once, naming the value given', () => {
    const result = validatePerformanceSettings({
      latencyHint: -1,
      feedAheadMilliseconds: 0,
      backgroundConcurrencyWhileInteractive: 0,
      renderChunkMilliseconds: Number.POSITIVE_INFINITY,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures.map((problem) => problem.code)).toEqual([
      'performance-settings.latencyHint-not-positive',
      'performance-settings.feedAheadMilliseconds-not-positive',
      'performance-settings.backgroundConcurrencyWhileInteractive-not-positive-whole',
      'performance-settings.renderChunkMilliseconds-not-positive',
    ]);
    expect(result.failures[0].summary).toContain('-1');
  });
});
