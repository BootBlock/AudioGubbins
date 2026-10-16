/**
 * An edited source going on into a plan that continues its own (ADR-0104, the
 * phase 10 plan's section 6 gate), read by the reference renderer: the source
 * read in order, as the feeder reads it, through the reference DSP.
 *
 * The plan has the shape a game preview's has: an output reading a bus, the bus
 * a chain over an emitter, the emitter a chain over a mix of two lanes, each
 * lane silence around its voices, one voice a member heard through its own
 * chain and the other a member at 44.1 kHz heard converted. Every chain is a
 * one-pole smoother, whose every output frame carries its whole history, so a
 * run made again anywhere is heard; a test sees each run prepared, and each
 * resampler made, through the ports it injects.
 *
 * A game preview's own streams go on alike (ADR-0104): a voice played at a
 * ratio through a varispeed keeps its resampler, and a chain whose smoothing
 * follows the plan's automation keeps its run and takes the new plan's points
 * where the two agree as far as it has run.
 */

import { describe, expect, it } from 'vitest';

import { writeWav } from '@audiogubbins/codecs/testing';
import {
  FailureKind,
  MAXIMUM_QUALITY,
  StandardLayouts,
  VARISPEED_DENOMINATOR,
  automationValueAt,
  derivedSampleCount,
  fail,
  failure,
  sampleRate,
  succeed,
  unsafeBrandId,
  type AssetId,
  type EditPlan,
  type EffectChain,
  type ParameterAutomation,
  type PlanSegment,
  type PlanSource,
  type PlanStream,
  type SampleRate,
} from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';

import { countingDsp } from '../testing/counting-dsp.js';
import { memoryFile } from '../testing/racked-plan.js';
import type { ChainProcessing, ChainRun } from './chain-processing.js';
import { editedSource, type EditedSource } from './edited-source.js';
import { allocateBlock } from './frame-block.js';
import type { MediaEntry } from './plan-content.js';
import { ProcessedStart } from './processed-content.js';

const MONO = StandardLayouts.mono;
const RATE = expectSuccess(sampleRate(48_000));
const MEMBER_RATE = expectSuccess(sampleRate(44_100));
const CHUNK = 512;
/** The old plan's horizon, and the frame the continuation is asked for at. */
const HORIZON = 8_192;
const AT = 3_072;

const SMOOTHING = unsafeBrandId<'ParameterId'>('5e0e0001-0001');
const LATENCY = unsafeBrandId<'ParameterId'>('5e0e0001-0002');
const ASSET_A = unsafeBrandId<'AssetId'>('0000a55e-000a');
const ASSET_B = unsafeBrandId<'AssetId'>('0000a55e-000b');

/** Noise from a seed, exact in single precision, so every frame of every stream differs. */
function noise(seed: number, frames: number): Float32Array {
  let state = seed;
  return Float32Array.from({ length: frames }, () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return Math.fround(state / 2 ** 32 - 0.5);
  });
}

function entry(asset: AssetId, rate: SampleRate, samples: Float32Array): MediaEntry {
  return {
    asset,
    identity: `memory:${asset}`,
    sampleRate: rate,
    channels: 1,
    length: derivedSampleCount(samples.length),
    file: memoryFile(
      new Uint8Array(
        writeWav({ sampleRate: rate, encoding: { kind: 'float', bits: 32 }, channels: [samples] }),
      ),
    ),
  };
}

const MEMBER_A = entry(ASSET_A, RATE, noise(1, 6_000));
const MEMBER_B = entry(ASSET_B, MEMBER_RATE, noise(2, 6_000));
const MEDIA: readonly MediaEntry[] = [MEMBER_A, MEMBER_B];

/** A chain of one smoother, which leaks `smoothing` of its last output into each frame, `latency` frames late. */
function smoother(name: number, smoothing: number, latency = 0): EffectChain {
  return {
    id: unsafeBrandId<'EffectChainId'>(`00000000-c0${String(name).padStart(2, '0')}`),
    slots: [
      {
        kind: 'processor',
        id: unsafeBrandId<'ProcessorId'>(`00000000-0e${String(name).padStart(2, '0')}`),
        typeKey: 'smoother',
        enabled: true,
        soloed: false,
        mix: 1,
        version: { implementation: 1, parameters: 1 },
        values: new Map([
          [SMOOTHING, smoothing],
          [LATENCY, latency],
        ]),
      },
    ],
  };
}

