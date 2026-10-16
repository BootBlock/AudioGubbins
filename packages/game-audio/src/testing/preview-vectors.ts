/**
 * The game preview's reference vectors (ADR-0104, REQ-GAME-122): scenarios,
 * rules, pools and hand actions, each with the event log the preview's
 * simulation makes of it, which Phase 11's Godot runtime is held to in GUT,
 * so the runtime chooses, varies, cools down, limits and steals as the
 * authoring tool previews. `preview-vectors.test.ts` pins every log here
 * against the simulation; a change to either fails it.
 *
 * What a runtime reproduces, at the preview's rate `fs` (48 kHz in every
 * vector), all in 32-bit unsigned integers or IEEE doubles in the order
 * written:
 *
 * - **Generator.** `lowbias32(x)`: `x ^= x >>> 16`; `x = imul(x, 0x7feb352d)`;
 *   `x ^= x >>> 15`; `x = imul(x, 0x846ca68b)`; `x ^= x >>> 16`. A draw word
 *   for `(key, stream, index)` with `index < 2³²`:
 *   `h = lowbias32(key ^ imul(stream + 1, 0x9e3779b9))`;
 *   `h = lowbias32(h ^ 0)`; `h = lowbias32(h ^ index)` (the middle word is the
 *   index's high half, 0 below 2³²).
 * - **Emitter key.** `lowbias32(seed ^ crc32(id))`, CRC-32 as zlib's over the
 *   identifier's ASCII bytes. Streams: selection 1, pitch 2, gain 3, offset 4,
 *   jitter 5; the index is the trigger's ordinal (a repeat's `k`; by hand, the
 *   repeat's count, or 0, plus the emitter's hand triggers before it).
 * - **Whole choice among `n`.** `(h·n) >> 32`. **Fraction** `u = h / 2³²`.
 * - **Milliseconds to frames.** `floor(ms·fs/1000 + 0.5)`.
 * - **Repeat trigger `k`.**
 *   `max(0, frames(k·interval) + ((h_jitter·(2J + 1)) >> 32) − J)`,
 *   `J = frames(jitter)`.
 * - **Order.** By frame; at one frame, the voices that end there first (by
 *   voice number), then emitters by identifier (code-unit order), an emitter's
 *   repeat trigger before its hand actions, hand actions as listed.
 * - **Cooldown.** Suppressed where `t − t_last < frames(cooldown)`, `t_last`
 *   the last trigger that started a voice; refusals never move it.
 * - **Selection.** Pool in membership order. Uniform: `choice(n)`.
 *   Avoid-recent(d): set aside the last `min(d, n − 1)` choices, take
 *   `choice(m)` of the `m` left in pool order. Refused triggers add no choice.
 * - **Variation** of the chosen member: pitch `min + choice(max − min + 1)`
 *   cents; gain `min + u·(max − min)` dB; offset
 *   `choice(min(frames_m(max), S − 1) + 1)` of the member's own frames at its
 *   rate `r`, `S` its length or its loop's end.
 * - **Ratio.** `n / 4096`, `n` the whole number nearest `4096·2^(c/1200)`.
 * - **Voice length.** `L − offset` frames, then `ceil(·4096 / n)` where
 *   pitched, then `ceil(·fs / r)` where `r ≠ fs`; a loop never ends.
 * - **Voices.** At the emitter's limit, `oldest` steals the earliest started
 *   (then the lower emitter by identifier, then the lower lane), `quietest` the
 *   lowest gain (then as oldest), `reject` refuses. Below the limit but at the
 *   preview's budget, the same rule across every emitter (`budget-stolen`,
 *   `budget-rejected`). A stolen voice stops counting at once. Lanes: the
 *   lowest free at the frame, a lane busy until its voice's end or, cut,
 *   `frames(5)` after the cut.
 *
 * The attenuation curves are pinned by the spatial panner's golden tests in
 * the processors, which Phase 11 holds to Godot's players (the plan's Q3).
 */

