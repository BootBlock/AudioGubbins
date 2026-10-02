/**
 * The deterministic test assets an editor view opens (the packet's
 * user-visible outcome), each a signal recipe (ADR-0045): a few hundred bytes
 * that the feeder, render and peak workers each make the same frames from, so
 * the three-hour session is never held anywhere and a test can name any frame
 * of any asset exactly.
 *
 * Each exercises something the editor must get right: tone bursts and a
 * full-scale impulse for zooming to single samples and seeing clipping, a 5.1
 * set that names each channel in turn, a first-order ambisonic set, a stereo
 * session of three hours for scale, and a loop whose markers and looped region
 * are the content snapping and the strip draw (ADR-0047).
 */

import {
  FIRST_ORDER_AMBIX,
  StandardLayouts,
  ambisonicLayout,
  channelCount,
  combine,
  createDeterministicIdGenerator,
  fail,
  failure,
  FailureKind,
  flatMapResult,
  mapResult,
  sampleCount,
  sampleRate,
  succeed,
  type ChannelLayout,
  type DomainResult,
  type PlacedMarker,
  type PlacedRegion,
  type SampleRate,
  ZERO_SAMPLES,
} from '@audiogubbins/domain';
import { PcmDescriptionKind, signalRecipe } from '@audiogubbins/audio-engine';

import { revisionOf, type EditorAsset } from './editor-asset.js';

/** The rate every test asset is made at, its native one. */
const RATE = 48_000;

type SegmentSpec =
  | { readonly kind: 'silence'; readonly length: number }
  | { readonly kind: 'impulse'; readonly length: number; readonly amplitude: number }
  | {
      readonly kind: 'tone';
      readonly length: number;
      readonly frequency: number;
      readonly amplitude: number;
    };

interface ProgrammeSpec {
  readonly segments: readonly SegmentSpec[];
  readonly repeats: boolean;
}

interface RegionSpec {
  readonly name: string;
  readonly start: number;
  readonly length: number;
  readonly loop?: { readonly start: number; readonly end: number };
}

/** A test asset as written here, in frames at {@link RATE}, before it is checked. */
interface AssetSpec {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly layout: DomainResult<ChannelLayout>;
  readonly length: number;
  readonly channels: readonly ProgrammeSpec[];
  readonly markers?: readonly { readonly name: string; readonly at: number }[];
  readonly regions?: readonly RegionSpec[];
}

const seconds = (value: number): number => Math.round(value * RATE);
const silence = (length: number): SegmentSpec => ({ kind: 'silence', length });
const impulse = (length: number, amplitude: number): SegmentSpec => ({
  kind: 'impulse',
  length,
  amplitude,
});
const tone = (length: number, frequency: number, amplitude: number): SegmentSpec => ({
  kind: 'tone',
  length,
  frequency,
  amplitude,
});
const repeating = (...segments: SegmentSpec[]): ProgrammeSpec => ({ segments, repeats: true });
const once = (...segments: SegmentSpec[]): ProgrammeSpec => ({ segments, repeats: false });

/** Each channel of a 5.1 set sounds alone for two seconds, in layout order, at its own pitch. */
const IDENTIFICATION_PITCHES: readonly number[] = [500, 600, 700, 50, 800, 900];
const IDENTIFICATION_TURN = seconds(2);

/**
 * The loop's tone: 375 Hz is 128 frames a cycle at 48 kHz, so every loop point
 * placed on a multiple of 128 frames from the tone's start joins in phase.
 */
const LOOP_PITCH = 375;
const LOOP_ATTACK = 4800;
const LOOP_BODY = seconds(5);