/** The value of `parameter` the chain's one processor holds. */
function valueOf(chain: EffectChain, parameter: typeof SMOOTHING): number {
  const [slot] = chain.slots;
  const value = slot?.kind === 'processor' ? slot.values.get(parameter) : undefined;
  if (typeof value !== 'number') throw new Error('A smoother holds its values.');
  return value;
}

/**
 * The points of the lane of `automation` that moves the smoothing of `chain`'s
 * one processor, or `undefined` where none does.
 */
function smoothingLane(
  chain: EffectChain,
  automation: readonly ParameterAutomation[],
): readonly { readonly frame: number; readonly value: number }[] | undefined {
  const [slot] = chain.slots;
  return automation.find((lane) => lane.processor === slot?.id && lane.parameter === SMOOTHING)
    ?.points;
}

/**
 * Runs smoothers, each prepare counted with the chain it ran and the frame it
 * started at. A smoother whose smoothing a lane of its request's automation
 * moves leaks the lane's value at each frame of the stream it is given, and a
 * kept run takes a continued plan's lane for the same parameter.
 */
function smoothing(): { readonly processing: ChainProcessing; readonly prepared: string[] } {
  const prepared: string[] = [];
  const processing: ChainProcessing = {
    listening: () => succeed({ kind: 'live', partWay: { leadIn: 0, frameGrid: 1 } }),
    measurementBytes: () => succeed(0),
    prepareLive: () =>
      fail(failure('test.no-live-run', FailureKind.Rejected, 'No live run is made here.')),
    prepare: (request) => {
      prepared.push(`${request.chain.id}@${String(request.start)}`);
      const fixed = valueOf(request.chain, SMOOTHING);
      let lane = smoothingLane(request.chain, request.automation ?? []);
      const latency = valueOf(request.chain, LATENCY);
      const late = new Float32Array(latency);
      let last = 0;
      let at = 0;
      const run: ChainRun = {
        latency,
        layout: MONO,
        process: (input, output, frames) => {
          const from = input[0];
          const into = output[0];
          if (from === undefined || into === undefined) return;
          for (let frame = 0; frame < frames; frame += 1) {
            let sample = from[frame] ?? 0;
            if (latency > 0) {
              const delayed = late[at % latency] ?? 0;
              late[at % latency] = sample;
              sample = delayed;
            }
            const leak = lane === undefined ? fixed : automationValueAt(lane, request.start + at);
            at += 1;
            last = Math.fround((1 - leak) * sample + leak * last);
            into[frame] = last;
          }
        },
        setParameter: () => succeed(undefined),
        automate: (automation) => {
          const next = smoothingLane(request.chain, automation);
          if ((next === undefined) !== (lane === undefined)) {
            return fail(
              failure('test.lanes-differ', FailureKind.Rejected, 'It moves other parameters.'),
            );
          }
          lane = next;
          return succeed(undefined);
        },
        release: () => undefined,
      };
      return Promise.resolve(succeed(run));
    },
  };
  return { processing, prepared };
}

function whole(source: PlanSource, start: number, length: number): PlanSegment {
  return {
    source,
    start: derivedSampleCount(start),
    length: derivedSampleCount(length),
    reversed: false,
    stages: [],
  };
}

function silence(length: number): PlanSegment {
  return whole({ kind: 'silence', channels: 1 }, 0, length);
}

/** A voice: `length` frames of stream `stream` from `start`, at half its level. */
function voice(stream: number, start: number, length: number): PlanSegment {
  return {
    ...whole({ kind: 'stream', stream }, start, length),
    stages: [
      { kind: 'gain', from: start, to: start + length, gain: { kind: 'constant', gain: 0.5 } },
    ],
  };
}

/**
 * A voice read straight from member A's file, at half its level: a voice that
 * shares no stream, so nothing it reads is read from elsewhere at once.
 */
function fileVoice(start: number, length: number): PlanSegment {
  return { ...voice(5, start, length), source: { kind: 'media', asset: ASSET_A } };
}

/** A lane: silence around its voices, each at the frame it starts at, to `horizon`. */
function lane(
  voices: readonly { readonly at: number; readonly segment: PlanSegment }[],
  horizon: number,
): PlanStream {
  const segments: PlanSegment[] = [];
  let position = 0;
  for (const { at, segment } of voices) {
    if (at > position) segments.push(silence(at - position));
    segments.push(segment);
    position = at + segment.length;
  }
  if (horizon > position) segments.push(silence(horizon - position));
  return { sampleRate: RATE, layout: MONO, segments };
}