import {
  DeterminismClass,
  ParameterTaper,
  ProcessorCategory,
  derivedSampleCount,
  sampleRate,
  succeed,
  unsafeBrandId,
  type ParameterDescriptor,
  type ProcessorCatalogue,
  type ProcessorDescriptor,
  type SampleRate,
} from '@audiogubbins/domain';

import type { GroupMember } from '../groups/membership.js';
import { busName, type BusName } from '../policy/bus-name.js';
import {
  DEFAULT_EMITTER_RULES,
  DEFAULT_VOICE_VARIATION,
  type EmitterRules,
  type VoiceVariation,
} from '../policy/playback-rules.js';
import type { PreviewEvent } from '../preview/preview-event-log.js';
import type {
  GamePreviewScenario,
  PreviewEmitter,
  PreviewEmitterId,
} from '../preview/preview-scenario.js';
import type { PreviewInput } from '../preview/preview-simulation.js';
import type { HandAction } from '../preview/trigger-schedule.js';
import type { PoolMember } from '../preview/preview-subjects.js';
import { seededRandom, type Random } from './seeded-random.js';

function rateOf(hertz: number): SampleRate {
  const made = sampleRate(hertz);
  if (!made.ok) throw new Error(`${String(hertz)} Hz is a sample rate.`);
  return made.value;
}

function bus(name: string): BusName {
  const made = busName(name);
  if (!made.ok) throw new Error(`"${name}" is a bus name.`);
  return made.value;
}

/** The rate every vector runs at. */
export const VECTOR_RATE = rateOf(48_000);

/** A rate members of another rate are played from. */
export const MEMBER_RATE_44K = rateOf(44_100);

export const SFX_BUS = bus('SFX');
const AMBIENCE_BUS = bus('Ambience');

/** Region member `n`. */
export function regionMember(n: number): GroupMember {
  return {
    kind: 'region',
    region: unsafeBrandId<'RegionId'>(`0000a000-${String(n).padStart(4, '0')}`),
  };
}

export function emitterId(n: number): PreviewEmitterId {
  return unsafeBrandId<'PreviewEmitterId'>(`e0000000-${String(n).padStart(4, '0')}`);
}

/** A pool member of `length` frames at 48 kHz, unvaried, on no bus, unless told otherwise. */
export function poolMember(
  n: number,
  length: number,
  changes: Partial<PoolMember> = {},
): PoolMember {
  return {
    member: regionMember(n),
    variation: DEFAULT_VOICE_VARIATION,
    bus: undefined,
    sampleRate: VECTOR_RATE,
    length,
    ...changes,
  };
}

/** An emitter of `subject` group `n` repeating as asked, still in front of the listener. */
export function repeatEmitter(
  n: number,
  trigger: PreviewEmitter['trigger'],
  changes: Partial<PreviewEmitter> = {},
): PreviewEmitter {
  return {
    id: emitterId(n),
    name: `Emitter ${String(n)}`,
    subject: {
      kind: 'group',
      group: unsafeBrandId<'GameAssetGroupId'>(`9a000000-${String(n).padStart(4, '0')}`),
    },
    trigger,
    motion: { kind: 'still', at: { x: 0, y: 0, z: -1 } },
    ...changes,
  };
}

/** A 3D scenario of `emitters` under `seed`, the listener at the origin facing −z. */
export function vectorScenario(
  emitters: readonly PreviewEmitter[],
  seed: number,
  changes: Partial<GamePreviewScenario> = {},
): GamePreviewScenario {
  return {
    id: unsafeBrandId<'GamePreviewScenarioId'>('5ce00000-0001'),
    name: 'Vector',
    space: '3d',
    panWidth: 1_152,
    panningStrength: 0.5,
    listener: { at: { x: 0, y: 0, z: 0 }, facingTurns: 0 },
    emitters,
    seed,
    busLevels: [],
    ...changes,
  };
}

/** What a simulation is asked: a scenario, and each emitter's rules and pool by its place. */
export interface VectorSpec {
  readonly scenario: GamePreviewScenario;
  /** Each emitter's rules and pool, by its place in the scenario. */
  readonly emitters: readonly {
    readonly rules: EmitterRules;
    readonly pool: readonly PoolMember[];
  }[];
  readonly hand: readonly HandAction[];
  readonly voiceBudget: number;
  readonly horizonFrame: number;
}

