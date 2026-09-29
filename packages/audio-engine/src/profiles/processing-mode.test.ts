import { describe, expect, it } from 'vitest';

import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';

import {
  PerformanceProfile,
  PRESET_SETTINGS,
  PRESETS_BY_STABILITY,
  settingsFor,
  type PerformanceSettings,
} from './performance-profile.js';
import {
  ProcessingMode,
  ProcessingPurpose,
  availableProcessingModes,
  selectProcessingMode,
  type ProcessingModeRequest,
} from './processing-mode.js';
import type { ResourceWarning } from '../scheduling/workload.js';

const BALANCED = PRESET_SETTINGS[PerformanceProfile.Balanced];
const LOW_LATENCY = PRESET_SETTINGS[PerformanceProfile.LowLatency];
const STABLE = PRESET_SETTINGS[PerformanceProfile.MaximumStability];
const PURPOSES = Object.values(ProcessingPurpose);

function select(request: ProcessingModeRequest) {
  return expectSuccess(selectProcessingMode(request));
}

describe('the modes each purpose may use', () => {
  it('offers live and cached listening for monitoring and preview', () => {
    for (const purpose of [ProcessingPurpose.Monitor, ProcessingPurpose.Preview]) {
      expect(availableProcessingModes(purpose)).toEqual([
        ProcessingMode.RealTime,
        ProcessingMode.CachedPreview,
      ]);
    }
  });

  it('offers only offline modes for analysis and for a final render, which stays canonical', () => {
    expect(availableProcessingModes(ProcessingPurpose.Analysis)).toEqual([
      ProcessingMode.BackgroundOffline,
      ProcessingMode.FinalOffline,
    ]);
    expect(availableProcessingModes(ProcessingPurpose.FinalRender)).toEqual([
      ProcessingMode.FinalOffline,
      ProcessingMode.BackgroundOffline,
    ]);
  });
});

/** A host with no cache to play from, as this build is. */
const NO_CACHE = new Map([
  [ProcessingMode.CachedPreview, 'Nothing renders a preview ahead of playback yet.'],
]);

/** What planning says of a render measured slower than real time. */
const SLOW_PROCESSOR: ResourceWarning = {
  resource: 'compute',
  needed: 20,
  available: 10,
  explanation: 'The processor is the limiting resource.',
  saferStrategy: 'Run it in the background.',
};

describe('a host that cannot run every mode', () => {
  it('plays live while unmeasured, and says a cached preview is not available rather than promising one', () => {
    const choice = select({
      purpose: ProcessingPurpose.Monitor,
      settings: BALANCED,
      unavailable: NO_CACHE,
    });
    expect(choice.mode).toBe(ProcessingMode.RealTime);
    expect(choice.reason).toBe(
      'Playing live. The processing has not been measured yet, and a cached preview is not ' +
        'available: Nothing renders a preview ahead of playback yet.',
    );
  });

  it('plays live over too little headroom, warning it may drop out, where there is no cache', () => {
    const choice = select({
      purpose: ProcessingPurpose.Monitor,
      settings: BALANCED,
      measuredCostRatio: 0.9,
      unavailable: NO_CACHE,
    });
    expect(choice).toMatchObject({ mode: ProcessingMode.RealTime, overridden: false });
    expect(choice.reason).toMatch(/^Playing live, which may drop out\. /);
    expect(choice.reason).toContain('A cached preview is not available');
  });

  it('refuses an override the host cannot run, keeping the automatic choice, and says why', () => {
    const choice = select({
      purpose: ProcessingPurpose.Preview,
      settings: BALANCED,
      override: ProcessingMode.CachedPreview,
      unavailable: NO_CACHE,
    });
    expect(choice.mode).toBe(ProcessingMode.RealTime);
    expect(choice.overridden).toBe(false);
    expect(choice.reason).toMatch(
      /^A cached preview is not available, so that choice was not applied: Nothing renders/,
    );
  });
});