/** The chains of the bus, the emitter and member A's rack. */
interface Chains {
  readonly bus: EffectChain;
  readonly emitter: EffectChain;
  readonly member: EffectChain;
}

const CHAINS: Chains = {
  bus: smoother(1, 0.25),
  emitter: smoother(2, 0.5),
  member: smoother(3, 0.75),
};

/**
 * The preview-shaped plan to `horizon`: 0 the output, 1 the bus, 2 the emitter,
 * 3 and 4 its lanes, 5 member A through its rack, 6 member B at 44.1 kHz, which
 * lane 4 hears converted. Lane 3 sounds member A from frame 512 to 4,512, lane
 * 4 member B from 1,024 to 4,024, and each lane sounds the extra voices given
 * it too.
 */
function programme(
  horizon: number,
  extra: {
    readonly lane3?: readonly { readonly at: number; readonly segment: PlanSegment }[];
    readonly lane4?: readonly { readonly at: number; readonly segment: PlanSegment }[];
    readonly chains?: Chains;
  } = {},
): EditPlan {
  const chains = extra.chains ?? CHAINS;
  const through = (chain: EffectChain) => ({ kind: 'chain' as const, chain, input: MONO });
  return {
    streams: [
      {
        sampleRate: RATE,
        layout: MONO,
        segments: [whole({ kind: 'stream', stream: 1 }, 0, horizon)],
      },
      {
        sampleRate: RATE,
        layout: MONO,
        segments: [whole({ kind: 'stream', stream: 2 }, 0, horizon)],
        processing: through(chains.bus),
      },
      {
        sampleRate: RATE,
        layout: MONO,
        segments: [whole({ kind: 'mix', streams: [3, 4] }, 0, horizon)],
        processing: through(chains.emitter),
      },
      lane([{ at: 512, segment: voice(5, 0, 4_000) }, ...(extra.lane3 ?? [])], horizon),
      lane([{ at: 1_024, segment: voice(6, 0, 3_000) }, ...(extra.lane4 ?? [])], horizon),
      {
        sampleRate: RATE,
        layout: MONO,
        segments: [whole({ kind: 'media', asset: ASSET_A }, 0, 6_000)],
        processing: through(chains.member),
      },
      {
        sampleRate: MEMBER_RATE,
        layout: MONO,
        segments: [whole({ kind: 'media', asset: ASSET_B }, 0, 6_000)],
      },
    ],
  };
}

/** A reading of `plan` as the feeder makes one, and the ports it runs through. */
function reading(plan: EditPlan) {
  const chains = smoothing();
  const dsp = countingDsp();
  const source = expectSuccess(
    editedSource(plan, MEDIA, MONO, dsp.dsp, {
      processing: chains.processing,
      quality: MAXIMUM_QUALITY.settings,
      start: ProcessedStart.Preview,
    }),
  );
  return { source, prepared: chains.prepared, resamplers: dsp.made };
}

/** Frames `[from, to)` of `source`, read in order a chunk at a time, as a feed pump reads them. */
async function read(source: EditedSource, from: number, to: number): Promise<number[]> {
  const heard: number[] = [];
  const block = allocateBlock(MONO, RATE, CHUNK);
  for (let at = from; at < to; at += CHUNK) {
    const got = await source.read(derivedSampleCount(at), block);
    heard.push(...(block.channels[0]?.subarray(0, Math.min(got, to - at)) ?? []));
  }
  return heard;
}

/** Plan `plan` read alone from its start to `to`. */
async function uninterrupted(plan: EditPlan, to: number): Promise<number[]> {
  const alone = reading(plan);
  const heard = await read(alone.source, 0, to);
  alone.source.release();
  return heard;
}

/** `before` read to `at`, continued with `after`, and read on to `to`: what is heard from `at`. */
async function continued(before: EditPlan, after: EditPlan, to: number, at = AT) {
  const playing = reading(before);
  await read(playing.source, 0, at);
  const prepared = [...playing.prepared];
  const resamplers = playing.resamplers();
  const held = expectSuccess(await playing.source.continueWith(after, MEDIA));
  held.take();
  const heard = await read(playing.source, at, to);
  return {
    held,
    heard,
    preparedBefore: prepared,
    preparedAfter: playing.prepared,
    resamplersBefore: resamplers,
    resamplersAfter: playing.resamplers(),
    source: playing.source,
  };
}

const OLD = programme(HORIZON);