/** One reference vector: what is asked of the simulation, and the log it makes. */
export interface PreviewVector extends VectorSpec {
  readonly name: string;
  /** What the vector holds a runtime to. */
  readonly holds: string;
  readonly events: readonly PreviewEvent[];
}

/** `spec` as the simulation's input at {@link VECTOR_RATE}, each subject's rules and pool its emitter's. */
export function vectorInput(spec: VectorSpec): PreviewInput {
  const place = (subject: PreviewEmitter['subject']): number =>
    spec.scenario.emitters.findIndex((emitter) => emitter.subject === subject);
  return {
    scenario: spec.scenario,
    emitterRules: (subject) => spec.emitters[place(subject)]?.rules ?? DEFAULT_EMITTER_RULES,
    poolOf: (subject) => spec.emitters[place(subject)]?.pool ?? [],
    hand: spec.hand,
    sampleRate: VECTOR_RATE,
    voiceBudget: spec.voiceBudget,
    horizonFrame: spec.horizonFrame,
  };
}

/** A variation of pitch, gain and offset all at once. */
export const VARIED: VoiceVariation = {
  pitchCents: { min: -300, max: 300 },
  gainDecibels: { min: -6, max: 0 },
  startOffsetMilliseconds: { max: 20 },
};

/** The parameters the preview sets on the spatial panner, with its ranges (`spatial-panner.ts`). */
function numeric(
  id: string,
  key: string,
  minimum: number,
  maximum: number,
  defaultValue: number,
): ParameterDescriptor {
  return {
    kind: 'numeric',
    id: unsafeBrandId<'ParameterId'>(id),
    key,
    label: key,
    minimum,
    maximum,
    defaultValue,
    taper: ParameterTaper.Linear,
  };
}

const COMMON = {
  category: ProcessorCategory.Space,
  version: { implementation: 1, parameters: 1 },
  qualitySettings: [],
  determinism: DeterminismClass.Canonical,
  wholePass: false,
  realTime: true,
  latency: () => ({ kind: 'known', frames: derivedSampleCount(0) }) as const,
  leadIn: () => 0,
  frameGrid: () => 1,
} as const;

const FARTHEST = 1_000_000;

/**
 * The spatial panner's and the gain's descriptors as far as a preview plan
 * reads them, the panner's keys and ranges those of the processors' own:
 * this package may not reach the processors, whose catalogue the application
 * gives it.
 */
export const PREVIEW_TEST_CATALOGUE: ProcessorCatalogue = new Map<string, ProcessorDescriptor>([
  [
    'spatial-panner',
    {
      ...COMMON,
      typeKey: 'spatial-panner',
      label: 'Spatial panner',
      outputLayout: (input) => succeed(input),
      parameters: [
        {
          kind: 'choice',
          id: unsafeBrandId<'ParameterId'>('c1000000-0051'),
          key: 'space',
          label: 'Space',
          options: [
            { key: '3d', label: '3D' },
            { key: '2d', label: '2D' },
          ],
          defaultKey: '3d',
        },
        numeric('c1000000-0052', 'x', -FARTHEST, FARTHEST, 0),
        numeric('c1000000-0053', 'y', -FARTHEST, FARTHEST, 0),
        numeric('c1000000-0054', 'z', -FARTHEST, FARTHEST, 0),
        {
          kind: 'choice',
          id: unsafeBrandId<'ParameterId'>('c1000000-0055'),
          key: 'attenuation',
          label: 'Attenuation',
          options: [
            { key: 'none', label: 'None' },
            { key: 'inverse', label: 'Inverse' },
            { key: 'inverse-square', label: 'Inverse square' },
            { key: 'logarithmic', label: 'Logarithmic' },
            { key: 'exponent', label: 'Exponent' },
          ],
          defaultKey: 'inverse',
        },
        numeric('c1000000-0056', 'unit-size', 0.01, FARTHEST, 10),
        numeric('c1000000-0057', 'max-distance', 0, FARTHEST, 0),
        numeric('c1000000-0058', 'ceiling', -80, 24, 3),
        numeric('c1000000-0059', 'exponent', 0.01, 16, 1),
        numeric('c1000000-005a', 'pan-width', 1, FARTHEST, 1_152),
        numeric('c1000000-005b', 'panning-strength', 0, 1, 0.5),
        numeric('c1000000-005c', 'filter-cutoff', 20, 20_000, 5_000),
        numeric('c1000000-005d', 'filter-decibels', -80, 0, -24),
      ],
    },
  ],
  [
    'gain',
    {
      ...COMMON,
      category: ProcessorCategory.Level,
      typeKey: 'gain',
      label: 'Gain',
      outputLayout: (input) => succeed(input),
      parameters: [numeric('9a1e0001-0001', 'gain', -96, 48, 0)],
    },
  ],
]);

