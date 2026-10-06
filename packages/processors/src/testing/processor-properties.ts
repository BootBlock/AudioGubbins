/**
 * The properties every processor is held to (REQ-AUDIO-146, ADR-0061), run by
 * each processor's own test file for the layouts and settings it names:
 * silence, an impulse, full scale, subnormals, NaN and infinity with recovery,
 * programme material, the same bits however the audio is cut into blocks, the
 * same bits from the WebAssembly DSP as from the reference, every quality level
 * running, and, for settings that pass the signal through, the latency it
 * declares.
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
import { wasmDsp } from '@audiogubbins/audio-engine';
import { chirp, noisySine, sine } from '@audiogubbins/test-fixtures';

import type { ProcessorType } from '../framework/processor-type.js';
import { TEST_RATE, processorValues, runProcessor, type RunSettings } from './processor-run.js';

/** What a processor's property tests are run over. */
export interface PropertyCases {
  readonly layouts: readonly ChannelLayout[];
  /** Parameter values by key, each a setting the properties are run at; the defaults are always run. */
  readonly settings?: readonly Readonly<Record<string, ParameterValue>>[];
  /** The largest magnitude its output may reach from a full-scale input. */
  readonly bound?: number;
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
  /** A measurement to give a whole-pass processor's kernel. */
  readonly measured?: readonly number[];
  /**
   * The state an instance holds for a layout and parameter values, such as a
   * noise profile learned for them; made once for each, when first run.
   */
  readonly state?: (
    layout: ChannelLayout,
    values: Readonly<Record<string, ParameterValue>>,
  ) => ProcessorState;
}

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
      ...(cases.measured === undefined ? {} : { measured: cases.measured }),
      ...(cases.state === undefined ? {} : { state: cases.state(layout, values) }),
    };
    return settings;
  };
}

/** Registers the property tests of `type` over `cases`. */
export function processorProperties(type: ProcessorType, cases: PropertyCases): void {
  const settingsList = [{}, ...(cases.settings ?? [])];
  const bound = cases.bound ?? 64;
  describe(`${type.descriptor.label}, held to every processor's properties`, () => {
    for (const layout of cases.layouts) {
      const width = String(channelCount(layout));
      for (const [index, values] of settingsList.entries()) {
        const settings = caseSettings(cases, layout, values);
        const run = (
          input: readonly Float32Array[],
          extra: Partial<RunSettings> = {},
          blocks?: readonly number[],
        ) => runProcessor(type, { ...settings(), ...extra }, input, blocks);
        const label = `${width} channels, settings ${String(index)}`;

        it(`gives silence for silence (${label})`, () => {
          const out = run(signalOf(layout, () => new Float32Array(LENGTH)));
          expect(everyFinite(out)).toBe(true);
          if (cases.silenceStays !== false) expect(largest(out)).toBeLessThanOrEqual(1e-12);
        });

        it(`stays finite and bounded for an impulse, full scale and programme (${label})`, () => {
          const impulse = signalOf(layout, () => {
            const one = new Float32Array(LENGTH);
            one[1_000] = 1;
            return one;
          });
          for (const input of [impulse, fullScale(layout), programme(layout)]) {
            const out = run(input);
            expect(everyFinite(out)).toBe(true);
            expect(largest(out)).toBeLessThanOrEqual(bound);
          }
        });

        it(`hears subnormals as the silence they are (${label})`, () => {
          const out = run(signalOf(layout, () => new Float32Array(LENGTH).fill(1e-41)));
          expect(everyFinite(out)).toBe(true);
          expect(largest(out)).toBeLessThan(1e-6);
        });

        it(`hears NaN and infinity as silence and goes on as if it had (${label})`, () => {
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
          const out = run(spoiled);
          expect(everyFinite(out)).toBe(true);
          expect(sameBits(out, run(silenced))).toBe(true);
        });

        it(`gives the same bits however the audio is cut into blocks (${label})`, () => {
          const input = programme(layout);
          const whole = run(input, {}, [4_096]);
          expect(sameBits(run(input, {}, [1, 7, 128, 333, 4_096]), whole)).toBe(true);
          expect(sameBits(run(input, {}, [64]), whole)).toBe(true);
        });

        it(`gives the WebAssembly DSP's bits from the reference DSP (${label})`, async () => {
          const input = programme(layout);
          const wasm = expectSuccess(wasmDsp(await dspModuleExports()));
          expect(sameBits(run(input, { dsp: wasm }), run(input))).toBe(true);
        });

        if (cases.state !== undefined) {
          it(`runs by the state it holds, which changes what it writes (${label})`, () => {
            const input = programme(layout);
            const { state: _held, ...without } = settings();
            expect(sameBits(run(input), runProcessor(type, without, input))).toBe(false);
          });
        }

        it(`runs at every quality level (${label})`, () => {
          for (const level of NAMED_QUALITY_LEVELS) {
            expect(
              everyFinite(run(programme(layout), { quality: namedQualityMode(level).settings })),
            ).toBe(true);
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
  });
}
