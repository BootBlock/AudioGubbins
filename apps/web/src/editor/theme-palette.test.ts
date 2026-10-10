/**
 * The editor's canvas colours against the theme they are taken from: every
 * piece of text a view's frame writes is readable on what the frame draws under
 * it, in both themes, at both contrast levels, at every accent and across the
 * whole brightness range (REQ-UX-070, ADR-0012).
 *
 * What is under each label is read from composed frames, not from a list of
 * pairs, so a label that moves onto another surface is checked where it now is.
 * Each display mode is composed with its peaks known and still pending, with a
 * region and a marker in the strip and labelled ticks on the ruler; the
 * rectangles that cover the label's first letters are laid over the clear
 * colour in the order they are drawn, as the renderer blends them. The waveform
 * itself, and a selection a person has made, are what the labels are written
 * over rather than behind, and neither is in the frames composed.
 */

import { describe, expect, it } from 'vitest';

import {
  ACCENT_NAMES,
  BRIGHTNESS_RANGE,
  ContrastLevel,
  ContrastRequirement,
  DEFAULT_THEME_PREFERENCES,
  ThemeMode,
  UNKNOWN_SYSTEM_APPEARANCE,
  contrastRatio,
  resolveTheme,
  srgbToOklch,
} from '@audiogubbins/design-system';
import { sampleCount, unsafeBrandId, type SampleCount } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import {
  DisplayMode,
  FrameComposer,
  layoutView,
  newViewState,
  type EditorPalette,
  type KnownAudio,
  type ViewScene,
} from '@audiogubbins/editor-view';
import type { Colour, RenderFrame, TextLabel } from '@audiogubbins/renderer';
import { EMPTY_SELECTION } from '@audiogubbins/timeline';

import { editorPaletteOf, editorTypeOf } from './theme-palette.js';

const at = (value: number): SampleCount => expectSuccess(sampleCount(value));

const LENGTH = 48_000;
const WIDTH = 800;
const HEIGHT = 400;

/** Twenty-one steps across the brightness range, both ends included. */
const BRIGHTNESS_STEPS = Array.from(
  { length: 21 },
  (_, index) =>
    BRIGHTNESS_RANGE.minimum + (index * (BRIGHTNESS_RANGE.maximum - BRIGHTNESS_RANGE.minimum)) / 20,
);

/** Peaks known, as silence, and not yet known. */
const AUDIO: Readonly<Record<string, KnownAudio>> = {
  known: {
    pyramid: undefined,
    buckets: undefined,
    samples: { start: 0, channels: [new Float32Array(LENGTH), new Float32Array(LENGTH)] },
    length: at(LENGTH),
  },
  pending: { pyramid: undefined, buckets: undefined, samples: undefined, length: at(LENGTH) },
};

/** A frame of a two-channel view in `mode`, with a region, a marker and ruler labels. */
function frameOf(
  palette: EditorPalette,
  mode: DisplayMode,
  audio: KnownAudio,
  type: ViewScene['type'],
): RenderFrame {
  const state = { ...newViewState(at(LENGTH), WIDTH), displayMode: mode };
  const scene: ViewScene = {
    layout: layoutView(state, WIDTH, HEIGHT, 2, false),
    state,
    pixelRatio: 1,
    content: {
      length: at(LENGTH),
      channelNames: ['Left', 'Right'],
      markers: [
        { id: unsafeBrandId<'MarkerId'>('m'), displayName: 'Release', position: at(36_000) },
      ],
      regions: [
        {
          id: unsafeBrandId<'RegionId'>('r'),
          displayName: 'Sustained loop',
          start: at(4_800),
          length: at(24_000),
          tags: [],
        },
      ],
      spectralEdits: [],
    },
    audio,
    // Written where a spectrogram lane says why it is not drawn, as the
    // lane's frequency labels are, over the lane's background.
    spectrogram: { kind: 'not-drawn', reason: 'The spectrogram worker stopped.' },
    selection: EMPTY_SELECTION,
    playhead: undefined,
    preview: undefined,
    snap: undefined,
    ruler: {
      major: [
        { position: at(0), label: '0:00.000' },
        { position: at(24_000), label: '0:00.500' },
      ],
      minor: [],
    },
    grid: undefined,
    picture: [],
    palette,
    type,
  };
  return new FrameComposer().compose(scene);
}