/** A random selection rule, voice rules and cooldown, without attenuation. */
function randomRules(random: Random): EmitterRules {
  return {
    selection: random.chance(0.5)
      ? { kind: 'uniform' }
      : { kind: 'avoid-recent', depth: random.whole(1, 4) },
    voices: {
      limit: random.whole(1, 5),
      stealing: random.pick(['oldest', 'quietest', 'reject'] as const),
    },
    cooldownMilliseconds: random.chance(0.5) ? 0 : random.whole(1, 150),
    attenuation: { kind: 'none' },
  };
}

/** A random pool of one to five members: some looped, some at 44.1 kHz, some varied, some on a bus. */
function randomPool(random: Random, first: number): readonly PoolMember[] {
  return Array.from({ length: random.whole(1, 5) }, (_, index) => {
    const length = random.whole(200, 30_000);
    const looped = random.chance(0.25);
    const start = random.whole(0, Math.floor(length / 2));
    return poolMember(first + index, length, {
      sampleRate: random.chance(0.25) ? MEMBER_RATE_44K : VECTOR_RATE,
      variation: random.chance(0.6)
        ? {
            pitchCents: { min: -random.whole(0, 1_200), max: random.whole(0, 1_200) },
            gainDecibels: { min: -random.whole(0, 24), max: random.whole(0, 6) },
            startOffsetMilliseconds: { max: random.whole(0, 200) },
          }
        : DEFAULT_VOICE_VARIATION,
      bus: [undefined, SFX_BUS, AMBIENCE_BUS][random.below(3)],
      ...(looped ? { loop: { start, end: random.whole(start + 50, length) } } : {}),
    });
  });
}

/**
 * A random simulation of one to four emitters over a second and a half, each
 * repeating or by hand, with up to twelve hand actions and a budget that may
 * bind.
 */
export function randomVectorSpec(seed: number): VectorSpec {
  const random = seededRandom(seed);
  const count = random.whole(1, 4);
  const emitters = Array.from({ length: count }, (_, index) =>
    repeatEmitter(
      index + 1,
      random.chance(0.75)
        ? {
            kind: 'repeat',
            intervalMilliseconds: random.whole(20, 120),
            jitterMilliseconds: random.whole(0, 10),
            count: random.whole(1, 60),
          }
        : { kind: 'by-hand' },
    ),
  );
  const horizonFrame = 72_000;
  const hand = Array.from({ length: random.whole(0, 12) }, () => ({
    kind: random.chance(0.8) ? ('trigger' as const) : ('stop' as const),
    emitter: emitterId(random.whole(1, count)),
    frame: random.whole(0, horizonFrame - 1),
  })).toSorted((left, right) => left.frame - right.frame);
  return {
    scenario: vectorScenario(emitters, random.whole(0, 2 ** 32 - 1)),
    emitters: emitters.map((_, index) => ({
      rules: randomRules(random),
      pool: randomPool(random, 10 * index + 1),
    })),
    hand,
    voiceBudget: random.whole(1, 12),
    horizonFrame,
  };
}

const MEMBER_ID_PATTERN = /^0000a000-(\d{4})$/u;
const EMITTER_ID_PATTERN = /^e0000000-(\d{4})$/u;