describe('an edited source continued with a plan that continues its own (the gate)', () => {
  it('(a) sounds the old plan to its horizon, bit for bit, when the new one differs only after it', async () => {
    const longer = programme(12_288, {
      lane3: [{ at: 9_000, segment: voice(5, 0, 2_000) }],
    });

    const run = await continued(OLD, longer, 12_288);

    expect(run.held.frame).toBe(AT);
    expect(run.held.ended).toBe(false);
    const old = await uninterrupted(OLD, HORIZON);
    expect(run.heard.slice(0, HORIZON - AT)).toEqual(old.slice(AT));
    // And on past the old horizon, it is the new plan as if it had played from the start.
    expect(run.heard).toEqual((await uninterrupted(longer, 12_288)).slice(AT));
    expect(run.source.length).toBe(12_288);
  });

  it('(b) sounds the old plan, bit for bit, up to a voice added after the frame it went on at', async () => {
    const added = 5_000;
    const voiced = programme(HORIZON, {
      lane4: [{ at: added, segment: voice(5, 100, 1_500) }],
    });

    const run = await continued(OLD, voiced, HORIZON);

    const old = await uninterrupted(OLD, HORIZON);
    expect(run.heard.slice(0, added - AT)).toEqual(old.slice(AT, added));
    expect(run.heard.slice(added - AT)).not.toEqual(old.slice(added));
    expect(run.heard).toEqual((await uninterrupted(voiced, HORIZON)).slice(AT));
  });

  it('(c) keeps every sounding voice’s chain run and resampler, and every chain over them, across the change', async () => {
    // The new voice reads its member's file, so no stream it shares is read
    // again from elsewhere, which would start that stream's run again itself.
    const voiced = programme(12_288, {
      lane4: [{ at: 5_000, segment: fileVoice(100, 1_500) }],
    });

    const run = await continued(OLD, voiced, 12_288);

    // Each chain prepared once, at the frame its stream was first read: none again.
    expect(run.preparedBefore).toEqual([
      `${CHAINS.bus.id}@0`,
      `${CHAINS.emitter.id}@0`,
      `${CHAINS.member.id}@0`,
    ]);
    expect(run.preparedAfter).toEqual(run.preparedBefore);
    expect(run.resamplersBefore).toBe(1);
    expect(run.resamplersAfter).toBe(1);
  });
});

describe('an edited source continued with a plan that changes what it has read', () => {
  it('makes afresh, at the frame it goes on from, the run of a chain whose value changed', async () => {
    const louder = programme(HORIZON, { chains: { ...CHAINS, emitter: smoother(2, 0.125) } });

    const run = await continued(OLD, louder, HORIZON);

    // The bus over it has played what the old value made, so its run is made
    // again too; the voices under it keep theirs.
    expect(run.preparedAfter).toEqual([
      ...run.preparedBefore,
      `${CHAINS.bus.id}@${String(AT)}`,
      `${CHAINS.emitter.id}@${String(AT)}`,
    ]);
    expect(run.resamplersAfter).toBe(run.resamplersBefore);
    expect(run.heard).not.toEqual((await uninterrupted(OLD, HORIZON)).slice(AT));
  });

  it('keeps a chain with latency only where the new voice comes after the input it has read ahead', async () => {
    const late = { ...CHAINS, emitter: smoother(2, 0.5, 64) };
    const before = programme(HORIZON, { chains: late });
    // After lane 4's voice ends at 4,024, so a voice fits there at either frame.
    const switched = 4_096;
    const voiceAt = (at: number) =>
      programme(HORIZON, { chains: late, lane4: [{ at, segment: fileVoice(100, 1_500) }] });

    const beyond = await continued(before, voiceAt(switched + 64), HORIZON, switched);
    const within = await continued(before, voiceAt(switched + 63), HORIZON, switched);

    expect(beyond.preparedAfter).toEqual(beyond.preparedBefore);
    expect(beyond.heard).toEqual(
      (await uninterrupted(voiceAt(switched + 64), HORIZON)).slice(switched),
    );
    // The emitter's run had read 64 frames past the switch, so a voice there
    // makes it again, and the bus over it, which has played the emitter's
    // output for the frame before. Made again from the switch, the emitter
    // reads its lanes from there, behind where member A's run had read for
    // it, so that run starts again where lane 3 reads it.
    expect(within.preparedAfter).toEqual([
      ...within.preparedBefore,
      `${late.bus.id}@${String(switched)}`,
      `${late.emitter.id}@${String(switched)}`,
      `${late.member.id}@${String(switched - 512)}`,
    ]);
  });

  it('reads a member’s new file, through a conversion made again, where its file changed under what it had read', async () => {
    const changed = entry(ASSET_B, MEMBER_RATE, noise(3, 6_000));
    let slices = 0;
    const otherB: MediaEntry = {
      ...changed,
      identity: 'memory:other',
      file: {
        size: changed.file.size,
        slice: (start, end) => {
          slices += 1;
          return changed.file.slice(start, end);
        },
      },
    };
    const playing = reading(OLD);
    await read(playing.source, 0, AT);

    const held = expectSuccess(await playing.source.continueWith(OLD, [MEMBER_A, otherB]));
    held.take();
    await read(playing.source, AT, HORIZON);

    expect(playing.resamplers()).toBe(2);
    expect(slices).toBeGreaterThan(0);
  });
});

