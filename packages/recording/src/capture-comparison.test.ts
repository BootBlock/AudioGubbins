import { describe, expect, it } from 'vitest';

import { sampleRate, type DomainResult } from '@audiogubbins/domain';

import { compareCapture } from './capture-comparison.js';
import {
  PROFILE_NAME_CHARACTERS,
  RAW_STUDIO_PROFILE,
  VOICE_PROFILE,
  capturePlan,
  customProfile,
  processingOf,
  withHeadphones,
  type CaptureOffer,
  type ProcessingChoice,
} from './capture-profile.js';

function valueOf<T>(result: DomainResult<T>): T {
  if (!result.ok) throw new Error(result.failures[0].summary);
  return result.value;
}

const RATE = valueOf(sampleRate(48_000));

const EVERYTHING: CaptureOffer = {
  supported: new Set([
    'echoCancellation',
    'noiseSuppression',
    'autoGainControl',
    'voiceIsolation',
    'channelCount',
    'sampleRate',
  ]),
  channelCount: 2,
  contextRate: RATE,
};

const ALL_OFF = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  voiceIsolation: false,
};

describe('capture profiles (REQ-REC-092)', () => {
  it('asks Raw/Studio for every processing control off, and Voice for every one on', () => {
    expect(capturePlan(RAW_STUDIO_PROFILE, EVERYTHING).request).toEqual({
      processing: ALL_OFF,
      channelCount: 2,
      sampleRate: 48_000,
    });
    expect(capturePlan(VOICE_PROFILE, EVERYTHING).request.processing).toEqual({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      voiceIsolation: true,
    });
  });

  it('asks a custom profile for what the person set', () => {
    const choice: ProcessingChoice = { ...ALL_OFF, noiseSuppression: true };
    const custom = valueOf(customProfile('  Podcast  ', choice, true));
    expect(custom).toEqual({
      kind: 'custom',
      name: 'Podcast',
      headphones: true,
      processing: choice,
    });
    expect(capturePlan(custom, EVERYTHING).request.processing).toEqual(choice);
  });

  it('refuses a custom profile with no name, or a name too long to show', () => {
    expect(customProfile('   ', ALL_OFF, false)).toMatchObject({
      ok: false,
      failures: [{ code: 'recording.profile-name-blank' }],
    });
    expect(customProfile('x'.repeat(PROFILE_NAME_CHARACTERS + 1), ALL_OFF, false)).toMatchObject({
      ok: false,
      failures: [{ code: 'recording.profile-name-too-long' }],
    });
  });

  it('asks only for what the browser supports, and names what it cannot control', () => {
    const plan = capturePlan(RAW_STUDIO_PROFILE, {
      supported: new Set(['echoCancellation', 'autoGainControl']),
      channelCount: 2,
      contextRate: RATE,
    });
    expect(plan.request).toEqual({
      processing: { echoCancellation: false, autoGainControl: false },
    });
    expect(plan.uncontrollable).toEqual(['noiseSuppression', 'voiceIsolation']);
  });

  it('marks a profile as used with headphones without changing what it asks', () => {
    const marked = withHeadphones(RAW_STUDIO_PROFILE, true);
    expect(marked.headphones).toBe(true);
    expect(processingOf(marked)).toEqual(ALL_OFF);
  });
});

describe('the comparison of what was asked with what was granted (REQ-REC-092, REQ-REC-097)', () => {
  const plan = capturePlan(RAW_STUDIO_PROFILE, EVERYTHING);

  it('finds no difference where the browser granted what was asked', () => {
    expect(
      compareCapture(plan, { processing: ALL_OFF, channelCount: 2, sampleRate: 48_000 }),
    ).toEqual({ differences: [], uncontrollable: [] });
  });

  it('says what each processing control left on, or off, does to the recording', () => {
    const { differences } = compareCapture(plan, {
      processing: { ...ALL_OFF, autoGainControl: true },
      channelCount: 2,
      sampleRate: 48_000,
    });
    expect(differences).toEqual([
      {
        kind: 'processing',
        control: 'autoGainControl',
        requested: false,
        granted: true,
        meaning: expect.stringMatching(
          /^Automatic gain control is on although it was asked to be off: the browser changes the level/u,
        ) as string,
      },
    ]);

    const voice = compareCapture(capturePlan(VOICE_PROFILE, EVERYTHING), {
      processing: {
        echoCancellation: false,
        noiseSuppression: true,
        autoGainControl: true,
        voiceIsolation: true,
      },
    });
    expect(voice.differences[0]).toMatchObject({
      control: 'echoCancellation',
      requested: true,
      granted: false,
      meaning: expect.stringMatching(
        /^Echo cancellation is off although it was asked to be on: sound from the speakers/u,
      ) as string,
    });
  });

  it('says what cannot be confirmed where the browser does not report a setting', () => {
    const { voiceIsolation: _unreported, ...reported } = ALL_OFF;
    const { differences } = compareCapture(plan, { processing: reported });
    expect(differences.map((difference) => difference.kind)).toEqual([
      'processing',
      'channel-count',
      'sample-rate',
    ]);
    expect(differences[0]).not.toHaveProperty('granted');
    expect(differences[0]?.meaning).toMatch(
      /^The browser does not say whether voice isolation is on, so it cannot be confirmed that it is off as asked/u,
    );
  });

  it('says how many channels the recording has where the input gives fewer', () => {
    const { differences } = compareCapture(plan, {
      processing: ALL_OFF,
      channelCount: 1,
      sampleRate: 48_000,
    });
    expect(differences).toEqual([
      {
        kind: 'channel-count',
        requested: 2,
        granted: 1,
        meaning:
          'The input gives 1 channel where 2 channels were asked for, so the recording has 1.',
      },
    ]);
  });

  it('says the browser resamples an input at another rate', () => {
    const { differences } = compareCapture(plan, {
      processing: ALL_OFF,
      channelCount: 2,
      sampleRate: 44_100,
    });
    expect(differences[0]?.meaning).toBe(
      'The input runs at 44,100 Hz and the recording at 48,000 Hz, so the browser resamples the input, which adds a little latency and can soften the highest frequencies.',
    );
  });

  it('names each control that could not be set, with what the profile wanted of it', () => {
    const limited = capturePlan(VOICE_PROFILE, {
      supported: new Set(['echoCancellation']),
      contextRate: RATE,
    });
    const { uncontrollable } = compareCapture(limited, { processing: { echoCancellation: true } });
    expect(uncontrollable.map(({ control, wanted }) => [control, wanted])).toEqual([
      ['noiseSuppression', true],
      ['autoGainControl', true],
      ['voiceIsolation', true],
    ]);
    expect(uncontrollable[0]?.meaning).toBe(
      'This browser offers no control of noise suppression, so it cannot be turned on as the profile asks; without it, background noise is recorded as it is heard.',
    );

    const raw = compareCapture(
      capturePlan(RAW_STUDIO_PROFILE, { supported: new Set(), contextRate: RATE }),
      { processing: {} },
    );
    expect(raw.uncontrollable[0]?.meaning).toMatch(
      /cannot be turned off as the profile asks; if the browser applies it anyway, it removes sound/u,
    );
  });
});
