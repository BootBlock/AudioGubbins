/**
 * The properties every processor is held to (REQ-AUDIO-146, ADR-0061): silence,
 * an impulse, full scale, subnormals, NaN and infinity with recovery, programme
 * material, the same bits however the audio is cut into blocks, the same bits
 * from the WebAssembly DSP as from the reference, every quality level running,
 * and, for settings that pass the signal through, the latency it declares, and
 * for a kernel with feedback, a tail that falls to exact zero. A whole-pass
 * processor is run as the rack runs it: its pass over the input first, in the
 * blocks the kernel is given, and its kernel given what the pass answered. Each
 * processor's own `<name>.properties.test.ts` runs them for the layouts and
 * settings it names, and registers nothing else, so `pnpm test:dsp-property`
 * selects them by that name and `catalogue-properties.test.ts` counts the types
 * they hold.
 */

import { describe, expect, it } from 'vitest';

import {
  MAXIMUM_QUALITY,
  NAMED_QUALITY_LEVELS,
  channelCount,
  namedQualityMode,
  type ChannelLayout,
  type ParameterValue,
  type ProcessorState,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { dspModuleExports, fingerprint } from '@audiogubbins/audio-engine/testing';
import { REFERENCE_DSP, wasmDsp, type CanonicalDsp } from '@audiogubbins/audio-engine';
import { chirp, noisySine, sine } from '@audiogubbins/test-fixtures';

import type { ProcessorType } from '../framework/processor-type.js';
import { modelPassOf, passOver } from './model-runs.js';
import { TEST_RATE, processorValues, runProcessor, type RunSettings } from './processor-run.js';

/** What a processor's property tests are run over. */
export interface PropertyCases {
  readonly layouts: readonly ChannelLayout[];
  /** Parameter values by key, each a setting the properties are run at; the defaults are always run. */
  readonly settings?: readonly Readonly<Record<string, ParameterValue>>[];
  /** The largest magnitude its output may reach from a full-scale input. */
  readonly bound?: number;
  /**
   * Whether its runs reach the canonical DSP, so the WebAssembly module's bits
   * are held to the reference path's; a type that does not is held to reaching
   * none, so the declaration cannot be wrong either way.
   */
  readonly readsDsp?: boolean;
  /** Whether silence in is silence out, as it is for all but a generator. */
  readonly silenceStays?: boolean;
  /**
   * Parameter values at which it passes its input through, delayed by its
   * latency, within `tolerance`: run with no measurement and no state.
   */
  readonly passThrough?: {
    readonly values: Readonly<Record<string, ParameterValue>>;
    readonly tolerance: number;
  };
  /**
   * For a kernel whose output carries its feedback, parameter values at which
   * an impulse's tail has fallen to exact zero by `frames`, worked out from
   * the slowest decay of its output by `framesToSilence` (`tail-measures.ts`).
   */
  readonly fallsSilent?: {
    readonly values: Readonly<Record<string, ParameterValue>>;
    readonly frames: number;
  };
  /**
   * The state an instance holds for a layout and parameter values, such as a
   * noise profile learned for them; made once for each, when first run.
   */
  readonly state?: (
    layout: ChannelLayout,
    values: Readonly<Record<string, ParameterValue>>,
  ) => ProcessorState;
}

/** The frames after {@link PropertyCases.fallsSilent}'s that must all be zero. */
const SILENT_FRAMES = 4_096;

/** One second of each channel of `layout` from `make`, each channel distinct. */
function signalOf(layout: ChannelLayout, make: (channel: number) => Float32Array): Float32Array[] {
  return layout.roles.map((_, channel) => make(channel));
}

const LENGTH = TEST_RATE / 2;

function programme(layout: ChannelLayout): Float32Array[] {
  return signalOf(layout, (channel) => {
    const source =
      channel % 2 === 0 ? noisySine(440 + channel * 110).channels[0] : chirp().channels[0];
    return (source ?? new Float32Array(LENGTH)).slice(0, LENGTH);
  });
}

function fullScale(layout: ChannelLayout): Float32Array[] {
  return signalOf(layout, (channel) => {
    const tone = sine(997 + channel * 3, { amplitude: 1 }).channels[0] ?? new Float32Array(LENGTH);
    const out = tone.slice(0, LENGTH);
    // The second half a square at full scale, the hardest edge a stage meets.
    for (let frame = LENGTH / 2; frame < LENGTH; frame += 1)
      out[frame] = (frame & 64) === 0 ? 1 : -1;
    return out;
  });
}

function everyFinite(channels: readonly Float32Array[]): boolean {
  return channels.every((channel) => channel.every((sample) => Number.isFinite(sample)));
}

function largest(channels: readonly Float32Array[]): number {
  let most = 0;
  for (const channel of channels)
    for (const sample of channel) most = Math.max(most, Math.abs(sample));
  return most;
}

function sameBits(left: readonly Float32Array[], right: readonly Float32Array[]): boolean {
  return (
    left.length === right.length &&
    left.every((channel, index) => {
      const other = right[index];
      return other !== undefined && fingerprint(channel) === fingerprint(other);
    })
  );
}

/**
 * The output of `type` for `input` at `settings`, in blocks whose sizes
 * cycle through `blocks`: for a whole-pass type, its pass over the input
 * first, its kernel given what the pass answered, as the rack runs it.
 */
async function runCase(
  type: ProcessorType,
  settings: RunSettings,
  input: readonly Float32Array[],
  blocks?: readonly number[],
): Promise<Float32Array[]> {
  if (type.measurer === undefined) return runProcessor(type, settings, input, blocks);
  const measured = await passOver(modelPassOf(type, settings), input, blocks);
  return runProcessor(type, { ...settings, measured: expectSuccess(measured) }, input, blocks);
}

/** The reference DSP, and whether any of its functions was called through it. */
function recordingDsp(): { readonly dsp: CanonicalDsp; reached(): boolean } {
  let reached = false;
  const mark = <T>(answer: T): T => {
    reached = true;
    return answer;
  };
  const dsp: CanonicalDsp = {
    implementation: REFERENCE_DSP.implementation,
    sineOfTurns: (turns) => mark(REFERENCE_DSP.sineOfTurns(turns)),
    createOscillator: (settings) => mark(REFERENCE_DSP.createOscillator(settings)),
    createResampler: (settings) => mark(REFERENCE_DSP.createResampler(settings)),
    createFft: (size) => mark(REFERENCE_DSP.createFft(size)),
    createStft: (settings) => mark(REFERENCE_DSP.createStft(settings)),
    createPeakMeter: (settings) => mark(REFERENCE_DSP.createPeakMeter(settings)),
    createLoudnessMeter: (settings) => mark(REFERENCE_DSP.createLoudnessMeter(settings)),
    createDetectorFeatures: (settings) => mark(REFERENCE_DSP.createDetectorFeatures(settings)),
  };
  return { dsp, reached: () => reached };
}

/** The settings `cases` give a run of `layout` at `values`, its state made once. */
function caseSettings(
  cases: PropertyCases,
  layout: ChannelLayout,
  values: Readonly<Record<string, ParameterValue>>,
): () => RunSettings {
  let settings: RunSettings | undefined;
  return () => {
    settings ??= {
      layout,
      values,
      ...(cases.state === undefined ? {} : { state: cases.state(layout, values) }),
    };
    return settings;
  };
}

/** Registers the property tests of `type` over `cases`. */
export function processorProperties(type: ProcessorType, cases: PropertyCases): void {
  const settingsList = [{}, ...(cases.settings ?? [])];
  const bound = cases.bound ?? 64;
  // A type held both without state and with it would otherwise give two
  // groups of the same tests the same names.
  const holding = cases.state === undefined ? '' : ' with the state it holds';
  // A whole pass that runs a model's transforms in TypeScript takes seconds
  // a run over several channels, and several times as long under the whole
  // suite's load, so it is given a budget of its own rather than Vitest's
  // five-second default.
  const budget = type.measurer === undefined ? {} : { timeout: 60_000 };
  describe(
    `${type.descriptor.label}${holding}, held to every processor's properties`,
    budget,
    () => {
      for (const layout of cases.layouts) {
        const width = String(channelCount(layout));
        for (const [index, values] of settingsList.entries()) {
          const settings = caseSettings(cases, layout, values);
          const run = (
            input: readonly Float32Array[],
            extra: Partial<RunSettings> = {},
            blocks?: readonly number[],
          ) => runCase(type, { ...settings(), ...extra }, input, blocks);
          const label = `${width} channels, settings ${String(index)}`;

          it(`gives silence for silence (${label})`, async () => {
            const out = await run(signalOf(layout, () => new Float32Array(LENGTH)));
            expect(everyFinite(out)).toBe(true);
            if (cases.silenceStays !== false) expect(largest(out)).toBeLessThanOrEqual(1e-12);
          });

          it(`stays finite and bounded for an impulse, full scale and programme (${label})`, async () => {
            const impulse = signalOf(layout, () => {
              const one = new Float32Array(LENGTH);
              one[1_000] = 1;
              return one;
            });
            for (const input of [impulse, fullScale(layout), programme(layout)]) {
              const out = await run(input);
              expect(everyFinite(out)).toBe(true);
              expect(largest(out)).toBeLessThanOrEqual(bound);
            }
          });

          it(`hears subnormals as the silence they are (${label})`, async () => {
            const out = await run(signalOf(layout, () => new Float32Array(LENGTH).fill(1e-41)));
            expect(everyFinite(out)).toBe(true);
            expect(largest(out)).toBeLessThan(1e-6);
          });

          it(`hears NaN and infinity as silence and goes on as if it had (${label})`, async () => {
            const clean = programme(layout);
            const spoiled = clean.map((channel) => channel.slice());
            const silenced = clean.map((channel) => channel.slice());
            for (const [channel, samples] of spoiled.entries()) {
              for (let frame = 4_000; frame < 4_100; frame += 1) {
                samples[frame] =
                  frame % 3 === 0 ? Number.NaN : frame % 3 === 1 ? Infinity : -Infinity;
                const quiet = silenced[channel];
                if (quiet !== undefined) quiet[frame] = 0;
              }
            }
            const out = await run(spoiled);
            expect(everyFinite(out)).toBe(true);
            expect(sameBits(out, await run(silenced))).toBe(true);
          });

          it(`gives the same bits however the audio is cut into blocks (${label})`, async () => {
            const input = programme(layout);
            const whole = await run(input, {}, [4_096]);
            expect(sameBits(await run(input, {}, [1, 7, 128, 333, 4_096]), whole)).toBe(true);
            expect(sameBits(await run(input, {}, [64]), whole)).toBe(true);
          });

          if (cases.readsDsp === true) {
            it(`gives the WebAssembly DSP's bits from the reference DSP (${label})`, async () => {
              const input = programme(layout);
              const recording = recordingDsp();
              const reference = await run(input, { dsp: recording.dsp });
              expect(recording.reached()).toBe(true);
              const wasm = expectSuccess(wasmDsp(await dspModuleExports()));
              expect(sameBits(await run(input, { dsp: wasm }), reference)).toBe(true);
            });
          } else {
            it(`reaches no canonical DSP, so no DSP can change its bits (${label})`, async () => {
              const recording = recordingDsp();
              await run(programme(layout), { dsp: recording.dsp });
              expect(recording.reached()).toBe(false);
            });
          }

          if (cases.state !== undefined) {
            it(`runs by the state it holds, which changes what it writes (${label})`, async () => {
              const input = programme(layout);
              const { state: _held, ...without } = settings();
              expect(sameBits(await run(input), await runCase(type, without, input))).toBe(false);
            });
          }

          it(`runs at every quality level (${label})`, async () => {
            for (const level of NAMED_QUALITY_LEVELS) {
              const quality = namedQualityMode(level).settings;
              expect(everyFinite(await run(programme(layout), { quality }))).toBe(true);
            }
          });
        }

        const silent = cases.fallsSilent;
        if (silent !== undefined) {
          it(`falls to exact zero once its tail has decayed below silence (${width} channels)`, async () => {
            const impulse = signalOf(layout, () => {
              const one = new Float32Array(silent.frames + SILENT_FRAMES);
              one[0] = 1;
              return one;
            });
            const out = await runCase(type, { layout, values: silent.values }, impulse, [4_096]);
            for (const samples of out) {
              const last = samples.findLastIndex((sample) => sample !== 0);
              expect(last).toBeGreaterThan(0);
              expect(last).toBeLessThan(silent.frames);
            }
          });
        }

        const through = cases.passThrough;
        if (through !== undefined) {
          it(`passes its input through, delayed by the latency it declares (${width} channels)`, () => {
            const input = programme(layout);
            const out = runProcessor(type, { layout, values: through.values }, input);
            const latency = type.descriptor.latency({
              values: processorValues(type, through.values),
              sampleRate: TEST_RATE,
              quality: MAXIMUM_QUALITY.settings,
            });
            if (latency.kind !== 'known') throw new Error('A processor states its latency.');
            const delay = latency.frames;
            for (const [channel, samples] of out.entries()) {
              const source = input[channel] ?? new Float32Array(0);
              let worst = 0;
              for (let frame = 0; frame < samples.length; frame += 1) {
                const expected = frame < delay ? 0 : (source[frame - delay] ?? 0);
                worst = Math.max(worst, Math.abs((samples[frame] ?? 0) - expected));
              }
              expect(worst).toBeLessThanOrEqual(through.tolerance);
            }
          });
        }
      }
    },
  );
}