describe('a continuation held between two reads', () => {
  it('is held at the end of the read under way, and holds the next read until it is dropped', async () => {
    const playing = reading(OLD);
    await read(playing.source, 0, AT);
    const block = allocateBlock(MONO, RATE, CHUNK);
    const underWay = playing.source.read(derivedSampleCount(AT), block);

    const changed = programme(HORIZON, { chains: { ...CHAINS, bus: smoother(1, 0.9) } });
    const held = expectSuccess(await playing.source.continueWith(changed, MEDIA));
    expect(await underWay).toBe(CHUNK);
    expect(held.frame).toBe(AT + CHUNK);
    let next = false;
    const after = playing.source.read(derivedSampleCount(AT + CHUNK), block).then((got) => {
      next = true;
      return got;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(next).toBe(false);

    held.drop();
    await after;
    expect(playing.prepared).toHaveLength(3);
    const rest = await read(playing.source, AT + 2 * CHUNK, HORIZON);
    expect(rest).toEqual((await uninterrupted(OLD, HORIZON)).slice(AT + 2 * CHUNK));
  });

  it('says it was asked for after the source gave its last frame', async () => {
    const playing = reading(OLD);
    await read(playing.source, 0, HORIZON);

    const held = expectSuccess(await playing.source.continueWith(programme(12_288), MEDIA));
    held.drop();

    expect(held.frame).toBe(HORIZON);
    expect(held.ended).toBe(true);
  });

  it('refuses a plan at another rate, and a plan its files cannot give, before holding any read', async () => {
    const playing = reading(OLD);
    const slower: EditPlan = {
      streams: [
        {
          sampleRate: MEMBER_RATE,
          layout: MONO,
          segments: [whole({ kind: 'media', asset: ASSET_B }, 0, 100)],
        },
      ],
    };
    const elsewhere = unsafeBrandId<'AssetId'>('0000a55e-0000');
    const unread: EditPlan = {
      streams: [
        {
          sampleRate: RATE,
          layout: MONO,
          segments: [whole({ kind: 'media', asset: elsewhere }, 0, 10)],
        },
      ],
    };

    expect(expectFailureCode(await playing.source.continueWith(slower, MEDIA))).toBe(
      'pcm.continuation-shape',
    );
    expect(expectFailureCode(await playing.source.continueWith(unread, MEDIA))).toBe(
      'editing.plan-malformed',
    );
    expect(await read(playing.source, 0, CHUNK)).toHaveLength(CHUNK);
  });
});

/** The emitter's smoothing moved along the stream by `points`. */
function moving(points: readonly (readonly [number, number])[]): readonly ParameterAutomation[] {
  const [slot] = CHAINS.emitter.slots;
  if (slot?.kind !== 'processor') throw new Error('The emitter’s chain has its smoother.');
  return [
    {
      processor: slot.id,
      parameter: SMOOTHING,
      points: points.map(([frame, value]) => ({ frame, value })),
    },
  ];
}

/** The programme with its emitter's smoothing moved by `automation`. */
function automatedProgramme(
  horizon: number,
  automation: readonly ParameterAutomation[],
  lane3: readonly { readonly at: number; readonly segment: PlanSegment }[] = [],
): EditPlan {
  const [output, bus, emitter, ...rest] = programme(horizon, { lane3 }).streams;
  if (emitter?.processing?.kind !== 'chain' || bus === undefined) {
    throw new Error('The programme’s emitter runs its chain.');
  }
  return {
    streams: [
      output,
      bus,
      { ...emitter, processing: { ...emitter.processing, automation } },
      ...rest,
    ],
  };
}

describe('an edited source continued with a plan whose chain is automated', () => {
  const SWEEP: readonly (readonly [number, number])[] = [
    [0, 0.5],
    [4_096, 0.125],
    [8_192, 0.75],
  ];

  it('keeps the run of a chain whose automation goes on past the old horizon, and takes its new points', async () => {
    const before = automatedProgramme(HORIZON, moving(SWEEP));
    const after = automatedProgramme(12_288, moving([...SWEEP, [12_288, 0.25]]), [
      { at: 9_000, segment: fileVoice(0, 2_000) },
    ]);

    const run = await continued(before, after, 12_288);

    expect(run.preparedAfter).toEqual(run.preparedBefore);
    expect(run.heard).toEqual((await uninterrupted(after, 12_288)).slice(AT));
    // The new point is heard: without it the old lane holds its last value.
    expect(run.heard).not.toEqual(
      (
        await uninterrupted(
          automatedProgramme(12_288, moving(SWEEP), [{ at: 9_000, segment: fileVoice(0, 2_000) }]),
          12_288,
        )
      ).slice(AT),
    );
  });

  it('makes the run afresh where the automation changes before where it has run', async () => {
    const before = automatedProgramme(HORIZON, moving(SWEEP));
    const after = automatedProgramme(
      HORIZON,
      moving([
        [0, 0.5],
        [2_048, 0.25],
        [8_192, 0.75],
      ]),
    );

    const run = await continued(before, after, HORIZON);

    expect(run.preparedAfter).toEqual([
      ...run.preparedBefore,
      `${CHAINS.bus.id}@${String(AT)}`,
      `${CHAINS.emitter.id}@${String(AT)}`,
    ]);
  });
});

/** The rate of a varispeed voice: 5,000 / 4,096, about 345 cents up. */
const RATIO = 5_000;

/**
 * A pitched programme to `horizon`: 0 the output, 1 an emitter's chain over 2,
 * its lane, which sounds 3, member A played at `ratio` through a varispeed, from
 * frame 256 to its end, and any `extra` voices; 4 member A's file.
 */
function pitchedProgramme(
  horizon: number,
  ratio = RATIO,
  extra: readonly { readonly at: number; readonly segment: PlanSegment }[] = [],
): EditPlan {
  const played = Math.ceil((6_000 * VARISPEED_DENOMINATOR) / ratio);
  return {
    streams: [
      {
        sampleRate: RATE,
        layout: MONO,
        segments: [whole({ kind: 'stream', stream: 1 }, 0, horizon)],
      },
      {
        sampleRate: RATE,
        layout: MONO,
        segments: [whole({ kind: 'stream', stream: 2 }, 0, horizon)],
        processing: { kind: 'chain', chain: CHAINS.emitter, input: MONO },
      },
      lane([{ at: 256, segment: voice(3, 0, played) }, ...extra], horizon),
      {
        sampleRate: RATE,
        layout: MONO,
        segments: [whole({ kind: 'stream', stream: 4 }, 0, 6_000)],
        processing: { kind: 'varispeed', numerator: ratio, denominator: VARISPEED_DENOMINATOR },
      },
      {
        sampleRate: RATE,
        layout: MONO,
        segments: [whole({ kind: 'media', asset: ASSET_A }, 0, 6_000)],
      },
    ],
  };
}

describe('an edited source continued with a plan that plays a voice at a ratio', () => {
  it('keeps the varispeed of a voice sounding across the change, and sounds the new plan bit for bit', async () => {
    const added = pitchedProgramme(12_288, RATIO, [{ at: 9_000, segment: fileVoice(0, 2_000) }]);

    const run = await continued(pitchedProgramme(HORIZON), added, 12_288);

    expect(run.resamplersBefore).toBe(1);
    expect(run.resamplersAfter).toBe(1);
    expect(run.preparedAfter).toEqual(run.preparedBefore);
    expect(run.heard).toEqual((await uninterrupted(added, 12_288)).slice(AT));
  });

  it('makes the varispeed afresh where its ratio changed, from the frame it goes on at', async () => {
    const lower = pitchedProgramme(HORIZON, 4_000);

    const run = await continued(pitchedProgramme(HORIZON), lower, HORIZON);

    expect(run.resamplersAfter).toBe(run.resamplersBefore + 1);
    expect(run.preparedAfter).toEqual([
      ...run.preparedBefore,
      `${CHAINS.emitter.id}@${String(AT)}`,
    ]);
  });
});
