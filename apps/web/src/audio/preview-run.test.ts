/**
 * A run of the game preview through a playback control it drives (ADR-0104):
 * played from the start, laid further ahead as the feeder reads, continued from
 * the frame the feeder reads next by a hand trigger, moved where the feeder had
 * read past it, followed by a running change where a still emitter moves, kept
 * from growing over a long run, and stopped.
 */

import { describe, expect, it } from 'vitest';

import {
  StandardLayouts,
  derivedSampleCount,
  sampleRate,
  unsafeBrandId,
  type EditPlan,
  type ParameterValues,
  type SampleCount,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { runningChanges } from '@audiogubbins/audio-engine';
import {
  DEFAULT_EMITTER_RULES,
  DEFAULT_VOICE_VARIATION,
  memberKey,
  type EmitterRules,
  type GamePreviewScenario,
  type GroupMember,
  type PoolMember,
  type PreviewEmitterId,
  type StartedEvent,
  type TriggerPattern,
} from '@audiogubbins/game-audio';
import { PROCESSOR_CATALOGUE } from '@audiogubbins/processors';

import type { PreviewSetup } from './preview-setup.js';
import type { PreviewRunStats, PreviewRunView } from '../state/game-preview-store.js';
import type { Again, ContinuationOutcome } from './programme-continuation.js';
import {
  AHEAD_SECONDS,
  FORGET_EVERY_SECONDS,
  PreviewRun,
  type PreviewPlayback,
} from './preview-run.js';
import type { Programme } from './programme.js';

const RATE = expectSuccess(sampleRate(48_000));
const AHEAD = AHEAD_SECONDS * RATE;
const MEMBER: GroupMember = { kind: 'region', region: unsafeBrandId<'RegionId'>('0000a000-0001') };
const EMITTER = unsafeBrandId<'PreviewEmitterId'>('e0000000-0001');

/** A one-shot of `length` frames, read from one file. */
function soundOf(length: number): EditPlan {
  return {
    streams: [
      {
        sampleRate: RATE,
        layout: StandardLayouts.mono,
        segments: [
          {
            source: { kind: 'media', asset: unsafeBrandId<'AssetId'>('0000beef-0001') },
            start: derivedSampleCount(0),
            length: derivedSampleCount(length),
            reversed: false,
            stages: [],
          },
        ],
      },
    ],
  };
}

function scenarioOf(trigger: TriggerPattern, z = -2): GamePreviewScenario {
  return {
    id: unsafeBrandId<'GamePreviewScenarioId'>('5ce00000-0001'),
    name: 'Footsteps on gravel',
    space: '3d',
    panWidth: 1_000,
    panningStrength: 0.5,
    listener: { at: { x: 0, y: 0, z: 0 }, facingTurns: 0 },
    emitters: [
      {
        id: EMITTER,
        name: 'Feet',
        subject: { kind: 'member', member: MEMBER },
        trigger,
        motion: { kind: 'still', at: { x: 1, y: 0, z } },
      },
    ],
    seed: 7,
    busLevels: [],
  };
}

/**
 * A setup of `scenario`, its one member `length` frames long, varied in pitch
 * and gain, and looping where `loop` says.
 */
function setupOf(
  scenario: GamePreviewScenario,
  length = 4_800,
  rules: EmitterRules = DEFAULT_EMITTER_RULES,
  loop?: PoolMember['loop'],
): PreviewSetup {
  const pool: readonly PoolMember[] = [
    {
      member: MEMBER,
      variation: {
        ...DEFAULT_VOICE_VARIATION,
        pitchCents: { min: -200, max: 200 },
        gainDecibels: { min: -6, max: 0 },
      },
      bus: undefined,
      sampleRate: RATE,
      length,
      ...(loop === undefined ? {} : { loop }),
    },
  ];
  return {
    scenario,
    subjects: { emitterRules: () => rules, poolOf: () => pool },
    members: new Map([[memberKey(MEMBER), soundOf(length)]]),
    media: [],
    rate: RATE,
    layout: StandardLayouts.stereo,
    budget: 64,
    catalogue: PROCESSOR_CATALOGUE,
  };
}

/**
 * A playback control as the run sees it: it holds what it was last given, reads
 * where a test says, and goes on into a continuation from where it reads,
 * making it again where the feeder had read past its frame.
 */
class FakePlayback implements PreviewPlayback {
  loaded: Programme | undefined;
  read = 0;
  heard = 0;
  /** How far past a continuation's frame the feeder has read by the time it arrives. */
  lateBy = 0;
  readonly played: Programme[] = [];
  readonly continued: Programme[] = [];
  readonly followed: Programme[] = [];
  stops = 0;

  play(programme: Programme): void {
    this.loaded = programme;
    this.played.push(programme);
  }

  continue(programme: Programme, again?: Again): Promise<ContinuationOutcome> {
    const { continues } = programme;
    if (continues === undefined || this.loaded?.key !== continues.key) {
      return Promise.resolve({ kind: 'refused', reasons: ['Nothing it continues plays.'] });
    }
    this.read = Math.max(this.read, continues.from + this.lateBy);
    let taken = programme;
    if (continues.from < this.read) {
      if (again === undefined) return Promise.resolve({ kind: 'refused', reasons: ['Too late.'] });
      taken = again(derivedSampleCount(this.read));
    }
    this.loaded = taken;
    this.continued.push(taken);
    return Promise.resolve({ kind: 'continued', frame: derivedSampleCount(this.read) });
  }

  readFrame(): SampleCount | undefined {
    return this.loaded === undefined ? undefined : derivedSampleCount(this.read);
  }

  audiblePosition(): SampleCount | undefined {
    return this.loaded === undefined ? undefined : derivedSampleCount(this.heard);
  }

  follow(programme: Programme): void {
    this.loaded = programme;
    this.followed.push(programme);
  }

  stop(): undefined {
    this.stops += 1;
    return undefined;
  }

  programme(): string | undefined {
    return this.loaded?.key;
  }
}

/** A run of `setup` over a fake playback, its timers run by hand. */
function started(setup: PreviewSetup) {
  const playback = new FakePlayback();
  const timers: (() => void)[] = [];
  const views: PreviewRunView[] = [];
  const run = expectSuccess(
    PreviewRun.start(setup, 'game-preview:1', {
      playback,
      schedule: (callback) => {
        timers.push(callback);
        return () => {
          const at = timers.indexOf(callback);
          if (at >= 0) timers.splice(at, 1);
        };
      },
      now: () => 0,
      show: (view) => views.push(view),
    }),
  );
  /** Runs the run's look at playback once. */
  const look = (): void => {
    const next = timers.shift();
    next?.();
  };
  /** The run's last stats. */
  const stats = (): PreviewRunStats => {
    const last = views.at(-1);
    if (last === undefined || last.kind === 'idle') throw new Error('The run shows nothing.');
    return last.stats;
  };
  return { playback, run, look, stats, views };
}

/** Lets every change the run has queued settle. */
async function settled(run: PreviewRun, emitter: PreviewEmitterId): Promise<void> {
  // A stop of an emitter with no voice decides nothing new, and settles after
  // every change queued before it.
  await run.stopVoices(emitter);
}

function startsIn(stats: PreviewRunStats): readonly StartedEvent[] {
  return stats.recent.filter((event): event is StartedEvent => event.kind === 'started');
}

/** The values of every spatial panner in `plan`, by stream. */
function pannerValues(plan: EditPlan | undefined): ReadonlyMap<number, ParameterValues> {
  const found = new Map<number, ParameterValues>();
  for (const [place, stream] of (plan?.streams ?? []).entries()) {
    const processing = stream.processing;
    if (processing?.kind !== 'chain') continue;
    const [slot] = processing.chain.slots;
    if (slot?.kind === 'processor' && slot.typeKey === 'spatial-panner')
      found.set(place, slot.values);
  }
  return found;
}

describe('a run of the game preview', () => {
  it('plays its plan from the start, at the project rate, a second ahead', () => {
    const { playback } = started(setupOf(scenarioOf({ kind: 'by-hand' })));

    const [first] = playback.played;
    expect(playback.played).toHaveLength(1);
    expect(first?.rate).toBe(RATE);
    expect(first?.continues).toBeUndefined();
    expect(first?.plan?.streams[0].sampleRate).toBe(RATE);
  });

  it('lays more as the feeder reads near the end of what is laid, continuing from there', async () => {
    const { playback, run, look } = started(
      setupOf(
        scenarioOf({
          kind: 'repeat',
          intervalMilliseconds: 100,
          jitterMilliseconds: 0,
          count: 100,
        }),
      ),
    );
    playback.read = AHEAD / 4;
    look();
    expect(playback.continued).toHaveLength(0);

    playback.read = AHEAD * 0.6;
    look();
    await settled(run, EMITTER);

    expect(playback.continued[0]?.continues?.from).toBe(AHEAD);
  });

  it('starts a hand trigger at the frame the feeder reads next', async () => {
    const { playback, run, look, stats } = started(setupOf(scenarioOf({ kind: 'by-hand' })));
    playback.read = 12_000;

    await run.trigger(EMITTER);
    playback.heard = 12_000;
    look();

    expect(playback.continued[0]?.continues?.from).toBe(12_000);
    expect(startsIn(stats()).map((event) => event.frame)).toEqual([12_000]);
  });

  it('moves a hand trigger to where the feeder had read, where it read past its frame', async () => {
    const { playback, run, look, stats } = started(setupOf(scenarioOf({ kind: 'by-hand' })));
    playback.read = 12_000;
    playback.lateBy = 960;

    await run.trigger(EMITTER);
    playback.heard = 20_000;
    look();

    expect(playback.continued[0]?.continues?.from).toBe(12_960);
    expect(startsIn(stats()).map((event) => event.frame)).toEqual([12_960]);
  });

  it('chooses the same members, pitches and gains on every run of a seeded pattern', async () => {
    const heardRun = async (): Promise<readonly StartedEvent[]> => {
      const { playback, run, look, stats } = started(
        setupOf(
          scenarioOf({
            kind: 'repeat',
            intervalMilliseconds: 50,
            jitterMilliseconds: 20,
            count: 12,
          }),
        ),
      );
      playback.heard = AHEAD - 1;
      look();
      await settled(run, EMITTER);
      return startsIn(stats());
    };

    const first = await heardRun();
    expect(first).toHaveLength(12);
    expect(new Set(first.map((event) => event.pitchCents)).size).toBeGreaterThan(1);
    expect(await heardRun()).toEqual(first);
  });

  it('moves a still emitter while it plays as a running change, which every later stretch keeps', async () => {
    const { playback, run, look } = started(
      setupOf(
        scenarioOf({
          kind: 'repeat',
          intervalMilliseconds: 100,
          jitterMilliseconds: 0,
          count: 100,
        }),
      ),
    );
    const before = pannerValues(playback.loaded?.plan);

    await run.follow(
      scenarioOf(
        { kind: 'repeat', intervalMilliseconds: 100, jitterMilliseconds: 0, count: 100 },
        -9,
      ),
    );

    const [followed] = playback.followed;
    const moved = pannerValues(followed?.plan);
    expect(moved).not.toEqual(before);
    const loaded = playback.played[0]?.plan;
    if (loaded === undefined || followed?.plan === undefined)
      throw new Error('Nothing was played.');
    // A change of values alone, which the transport takes as it plays.
    expect(runningChanges(loaded, followed.plan)?.length).toBeGreaterThan(0);

    playback.read = AHEAD * 0.6;
    look();
    await settled(run, EMITTER);
    expect(pannerValues(playback.continued.at(-1)?.plan)).toEqual(moved);
  });

  it('keeps its plan from growing without end over a long run triggered by hand', async () => {
    const { playback, run, look, stats } = started(setupOf(scenarioOf({ kind: 'by-hand' }), 2_400));
    const sizes: number[] = [];
    const triggers = 20 * 10 * FORGET_EVERY_SECONDS;
    for (let trigger = 0; trigger < triggers; trigger += 1) {
      playback.read += 4_800;
      await run.trigger(EMITTER);
      playback.heard = playback.read;
      look();
      sizes.push(stats().planStreams);
    }
    const early = sizes[9] ?? 0;
    const perVoice = ((sizes[19] ?? 0) - early) / 10;

    expect(perVoice).toBeGreaterThan(0);
    // At ten triggers a second, what it holds is the voices of the seconds it
    // has not yet forgotten: those behind the listener, those to forget next,
    // and those laid ahead.
    const window = 10 * (FORGET_EVERY_SECONDS + 1 + AHEAD_SECONDS + 2);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(early + perVoice * window);
    expect(stats().counts.started).toBe(triggers);
  });

  it('keeps its plan from growing without end where a loop and its triggers never fall silent', async () => {
    // A loop of a tenth of a second triggered every 50 ms, four at a time, the
    // oldest stolen: there is never a frame where nothing sounds.
    const rules: EmitterRules = {
      ...DEFAULT_EMITTER_RULES,
      voices: { limit: 4, stealing: 'oldest' },
    };
    const scenario = scenarioOf({
      kind: 'repeat',
      intervalMilliseconds: 50,
      jitterMilliseconds: 10,
      count: 10_000,
    });
    const { playback, look, stats } = started(
      setupOf(scenario, 4_800, rules, { start: 1_200, end: 4_400 }),
    );
    const sizes: number[] = [];
    for (let turn = 0; turn < 1_200; turn += 1) {
      playback.read += 4_800;
      playback.heard = playback.read - 2_400;
      look();
      // Every change the look queued settles within the next task.
      await new Promise((resolve) => setTimeout(resolve, 0));
      sizes.push(stats().planStreams);
    }
    const second = Math.max(...sizes.slice(200, 400));
    const last = Math.max(...sizes.slice(1_000));

    expect(stats().counts.started).toBeGreaterThan(2_000);
    expect(last).toBeLessThanOrEqual(Math.ceil(second * 1.1));
  }, 120_000);

  it('stops what it plays, keeping what it played to show', async () => {
    const { playback, run, views } = started(setupOf(scenarioOf({ kind: 'by-hand' })));

    run.stop();
    await run.trigger(EMITTER);

    expect(playback.stops).toBe(1);
    expect(playback.continued).toHaveLength(0);
    expect(views.at(-1)?.kind).toBe('stopped');
  });
});