describe('a final render and the processor', () => {
  it('moves into the background where the processor is the limiting resource', () => {
    const choice = select({
      purpose: ProcessingPurpose.FinalRender,
      settings: BALANCED,
      warnings: [SLOW_PROCESSOR],
    });
    expect(choice).toMatchObject({ mode: ProcessingMode.BackgroundOffline, overridden: false });
    expect(choice.reason).toContain('identical on every machine either way');
    expect(choice.reason).toContain('The processor is the limiting resource.');
  });

  it('stays in the foreground where only memory was warned of, since chunking answers that', () => {
    const choice = select({
      purpose: ProcessingPurpose.FinalRender,
      settings: BALANCED,
      warnings: [{ ...SLOW_PROCESSOR, resource: 'memory' }],
    });
    expect(choice.mode).toBe(ProcessingMode.FinalOffline);
  });

  it('honours the foreground when chosen over the warning, and says what it holds up', () => {
    const choice = select({
      purpose: ProcessingPurpose.FinalRender,
      settings: BALANCED,
      warnings: [SLOW_PROCESSOR],
      override: ProcessingMode.FinalOffline,
    });
    expect(choice).toMatchObject({ mode: ProcessingMode.FinalOffline, overridden: true });
    expect(choice.reason).toBe(
      'Using final offline rendering, as chosen. It holds up playback and editing while it runs. ' +
        'The processor is the limiting resource.',
    );
  });

  it('renders in the background when chosen, whatever the measurement', () => {
    const choice = select({
      purpose: ProcessingPurpose.FinalRender,
      settings: BALANCED,
      override: ProcessingMode.BackgroundOffline,
    });
    expect(choice).toEqual({
      mode: ProcessingMode.BackgroundOffline,
      reason: 'Using background rendering, as chosen.',
      overridden: true,
    });
  });
});

describe('performance profiles and feature availability', () => {
  const everyProfile: readonly PerformanceSettings[] = [
    ...PRESETS_BY_STABILITY.map((preset) => expectSuccess(settingsFor(preset))),
    expectSuccess(
      settingsFor(PerformanceProfile.Custom, {
        latencyHint: 0.005,
        feedAheadMilliseconds: 10,
        backgroundConcurrencyWhileInteractive: 1,
        renderChunkMilliseconds: 10,
      }),
    ),
  ];

  it.each([undefined, 0.1, 0.6, 0.8, 3])(
    'reaches the same set of modes under every profile, at a measured cost of %s',
    (measuredCostRatio) => {
      for (const purpose of PURPOSES) {
        const reachable = everyProfile.map((settings) =>
          [undefined, ...Object.values(ProcessingMode)]
            .map((override) => {
              const choice = select({
                purpose,
                settings,
                ...(measuredCostRatio === undefined ? {} : { measuredCostRatio }),
                ...(override === undefined ? {} : { override }),
              });
              return choice.mode;
            })
            .filter((mode, index, all) => all.indexOf(mode) === index)
            .sort(),
        );
        for (const modes of reachable) {
          expect(modes).toEqual([...availableProcessingModes(purpose)].sort());
        }
      }
    },
  );
});