/** A voice started, by the numbers of its emitter and member. */
function started(
  frame: number,
  emitter: number,
  trigger: number,
  voice: number,
  lane: number,
  member: number,
  pitchCents: number,
  gainDecibels: number,
  offsetFrames: number,
  on?: BusName,
): PreviewEvent {
  return {
    kind: 'started',
    frame,
    emitter: emitterId(emitter),
    trigger,
    voice,
    lane,
    member: regionMember(member),
    pitchCents,
    gainDecibels,
    offsetFrames,
    bus: on,
  };
}

/** A trigger refused. */
function refused(
  kind: 'suppressed' | 'rejected' | 'budget-rejected',
  frame: number,
  emitter: number,
  trigger: number,
): PreviewEvent {
  return { kind, frame, emitter: emitterId(emitter), trigger };
}

/** A voice ended. */
function ended(
  kind: 'stolen' | 'budget-stolen' | 'stopped' | 'ended',
  frame: number,
  emitter: number,
  voice: number,
): PreviewEvent {
  return { kind, frame, emitter: emitterId(emitter), voice };
}

/** `event` written as the call that makes it here, for a vector's log. */
export function eventSource(event: PreviewEvent): string {
  const number = (text: string, pattern: RegExp): string =>
    pattern.exec(text)?.[1]?.replace(/^0+(?=\d)/u, '') ?? text;
  const emitter = number(event.emitter, EMITTER_ID_PATTERN);
  if (event.kind === 'started') {
    const member =
      event.member.kind === 'region'
        ? number(event.member.region, MEMBER_ID_PATTERN)
        : event.member.asset;
    const bus =
      event.bus === undefined ? '' : `, ${event.bus === SFX_BUS ? 'SFX_BUS' : 'AMBIENCE_BUS'}`;
    return `started(${[event.frame, emitter, event.trigger, event.voice, event.lane, member, event.pitchCents, event.gainDecibels, event.offsetFrames].join(', ')}${bus})`;
  }
  if ('trigger' in event)
    return `refused('${event.kind}', ${String(event.frame)}, ${emitter}, ${String(event.trigger)})`;
  return `ended('${event.kind}', ${String(event.frame)}, ${emitter}, ${String(event.voice)})`;
}

const rules = (changes: Partial<EmitterRules>): EmitterRules => ({
  ...DEFAULT_EMITTER_RULES,
  ...changes,
});
const varied = (cents: number, decibels: number, milliseconds: number): VoiceVariation => ({
  pitchCents: { min: -cents, max: cents },
  gainDecibels: { min: -decibels, max: 0 },
  startOffsetMilliseconds: { max: milliseconds },
});
const repeat = (intervalMilliseconds: number, jitterMilliseconds: number, count: number) =>
  ({ kind: 'repeat', intervalMilliseconds, jitterMilliseconds, count }) as const;

