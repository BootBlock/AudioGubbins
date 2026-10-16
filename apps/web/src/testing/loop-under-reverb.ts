/**
 * A region whose loop only a stateful rack can give a seam (ADR-0107): half a
 * second of a loud 480 Hz sine and then a second and a half of the same sine
 * quiet, 100 frames a period, in a region of all of it, looped over the second
 * of quiet sine after the loud half, with a reverb as the region's rack. The
 * loop's body alone joins without a seam; run from the region's start, the
 * reverb's tail of the loud half is in the loop's head and gone by its end.
 */

import { expect } from 'vitest';

import type { RegionId } from '@audiogubbins/domain';
import { sine } from '@audiogubbins/test-fixtures';

import { regionEntryId } from '../assets/project-entry.js';
import { windowWithAudio, type AudioWindow } from './project-audio.js';

/** The region looped under a reverb, open in a view of its own, its loop carrying the reverb over. */
export async function loopUnderReverb(): Promise<{
  readonly audio: AudioWindow;
  readonly region: RegionId;
}> {
  const quiet = sine(480, { length: 96_000, amplitude: 0.05 });
  const [channel] = quiet.channels;
  if (channel === undefined) throw new Error('The sine has a channel.');
  const loudThenQuiet = Float32Array.from(channel, (sample, frame) =>
    frame < 24_000 ? sample * 18 : sample,
  );
  const audio = await windowWithAudio({
    fixture: { ...quiet, name: 'loud-then-quiet', channels: [loudThenQuiet] },
    regions: [{ name: 'Hum', start: 0, end: 96_000 }],
  });
  const { window } = audio;
  const [placed] = audio.asset().regions;
  if (placed === undefined) throw new Error('The region was not added.');
  window.context.editorViews.open('editor', audio.asset());
  window.context.editorViews.focus('editor');
  window.run('region.open', { region: placed.id });
  window.run('editor.select-time', { start: 24_000, end: 72_000 });
  await window.runAndHear('region.loop', { crossfade: 0 });
  await window.runAndHear('rack.add-processor', { typeKey: 'reverb' });
  await expect
    .poll(() => window.context.assets.find(regionEntryId(placed.id))?.regions, { timeout: 5000 })
    .toBeDefined();
  return { audio, region: placed.id };
}
