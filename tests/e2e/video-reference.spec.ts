import { expect, type Page } from '@playwright/test';

import { openAsset, pointAt, readingOf, runCommand, writeTimesAs } from './editor.js';
import { FRAMES_PER_SECOND, framedVideo, openPicturePanel } from './picture.js';
import { test } from './test.js';

/**
 * Reference picture beside the audio (the packet's `test:video-reference`,
 * REQ-AUDIO-156, ADR-0046): a video the page makes itself, bound to the
 * transport, kept within a frame of the audio while it plays and on exactly the
 * frame of the playhead while parked, judged by the frame on screen; and a file
 * whose picture the browser cannot decode said as such, with the audio
 * untouched.
 */

/** How long the audio context may take to start and report its first frames. */
const AUDIO_START = 30_000;

/** The timeline's rate, at which the editor writes positions in samples. */
const TIMELINE_RATE = 48_000;

/**
 * A WebM of sound alone, recorded in the page: a file a browser opens and
 * plays, with no picture to decode, as it treats a video codec it lacks.
 */
async function soundOnly(page: Page): Promise<Buffer> {
  const bytes = await page.evaluate(async () => {
    const audio = new AudioContext();
    const tone = new OscillatorNode(audio);
    const out = new MediaStreamAudioDestinationNode(audio);
    tone.connect(out);
    tone.start();
    const recorder = new MediaRecorder(out.stream, { mimeType: 'audio/webm' });
    const chunks: Blob[] = [];
    recorder.addEventListener('dataavailable', (event) => chunks.push(event.data));
    const stopped = new Promise((resolve) => {
      recorder.addEventListener('stop', resolve);
    });
    recorder.start();
    await new Promise((resolve) => setTimeout(resolve, 500));
    recorder.stop();
    await stopped;
    await audio.close();
    return [...new Uint8Array(await new Blob(chunks).arrayBuffer())];
  });
  return Buffer.from(bytes);
}

/** What the picture shows and where the playhead is, read in one turn of the page. */
interface Reading {
  /** The number the frame on screen draws of itself. */
  readonly shown: number;
  /** The playhead when the frame shows, in samples at the asset's 48 kHz. */
  readonly playhead: number;
}

/**
 * Reads the frame the picture shows from its pixels, beside the editor's
 * playhead.
 *
 * Given a stretch, it reads after each frame callback while the playhead is
 * within it, until the playhead passes it. The readout is written once a
 * display frame, and the frame shows a display frame or so after its callback,
 * so the playhead is taken as the readout moved on at the playing rate from
 * when it was written to when the frame shows: a loaded page that writes it
 * late then moves no frame out of step. Without a stretch, the picture is
 * parked: a paused element presents no further frame, so it reads the frame at
 * once, or nothing while a seek is on its way.
 */
async function watch(
  page: Page,
  stretch: { readonly from: number; readonly to: number } | undefined,
): Promise<readonly Reading[]> {
  return await page.evaluate(
    async ({ within, rate }) => {
      const video = document.querySelector<HTMLVideoElement>('.ag-picture-video');
      const timer = document.querySelector('.ag-editor [role="timer"][aria-label="Playhead"]');
      if (video === null || timer === null) throw new Error('No picture or playhead.');
      const canvas = new OffscreenCanvas(160, 90);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (context === null) throw new Error('No Canvas 2D context to read the frame from.');
      const read = () => {
        context.drawImage(video, 0, 0, 160, 90);
        const { data } = context.getImageData(0, 0, 160, 90);
        let shown = 0;
        for (let bit = 0; bit < 8; bit += 1) {
          const red = data[(45 * 160 + bit * 20 + 10) * 4] ?? 0;
          shown = shown * 2 + (red > 127 ? 1 : 0);
        }
        return { shown, playhead: Number(timer.textContent.replaceAll(',', '')) };
      };
      if (within === undefined) {
        return video.seeking || video.readyState < 2 ? [] : [read()];
      }
      let written = performance.now();
      const writing = new MutationObserver(() => {
        written = performance.now();
      });
      writing.observe(timer, { characterData: true, childList: true, subtree: true });
      const readings = [];
      for (;;) {
        const shows = await new Promise<number>((resolve) => {
          video.requestVideoFrameCallback((_now, metadata) => {
            resolve(metadata.expectedDisplayTime);
          });
        });
        const one = read();
        const playhead = one.playhead + ((shows - written) * rate) / 1000;
        if (playhead > within.to) break;
        if (playhead >= within.from) readings.push({ shown: one.shown, playhead });
      }
      writing.disconnect();
      return readings;
    },
    { within: stretch, rate: TIMELINE_RATE },
  );
}