/** A point inside the first letters of `label`, by how it is aligned. */
function insideOf(label: TextLabel): { readonly x: number; readonly y: number } {
  const x = label.align === 'left' ? label.x + 3 : label.align === 'right' ? label.x - 3 : label.x;
  const y =
    label.baseline === 'top' ? label.y + 5 : label.baseline === 'bottom' ? label.y - 5 : label.y;
  return { x, y };
}

/** `over` blended onto the opaque `under`, as the renderer blends a batch. */
function blended(under: Colour, over: Colour): Colour {
  const alpha = over[3];
  return [
    over[0] * alpha + under[0] * (1 - alpha),
    over[1] * alpha + under[1] * (1 - alpha),
    over[2] * alpha + under[2] * (1 - alpha),
    1,
  ];
}

/** What the frame's geometry shows at a point: every rectangle over it, laid over the clear colour. */
function geometryAt(frame: RenderFrame, point: { readonly x: number; readonly y: number }): Colour {
  let shown: Colour = frame.clear;
  for (const layer of frame.layers) {
    const clip = layer.clip;
    if (
      clip !== undefined &&
      (point.x < clip.x ||
        point.x >= clip.x + clip.width ||
        point.y < clip.y ||
        point.y >= clip.y + clip.height)
    ) {
      continue;
    }
    for (const batch of layer.batches) {
      if (batch.kind !== 'rectangles') continue;
      for (let index = 0; index < batch.count; index += 1) {
        const [x = 0, y = 0, width = 0, height = 0] = batch.values.subarray(
          index * 4,
          index * 4 + 4,
        );
        if (point.x >= x && point.x < x + width && point.y >= y && point.y < y + height) {
          shown = blended(shown, batch.colour);
        }
      }
    }
  }
  return shown;
}

function contrastOf(one: Colour, other: Colour): number {
  const oklch = (colour: Colour) =>
    srgbToOklch({ red: colour[0], green: colour[1], blue: colour[2], alpha: 1 });
  return contrastRatio(oklch(one), oklch(other));
}

describe("the editor's canvas colours", () => {
  it.each([
    [ThemeMode.Dark, ContrastLevel.Standard],
    [ThemeMode.Dark, ContrastLevel.High],
    [ThemeMode.Light, ContrastLevel.Standard],
    [ThemeMode.Light, ContrastLevel.High],
  ])(
    'write every label readably on what is drawn under it, in the %s theme at %s contrast',
    (mode, contrast) => {
      const required =
        contrast === ContrastLevel.High
          ? ContrastRequirement.Enhanced
          : ContrastRequirement.BodyText;
      const failures = new Set<string>();
      let pairs = 0;
      for (const accent of ACCENT_NAMES) {
        for (const brightness of BRIGHTNESS_STEPS) {
          const theme = resolveTheme(
            { ...DEFAULT_THEME_PREFERENCES, mode, accent, brightness, contrast },
            UNKNOWN_SYSTEM_APPEARANCE,
          );
          const palette = editorPaletteOf(theme);
          const type = editorTypeOf(theme);
          for (const display of Object.values(DisplayMode)) {
            for (const [known, audio] of Object.entries(AUDIO)) {
              const frame = frameOf(palette, display, audio, type);
              for (const layer of frame.layers) {
                for (const batch of layer.batches) {
                  if (batch.kind !== 'text') continue;
                  for (const label of batch.labels) {
                    pairs += 1;
                    const ratio = contrastOf(label.colour, geometryAt(frame, insideOf(label)));
                    if (ratio < required) {
                      failures.add(
                        `"${label.text}" in ${display}, ${known}, ${accent} at ${brightness.toFixed(1)}: ${ratio.toFixed(2)}`,
                      );
                    }
                  }
                }
              }
            }
          }
        }
      }
      // Eight accents at twenty-one steps, and the 100 labels the eight frames
      // write between them, a reason in every spectrogram and overlay lane
      // among them, written as a number: computed from the same lists, a count
      // would pass having checked nothing.
      expect(pairs).toBe(16_800);
      expect([...failures]).toEqual([]);
    },
  );
});
