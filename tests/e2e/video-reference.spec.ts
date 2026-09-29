import { expect, type Locator, type Page } from '@playwright/test';

import { openAsset, pointAt, readingOf, runCommand, surfaceOf, writeTimesAs } from './editor.js';
import { test } from './test.js';

/**
 * Reference picture beside the audio (the packet's `test:video-reference`,
 * REQ-AUDIO-156, ADR-0046): a video the page records itself, bound to the
 * transport, kept within a frame of the audio while it plays and on exactly
 * the frame of the playhead while parked, and a file the browser cannot
 * decode said as such, with the audio untouched.
 */

/** How long the audio context may take to start and report its first frames. */
const AUDIO_START = 30_000;

/** The frame rate the page records at, and the picture is counted at by default. */
const FRAMES_PER_SECOND = 25;

/**
 * A WebM of a few seconds, recorded in the page from a canvas that draws its
 * own frame number, as bytes: made here rather than kept as a file, so the
 * suite carries no binary and the browser decodes what it can record.
 */
async function recordedVideo(page: Page): Promise<Buffer> {
  const bytes = await page.evaluate(async (fps) => {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 90;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('No Canvas 2D context to record from.');
    const stream = canvas.captureStream(fps);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    const chunks: Blob[] = [];
    recorder.addEventListener('dataavailable', (event) => chunks.push(event.data));
    const stopped = new Promise((resolve) => {
      recorder.addEventListener('stop', resolve);
    });
    recorder.start();
    const started = performance.now();
    await new Promise<void>((resolve) => {
      const draw = (): void => {
        const frame = Math.floor(((performance.now() - started) / 1000) * fps);
        context.fillStyle = `hsl(${String((frame * 37) % 360)} 70% 50%)`;
        context.fillRect(0, 0, 160, 90);
        if (frame >= fps * 4) resolve();
        else requestAnimationFrame(draw);
      };
      draw();
    });
    recorder.stop();
    await stopped;
    return [...new Uint8Array(await new Blob(chunks).arrayBuffer())];
  }, FRAMES_PER_SECOND);
  return Buffer.from(bytes);
}

/** The Picture panel, opened by its command. */
async function openPicturePanel(page: Page): Promise<Locator> {
  await runCommand(page, 'Show the Picture panel');
  const panel = page.locator('section.ag-picture');
  await expect(panel.getByRole('heading', { name: 'Picture' })).toBeVisible();
  return panel;
}

/** The picture's time and the editor's playhead in seconds, read in one turn of the page. */
async function pictureAndPlayhead(page: Page): Promise<{ picture: number; playhead: number }> {
  return await page.evaluate(() => {
    const video = document.querySelector<HTMLVideoElement>('.ag-picture-video');
    const timer = document.querySelector('.ag-editor [role="timer"][aria-label="Playhead"]');
    // The editor writes positions in samples at the asset's 48 kHz.
    const text = timer?.textContent ?? '';
    const frames = Number(text.replaceAll(',', ''));
    if (video === null || !Number.isFinite(frames))
      throw new Error(`No picture or playhead: ${text}`);
    return { picture: video.currentTime, playhead: frames / 48_000 };
  });
}

test.describe('reference picture', () => {
  test('stays within a frame of the audio while it plays, and on its frame while parked', async ({
    page,
  }) => {
    const editor = await openAsset(page, 'Tone bursts');
    await writeTimesAs(page, editor, 'Samples');
    const video = await recordedVideo(page);
    const panel = await openPicturePanel(page);
    await panel
      .locator('input[type="file"]')
      .setInputFiles({ name: 'reference.webm', mimeType: 'video/webm', buffer: video });
    await expect(panel.getByRole('timer')).toHaveText('00:00:00:00', { timeout: 15_000 });

    await test.step('Playing, the picture is within a frame of the audio', async () => {
      await page.getByRole('button', { name: 'Play', exact: true }).click();
      await expect(readingOf(editor, 'Playhead')).not.toHaveText('0', {
        timeout: AUDIO_START,
      });
      const drifts: number[] = [];
      for (let reading = 0; reading < 20; reading += 1) {
        await page.waitForTimeout(100);
        const { picture, playhead } = await pictureAndPlayhead(page);
        if (playhead > 0.5 && playhead < 3.5) drifts.push(Math.abs(picture - playhead));
      }
      expect(drifts.length).toBeGreaterThan(5);
      // One frame period, and the display frame the playhead readout is written
      // on, which is read a moment after the picture's time.
      expect(Math.max(...drifts)).toBeLessThanOrEqual(1 / FRAMES_PER_SECOND + 1 / 60);
    });

    await test.step('Parked, the picture shows exactly the frame of the playhead', async () => {
      await page.getByRole('button', { name: 'Pause', exact: true }).click();
      // Within the picture, which the recording made about four seconds long.
      const at = await pointAt(editor, Math.round(2.53 * 48_000), 'ruler');
      await page.mouse.click(at.x, at.y);
      await surfaceOf(editor).press('ArrowRight');
      await expect
        .poll(async () => {
          const { picture, playhead } = await pictureAndPlayhead(page);
          return Math.floor(picture * FRAMES_PER_SECOND) - Math.floor(playhead * FRAMES_PER_SECOND);
        })
        .toBe(0);
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
});