describe('choosing a mode automatically', () => {
  it('plays live while the processing is unmeasured', () => {
    const choice = select({ purpose: ProcessingPurpose.Monitor, settings: LOW_LATENCY });
    expect(choice).toMatchObject({ mode: ProcessingMode.RealTime, overridden: false });
    expect(choice.reason).toContain('has not been measured yet');
  });

  it('plays live when the measured cost is within the profile headroom', () => {
    const choice = select({
      purpose: ProcessingPurpose.Preview,
      settings: BALANCED,
      measuredCostRatio: 0.7,
    });
    expect(choice.mode).toBe(ProcessingMode.RealTime);
    expect(choice.reason).toContain('takes 70% of real time, within the 70%');
  });

  it('falls back to a cached preview when the cost leaves too little headroom', () => {
    const choice = select({
      purpose: ProcessingPurpose.Monitor,
      settings: BALANCED,
      measuredCostRatio: 0.71,
    });
    expect(choice.mode).toBe(ProcessingMode.CachedPreview);
    expect(choice.reason).toContain('more than the 70% this profile allows');
  });

  it('asks for more headroom the lower the latency', () => {
    const at = (settings: PerformanceSettings) =>
      select({ purpose: ProcessingPurpose.Monitor, settings, measuredCostRatio: 0.6 }).mode;
    expect(at(LOW_LATENCY)).toBe(ProcessingMode.CachedPreview);
    expect(at(BALANCED)).toBe(ProcessingMode.RealTime);
    expect(at(STABLE)).toBe(ProcessingMode.RealTime);
    expect(
      select({ purpose: ProcessingPurpose.Monitor, settings: STABLE, measuredCostRatio: 0.8 }).mode,
    ).toBe(ProcessingMode.RealTime);
    expect(
      select({ purpose: ProcessingPurpose.Monitor, settings: BALANCED, measuredCostRatio: 0.8 })
        .mode,
    ).toBe(ProcessingMode.CachedPreview);
  });

  it.each([
    [0.01, 0.4, ProcessingMode.RealTime],
    [0.01, 0.55, ProcessingMode.CachedPreview],
    [0.05, 0.65, ProcessingMode.RealTime],
    [0.05, 0.75, ProcessingMode.CachedPreview],
    [0.25, 0.8, ProcessingMode.RealTime],
    [0.25, 0.9, ProcessingMode.CachedPreview],
  ])(
    'places a latency hint of %s s by the buffer it asks for (cost %s)',
    (latencyHint, cost, mode) => {
      const settings = { ...BALANCED, latencyHint };
      expect(
        select({ purpose: ProcessingPurpose.Monitor, settings, measuredCostRatio: cost }).mode,
      ).toBe(mode);
    },
  );

  it('analyses in the background, whatever the cost', () => {
    const choice = select({
      purpose: ProcessingPurpose.Analysis,
      settings: BALANCED,
      measuredCostRatio: 0.01,
    });
    expect(choice.mode).toBe(ProcessingMode.BackgroundOffline);
    expect(choice.reason).toContain('in the background');
  });

  it('renders a final render offline, even when real time would keep up', () => {
    const choice = select({
      purpose: ProcessingPurpose.FinalRender,
      settings: BALANCED,
      measuredCostRatio: 0.01,
    });
    expect(choice.mode).toBe(ProcessingMode.FinalOffline);
    expect(choice.reason).toContain('identical on every machine');
  });

  it.each([-0.1, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses a measured cost of %s',
    (measuredCostRatio) => {
      expect(
        expectFailureCode(
          selectProcessingMode({
            purpose: ProcessingPurpose.Monitor,
            settings: BALANCED,
            measuredCostRatio,
          }),
        ),
      ).toBe('processing-mode.cost-ratio-invalid');
    },
  );
});

describe('overriding the mode', () => {
  it('honours an available override and says it was chosen', () => {
    const choice = select({
      purpose: ProcessingPurpose.Monitor,
      settings: BALANCED,
      override: ProcessingMode.CachedPreview,
    });
    expect(choice).toEqual({
      mode: ProcessingMode.CachedPreview,
      reason: 'Using a cached preview, as chosen.',
      overridden: true,
    });
  });

  it('honours real time against the measurement, and warns it may drop out', () => {
    const choice = select({
      purpose: ProcessingPurpose.Monitor,
      settings: LOW_LATENCY,
      measuredCostRatio: 0.9,
      override: ProcessingMode.RealTime,
    });
    expect(choice.mode).toBe(ProcessingMode.RealTime);
    expect(choice.overridden).toBe(true);
    expect(choice.reason).toContain('It may drop out');
  });

  it('refuses real time for a final render, keeping it canonical, and says why', () => {
    const choice = select({
      purpose: ProcessingPurpose.FinalRender,
      settings: BALANCED,
      override: ProcessingMode.RealTime,
    });
    expect(choice.mode).toBe(ProcessingMode.FinalOffline);
    expect(choice.overridden).toBe(false);
    expect(choice.reason).toMatch(
      /^A final render always runs offline, so the file is canonical; real-time processing was not used\./,
    );
  });

  it('refuses a mode the purpose cannot use, keeping the automatic choice', () => {
    const choice = select({
      purpose: ProcessingPurpose.Analysis,
      settings: BALANCED,
      override: ProcessingMode.CachedPreview,
    });
    expect(choice.mode).toBe(ProcessingMode.BackgroundOffline);
    expect(choice.overridden).toBe(false);
    expect(choice.reason).toMatch(/^This work cannot use a cached preview/);
  });

  it('lets analysis run at final quality when chosen', () => {
    const choice = select({
      purpose: ProcessingPurpose.Analysis,
      settings: BALANCED,
      override: ProcessingMode.FinalOffline,
    });
    expect(choice).toMatchObject({ mode: ProcessingMode.FinalOffline, overridden: true });
  });
});