/** The vectors' specifications, each with what it holds a runtime to. */
const SPECS: readonly (VectorSpec & { readonly name: string; readonly holds: string })[] = [
  {
    name: 'uniform-variation',
    holds:
      'Repeat times with jitter, uniform selection, and each member’s own pitch, gain and offset drawn, one member at 44.1 kHz played at the preview’s rate.',
    scenario: vectorScenario([repeatEmitter(1, repeat(100, 10, 8))], 20_261_016),
    emitters: [
      {
        rules: DEFAULT_EMITTER_RULES,
        pool: [
          poolMember(1, 9_600, { variation: varied(300, 6, 20) }),
          poolMember(2, 4_800, { variation: varied(1_200, 12, 0), bus: SFX_BUS }),
          poolMember(3, 8_820, { variation: varied(50, 0, 50), sampleRate: MEMBER_RATE_44K }),
        ],
      },
    ],
    hand: [],
    voiceBudget: 64,
    horizonFrame: 48_000,
  },
  {
    name: 'avoid-recent-cooldown',
    holds:
      'Avoid-recent of depth 2 over four members, and a 70 ms cooldown that suppresses triggers 40 ms apart without moving it or the selection history.',
    scenario: vectorScenario([repeatEmitter(1, repeat(40, 0, 16))], 7),
    emitters: [
      {
        rules: rules({ selection: { kind: 'avoid-recent', depth: 2 }, cooldownMilliseconds: 70 }),
        pool: [1, 2, 3, 4].map((n) => poolMember(n, 1_200)),
      },
    ],
    hand: [],
    voiceBudget: 64,
    horizonFrame: 48_000,
  },
  {
    name: 'limit-oldest-lanes',
    holds:
      'A limit of two stealing the oldest: each stolen voice fades in its own lane, and two hand triggers on a repeat’s frame take lanes past limit + 1.',
    scenario: vectorScenario([repeatEmitter(1, repeat(30, 0, 8))], 99),
    emitters: [
      { rules: rules({ voices: { limit: 2, stealing: 'oldest' } }), pool: [poolMember(1, 24_000)] },
    ],
    hand: [
      { kind: 'trigger', emitter: emitterId(1), frame: 4_320 },
      { kind: 'trigger', emitter: emitterId(1), frame: 4_320 },
    ],
    voiceBudget: 64,
    horizonFrame: 24_000,
  },
  {
    name: 'limit-quietest',
    holds: 'A limit of three stealing the voice of the lowest gain drawn.',
    scenario: vectorScenario([repeatEmitter(1, repeat(25, 5, 10))], 3_141_592_653),
    emitters: [
      {
        rules: rules({ voices: { limit: 3, stealing: 'quietest' } }),
        pool: [poolMember(1, 30_000, { variation: varied(0, 24, 0) })],
      },
    ],
    hand: [],
    voiceBudget: 64,
    horizonFrame: 24_000,
  },
  {
    name: 'limit-reject',
    holds: 'A limit of one that rejects, until its voice ends.',
    scenario: vectorScenario([repeatEmitter(1, repeat(50, 0, 10))], 1),
    emitters: [
      { rules: rules({ voices: { limit: 1, stealing: 'reject' } }), pool: [poolMember(1, 7_000)] },
    ],
    hand: [],
    voiceBudget: 64,
    horizonFrame: 24_000,
  },
  {
    name: 'budget',
    holds:
      'A budget of three across two emitters, in order of their identifiers: the oldest of either stolen for one, the other rejected.',
    scenario: vectorScenario(
      [repeatEmitter(2, repeat(60, 0, 6)), repeatEmitter(1, repeat(40, 0, 8))],
      5,
    ),
    emitters: [
      {
        rules: rules({ voices: { limit: 4, stealing: 'reject' } }),
        pool: [poolMember(21, 20_000)],
      },
      {
        rules: rules({ voices: { limit: 4, stealing: 'oldest' } }),
        pool: [poolMember(11, 20_000)],
      },
    ],
    hand: [],
    voiceBudget: 3,
    horizonFrame: 24_000,
  },
  {
    name: 'hand-loop-stop',
    holds:
      'Hand triggers of a loop, which never ends, numbered from 0 on an emitter with no repeat, and a stop by hand that cuts every voice of its emitter.',
    scenario: vectorScenario([repeatEmitter(1, { kind: 'by-hand' })], 11),
    emitters: [
      {
        rules: DEFAULT_EMITTER_RULES,
        pool: [
          poolMember(1, 4_000, {
            loop: { start: 1_000, end: 3_000 },
            variation: varied(100, 3, 30),
            bus: AMBIENCE_BUS,
          }),
          poolMember(2, 2_000),
        ],
      },
    ],
    hand: [
      { kind: 'trigger', emitter: emitterId(1), frame: 100 },
      { kind: 'trigger', emitter: emitterId(1), frame: 2_000 },
      { kind: 'trigger', emitter: emitterId(1), frame: 9_000 },
      { kind: 'stop', emitter: emitterId(1), frame: 12_000 },
      { kind: 'trigger', emitter: emitterId(1), frame: 12_000 },
    ],
    voiceBudget: 64,
    horizonFrame: 24_000,
  },
];