/** The picture's frame that holds `samples`, from its start at the timeline's. */
function frameAt(samples: number): number {
  return Math.floor((samples * FRAMES_PER_SECOND) / TIMELINE_RATE);
}

test.describe('reference picture', () => {
  test('shows the frame of the playhead while parked, and within a frame of it while playing', async ({
    page,
  }) => {
    const editor = await openAsset(page, 'Tone bursts');
    await writeTimesAs(page, editor, 'Samples');
    const video = await framedVideo(page);
    const panel = await openPicturePanel(page);
    await panel
      .locator('input[type="file"]')
      .setInputFiles({ name: 'reference.webm', mimeType: 'video/webm', buffer: video });
    await expect(panel.getByRole('timer')).toHaveText('00:00:00:00', { timeout: 15_000 });
    await runCommand(page, 'Count the picture at 30 frames a second');

    await test.step('Parked, the picture shows exactly the frame of the playhead', async () => {
      // Forward and back by single frames, into frames stamped before they
      // start (41, 70) and out of them to the frame before, which is where a
      // frame judged by its start is taken for its neighbour.
      for (const frame of [40, 41, 40, 43, 42, 71, 70, 69, 70]) {
        const at = await pointAt(
          editor,
          ((frame + 0.5) * TIMELINE_RATE) / FRAMES_PER_SECOND,
          'ruler',
        );
        await page.mouse.click(at.x, at.y);
        await expect
          .poll(async () => {
            const [read] = await watch(page, undefined);
            return read === undefined ? 'seeking' : read.shown - frameAt(read.playhead);
          })
          .toBe(0);
      }
    });

    await test.step('Playing, the picture is within a frame of the audio', async () => {
      const at = await pointAt(editor, 0, 'ruler');
      await page.mouse.click(at.x, at.y);
      await page.getByRole('button', { name: 'Play', exact: true }).click();
      await expect(readingOf(editor, 'Playhead')).not.toHaveText('0', { timeout: AUDIO_START });
      // From half a second, once playback has settled, to three and a half,
      // short of the picture's end.
      const readings = await watch(page, {
        from: TIMELINE_RATE / 2,
        to: 3.5 * TIMELINE_RATE,
      });

      expect(readings.length).toBeGreaterThan(20);
      // One frame either way of the frame that holds the playhead when the
      // frame shows.
      for (const { shown, playhead } of readings) {
        expect(Math.abs(shown - frameAt(playhead))).toBeLessThanOrEqual(1);
      }
    });
  });

  test('says a file it cannot decode, and leaves the audio as it was', async ({ page }) => {
    const editor = await openAsset(page, 'Tone bursts');
    const panel = await openPicturePanel(page);
    const playhead = await readingOf(editor, 'Playhead').innerText();

    await panel.locator('input[type="file"]').setInputFiles({
      name: 'broken.webm',
      mimeType: 'video/webm',
      buffer: Buffer.from('This is not a video.'),
    });

    await expect(panel.getByRole('alert')).toContainText('broken.webm cannot be shown');
    await expect(panel.getByRole('alert')).toContainText('The audio is not affected.');
    await expect(readingOf(editor, 'Playhead')).toHaveText(playhead);
  });

  test('says a file with no picture it can decode, and leaves the audio as it was', async ({
    page,
  }) => {
    const editor = await openAsset(page, 'Tone bursts');
    const sound = await soundOnly(page);
    const panel = await openPicturePanel(page);
    const playhead = await readingOf(editor, 'Playhead').innerText();

    await panel
      .locator('input[type="file"]')
      .setInputFiles({ name: 'sound.webm', mimeType: 'video/webm', buffer: sound });

    await expect(panel.getByRole('alert')).toContainText(
      'sound.webm cannot be shown: The browser cannot decode a picture in this file.',
    );
    await expect(panel.getByRole('alert')).toContainText('The audio is not affected.');
    await expect(readingOf(editor, 'Playhead')).toHaveText(playhead);
    await expect(panel.getByRole('timer')).toHaveCount(0);
  });
});