const SPECS: readonly AssetSpec[] = [
  {
    key: 'test:tone-bursts',
    name: 'Tone bursts',
    description:
      'Ten seconds of stereo tone bursts at different pitches and levels, with a full-scale impulse on the left.',
    layout: succeed(StandardLayouts.stereo),
    length: seconds(10),
    channels: [
      repeating(
        tone(seconds(0.5), 440, 0.8),
        silence(seconds(0.25)),
        tone(seconds(0.25), 880, 0.5),
        silence(seconds(0.25)),
        impulse(seconds(0.25), 1),
        silence(seconds(0.5)),
      ),
      repeating(
        silence(seconds(0.25)),
        tone(seconds(0.75), 330, 0.6),
        silence(seconds(0.5)),
        tone(seconds(0.5), 1000, 0.3),
      ),
    ],
  },
  {
    key: 'test:channel-identification-5.1',
    name: '5.1 channel identification',
    description:
      'Each channel of a 5.1 set sounds alone for two seconds in turn, left, right, centre, low-frequency effects, surround left and surround right.',
    layout: succeed(StandardLayouts.surround5_1),
    length: IDENTIFICATION_TURN * IDENTIFICATION_PITCHES.length,
    channels: IDENTIFICATION_PITCHES.map((pitch, index) => {
      const before = index * IDENTIFICATION_TURN;
      const after = (IDENTIFICATION_PITCHES.length - index - 1) * IDENTIFICATION_TURN;
      return once(
        ...(before > 0 ? [silence(before)] : []),
        tone(IDENTIFICATION_TURN, pitch, 0.5),
        ...(after > 0 ? [silence(after)] : []),
      );
    }),
  },
  {
    key: 'test:ambisonic-first-order',
    name: 'First-order ambisonic set',
    description:
      'Eight seconds of a first-order AmbiX set: a steady omnidirectional component and three directional ones that come and go.',
    layout: ambisonicLayout(FIRST_ORDER_AMBIX),
    length: seconds(8),
    channels: [
      once(tone(seconds(8), 440, 0.5)),
      repeating(tone(seconds(2), 440, 0.5), silence(seconds(2))),
      repeating(silence(seconds(4)), tone(seconds(2), 440, 0.35), silence(seconds(2))),
      repeating(silence(seconds(2)), tone(seconds(2), 440, 0.5)),
    ],
  },
  {
    key: 'test:long-session',
    name: 'Three-hour session',
    description:
      'Three hours of stereo programme, for scrolling and zooming across a long file whose waveform fills in as it is made.',
    layout: succeed(StandardLayouts.stereo),
    length: seconds(3 * 60 * 60),
    channels: [
      repeating(
        tone(seconds(1), 220, 0.5),
        silence(seconds(0.5)),
        tone(seconds(0.25), 1760, 0.3),
        silence(seconds(0.25)),
      ),
      repeating(silence(seconds(0.5)), tone(seconds(1), 330, 0.4), silence(seconds(0.5))),
    ],
  },
  {
    key: 'test:loop',
    name: 'Loop with markers',
    description:
      'Six seconds of stereo: an attack, a sustained tone whose looped region joins in phase, and a silent tail, with markers at each.',
    layout: succeed(StandardLayouts.stereo),
    length: seconds(6),
    channels: [
      once(impulse(LOOP_ATTACK, 0.9), tone(LOOP_BODY, LOOP_PITCH, 0.5)),
      once(impulse(LOOP_ATTACK, 0.9), tone(LOOP_BODY, LOOP_PITCH * 2, 0.4)),
    ],
    markers: [
      { name: 'Attack', at: 0 },
      { name: 'Sustain', at: LOOP_ATTACK },
      { name: 'Release', at: LOOP_ATTACK + LOOP_BODY },
    ],
    regions: [
      {
        name: 'Sustained loop',
        start: LOOP_ATTACK,
        length: LOOP_BODY,
        loop: { start: 128 * 375, end: 128 * 1500 },
      },
      {
        name: 'Tail',
        start: LOOP_ATTACK + LOOP_BODY,
        length: seconds(6) - LOOP_ATTACK - LOOP_BODY,
      },
    ],
  },
];

function markersOf(spec: AssetSpec, seed: number): DomainResult<readonly PlacedMarker[]> {
  const ids = createDeterministicIdGenerator(seed);
  return combine(
    (spec.markers ?? []).map((marker) =>
      mapResult(sampleCount(marker.at), (position) => ({
        id: ids.next<'MarkerId'>(),
        displayName: marker.name,
        position,
      })),
    ),
  );
}

function regionOf(region: RegionSpec, id: PlacedRegion['id']): DomainResult<PlacedRegion> {
  return flatMapResult(sampleCount(region.start), (start) =>
    flatMapResult(sampleCount(region.length), (length): DomainResult<PlacedRegion> => {
      const base = { id, displayName: region.name, start, length, tags: [] };
      const loop = region.loop;
      if (loop === undefined) return succeed(base);
      return flatMapResult(sampleCount(loop.start), (loopStart) =>
        mapResult(sampleCount(loop.end), (loopEnd) => ({
          ...base,
          loop: { loopStart, loopEnd, crossfadeLength: ZERO_SAMPLES },
        })),
      );
    }),
  );
}

function regionsOf(spec: AssetSpec, seed: number): DomainResult<readonly PlacedRegion[]> {
  const ids = createDeterministicIdGenerator(seed);
  return combine((spec.regions ?? []).map((region) => regionOf(region, ids.next<'RegionId'>())));
}

/** A recipe whose channels do not match its layout, which no asset here should have. */
function mismatchedChannels(spec: AssetSpec, layout: ChannelLayout): DomainResult<never> {
  return fail(
    failure(
      'test-asset.channels-mismatched',
      FailureKind.IntegrityViolation,
      `The test asset "${spec.name}" describes ${String(spec.channels.length)} channels for a layout of ${String(channelCount(layout))}.`,
    ),
  );
}

function assetOf(spec: AssetSpec, rate: SampleRate, seed: number): DomainResult<EditorAsset> {
  return flatMapResult(spec.layout, (layout) => {
    if (channelCount(layout) !== spec.channels.length) return mismatchedChannels(spec, layout);
    return flatMapResult(signalRecipe({ channels: spec.channels, length: spec.length }), (recipe) =>
      flatMapResult(markersOf(spec, seed), (markers) =>
        mapResult(regionsOf(spec, seed + 1), (regions) => ({
          id: spec.key,
          name: spec.name,
          description: spec.description,
          sampleRate: rate,
          layout,
          length: recipe.length,
          revision: revisionOf(JSON.stringify({ rate, recipe })),
          describe: () => ({ kind: PcmDescriptionKind.Signal, sampleRate: rate, recipe }),
          markers,
          regions,
        })),
      ),
    );
  });
}

/**
 * Every test asset, checked by the rules any recipe and position are held to,
 * or every reason one of them could not be made.
 */
export function testAssets(): DomainResult<readonly EditorAsset[]> {
  return flatMapResult(sampleRate(RATE), (rate) =>
    combine(SPECS.map((spec, index) => assetOf(spec, rate, 1000 * (index + 1)))),
  );
}