/** The log each vector's specification makes, by name. */
const LOGS: Readonly<Record<string, readonly PreviewEvent[]>> = {
  'uniform-variation': [
    started(390, 1, 0, 0, 0, 3, -5, 0, 2169),
    started(5161, 1, 1, 1, 1, 3, 23, 0, 557),
    ended('ended', 7651, 1, 0),
    started(9662, 1, 2, 2, 0, 3, -32, 0, 581),
    ended('ended', 14037, 1, 1),
    started(14122, 1, 3, 3, 1, 1, -179, -0.7189647126942873, 528),
    ended('ended', 18798, 1, 2),
    started(19099, 1, 4, 4, 0, 1, 117, -2.5836094706319273, 311),
    started(23658, 1, 5, 5, 2, 1, -234, -4.167775038164109, 764),
    ended('ended', 24182, 1, 3),
    ended('ended', 27782, 1, 4),
    started(28602, 1, 6, 6, 0, 1, 219, -2.470545478630811, 710),
    started(33508, 1, 7, 7, 1, 2, 380, -9.681951477192342, 0, SFX_BUS),
    ended('ended', 33774, 1, 5),
    ended('ended', 36437, 1, 6),
    ended('ended', 37363, 1, 7),
  ],
  'avoid-recent-cooldown': [
    started(0, 1, 0, 0, 0, 3, 0, 0, 0),
    ended('ended', 1200, 1, 0),
    refused('suppressed', 1920, 1, 1),
    started(3840, 1, 2, 1, 0, 1, 0, 0, 0),
    ended('ended', 5040, 1, 1),
    refused('suppressed', 5760, 1, 3),
    started(7680, 1, 4, 2, 0, 4, 0, 0, 0),
    ended('ended', 8880, 1, 2),
    refused('suppressed', 9600, 1, 5),
    started(11520, 1, 6, 3, 0, 3, 0, 0, 0),
    ended('ended', 12720, 1, 3),
    refused('suppressed', 13440, 1, 7),
    started(15360, 1, 8, 4, 0, 1, 0, 0, 0),
    ended('ended', 16560, 1, 4),
    refused('suppressed', 17280, 1, 9),
    started(19200, 1, 10, 5, 0, 4, 0, 0, 0),
    ended('ended', 20400, 1, 5),
    refused('suppressed', 21120, 1, 11),
    started(23040, 1, 12, 6, 0, 3, 0, 0, 0),
    ended('ended', 24240, 1, 6),
    refused('suppressed', 24960, 1, 13),
    started(26880, 1, 14, 7, 0, 1, 0, 0, 0),
    ended('ended', 28080, 1, 7),
    refused('suppressed', 28800, 1, 15),
  ],
  'limit-oldest-lanes': [
    started(0, 1, 0, 0, 0, 1, 0, 0, 0),
    started(1440, 1, 1, 1, 1, 1, 0, 0, 0),
    ended('stolen', 2880, 1, 0),
    started(2880, 1, 2, 2, 2, 1, 0, 0, 0),
    ended('stolen', 4320, 1, 1),
    started(4320, 1, 3, 3, 0, 1, 0, 0, 0),
    ended('stolen', 4320, 1, 2),
    started(4320, 1, 8, 4, 3, 1, 0, 0, 0),
    ended('stolen', 4320, 1, 3),
    started(4320, 1, 9, 5, 4, 1, 0, 0, 0),
    ended('stolen', 5760, 1, 4),
    started(5760, 1, 4, 6, 0, 1, 0, 0, 0),
    ended('stolen', 7200, 1, 5),
    started(7200, 1, 5, 7, 1, 1, 0, 0, 0),
    ended('stolen', 8640, 1, 6),
    started(8640, 1, 6, 8, 2, 1, 0, 0, 0),
    ended('stolen', 10080, 1, 7),
    started(10080, 1, 7, 9, 0, 1, 0, 0, 0),
  ],
  'limit-quietest': [
    started(0, 1, 0, 0, 0, 1, 0, -3.3828689698129892, 0),
    started(1082, 1, 1, 1, 1, 1, 0, -21.803327852860093, 0),
    started(2224, 1, 2, 2, 2, 1, 0, -12.205315936356783, 0),
    ended('stolen', 3678, 1, 1),
    started(3678, 1, 3, 3, 3, 1, 0, -5.618452677503228, 0),
    ended('stolen', 4739, 1, 2),
    started(4739, 1, 4, 4, 1, 1, 0, -1.4293955639004707, 0),
    ended('stolen', 5965, 1, 3),
    started(5965, 1, 5, 5, 2, 1, 0, -8.945526318624616, 0),
    ended('stolen', 7030, 1, 5),
    started(7030, 1, 6, 6, 3, 1, 0, -5.258956678211689, 0),
    ended('stolen', 8374, 1, 6),
    started(8374, 1, 7, 7, 2, 1, 0, -7.516703344881535, 0),
    ended('stolen', 9750, 1, 7),
    started(9750, 1, 8, 8, 3, 1, 0, -7.595280759036541, 0),
    ended('stolen', 10824, 1, 8),
    started(10824, 1, 9, 9, 2, 1, 0, -5.59301988221705, 0),
  ],
  'limit-reject': [
    started(0, 1, 0, 0, 0, 1, 0, 0, 0),
    refused('rejected', 2400, 1, 1),
    refused('rejected', 4800, 1, 2),
    ended('ended', 7000, 1, 0),
    started(7200, 1, 3, 1, 0, 1, 0, 0, 0),
    refused('rejected', 9600, 1, 4),
    refused('rejected', 12000, 1, 5),
    ended('ended', 14200, 1, 1),
    started(14400, 1, 6, 2, 0, 1, 0, 0, 0),
    refused('rejected', 16800, 1, 7),
    refused('rejected', 19200, 1, 8),
    ended('ended', 21400, 1, 2),
    started(21600, 1, 9, 3, 0, 1, 0, 0, 0),
  ],
  budget: [
    started(0, 1, 0, 0, 0, 11, 0, 0, 0),
    started(0, 2, 0, 1, 0, 21, 0, 0, 0),
    started(1920, 1, 1, 2, 1, 11, 0, 0, 0),
    refused('budget-rejected', 2880, 2, 1),
    ended('budget-stolen', 3840, 1, 0),
    started(3840, 1, 2, 3, 2, 11, 0, 0, 0),
    ended('budget-stolen', 5760, 2, 1),
    started(5760, 1, 3, 4, 0, 11, 0, 0, 0),
    refused('budget-rejected', 5760, 2, 2),
    ended('budget-stolen', 7680, 1, 2),
    started(7680, 1, 4, 5, 3, 11, 0, 0, 0),
    refused('budget-rejected', 8640, 2, 3),
    ended('budget-stolen', 9600, 1, 3),
    started(9600, 1, 5, 6, 1, 11, 0, 0, 0),
    ended('budget-stolen', 11520, 1, 4),
    started(11520, 1, 6, 7, 2, 11, 0, 0, 0),
    refused('budget-rejected', 11520, 2, 4),
    ended('budget-stolen', 13440, 1, 5),
    started(13440, 1, 7, 8, 0, 11, 0, 0, 0),
    refused('budget-rejected', 14400, 2, 5),
  ],
  'hand-loop-stop': [
    started(100, 1, 0, 0, 0, 1, -30, -0.6278435597196221, 1295, AMBIENCE_BUS),
    started(2000, 1, 1, 1, 1, 1, -77, -0.13644915190525353, 1364, AMBIENCE_BUS),
    started(9000, 1, 2, 2, 2, 2, 0, 0, 0),
    ended('ended', 11000, 1, 2),
    ended('stopped', 12000, 1, 0),
    ended('stopped', 12000, 1, 1),
    started(12000, 1, 3, 3, 2, 1, 64, -0.33049481618218124, 426, AMBIENCE_BUS),
  ],
};

/** Every reference vector, its log pinned. */
export const PREVIEW_VECTORS: readonly PreviewVector[] = SPECS.map((spec) => ({
  ...spec,
  events: LOGS[spec.name] ?? [],
}));
