import { expect, type Locator, type Page } from '@playwright/test';

import { openFresh } from './shell.js';
import { test } from './test.js';

/**
 * The Transport panel plays the test signal through the audio engine and
 * renders it offline, as a user drives it.
 *
 * Everything here is read the way a user reads it: the buttons by their
 * names, the position from its timer, and the engine's state and the render's
 * fingerprint from the readings beside them. The playback path behind them is
 * the engine's to change, and a test that reached into it would pass or fail
 * on how it is built rather than on what the panel shows.
 *
 * Play is pressed with a click, since a browser starts an audio context only
 * on a user's gesture, and that gesture is part of what is being proved.
 */

/**
 * How long the audio context may take to start and report its first frames.
 * The first press loads the processor and its WebAssembly as well.
 */
const AUDIO_START = 30_000;

/** How long the offline render may take, in a worker, with WebAssembly. */
const RENDER = 60_000;

/**
 * How long a paused position is watched for, which is several display frames
 * at any refresh rate, so a timer still being redrawn would change within it.
 */
const PAUSE_WATCH = 500;

/** How often the paused position is read while it is watched. */
const PAUSE_READ_INTERVAL = 50;

/** Where the timer starts, and where Stop returns it. */
const START = '0:00.000';

/**
 * The fingerprint of the test signal rendered offline, as the golden tests
 * print it.
 */
const TEST_SIGNAL_FINGERPRINT = '0x0ed5ce5b65bfb45d';

/** A position as the timer writes it: minutes, seconds and milliseconds. */
const POSITION = /^(?<minutes>\d+):(?<seconds>\d{2})\.(?<milliseconds>\d{3})$/u;

/** A position the timer shows, in milliseconds. */
function millisecondsOf(text: string): number {
  const parts = POSITION.exec(text.trim())?.groups;
  if (parts === undefined) throw new Error(`The timer shows no position: ${text}`);
  return (
    Number(parts['minutes']) * 60_000 +
    Number(parts['seconds']) * 1000 +
    Number(parts['milliseconds'])
  );
}

/** Play, Pause, Stop and the position, as the panel groups them. */
function transportControls(page: Page): Locator {
  return page.getByRole('group', { name: 'Transport', exact: true });
}

function positionTimer(page: Page): Locator {
  return transportControls(page).getByRole('timer', { name: 'Position', exact: true });
}

/**
 * What a reading of the panel says: the description beside the term a user
 * reads it by, such as "Transport" or "Fingerprint".
 */
function reading(page: Page, term: string): Locator {
  return page.locator(`xpath=//dt[normalize-space()="${term}"]/following-sibling::dd[1]`);
}

async function positionNow(page: Page): Promise<number> {
  return millisecondsOf(await positionTimer(page).innerText());
}

/** Opens AudioGubbins with the Transport panel in front. */
async function openTransport(page: Page): Promise<void> {
  await openFresh(page);
  // The default workspace docks the Transport at the bottom; its tab is
  // pressed so the test holds whichever panel the group opens on.
  await page.getByRole('tab', { name: 'Transport', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Transport', exact: true })).toBeVisible();
}

test.describe('the Transport panel', () => {
  test('plays, pauses, resumes and stops the test signal', async ({ page }) => {
    await openTransport(page);
    const controls = transportControls(page);
    const transport = reading(page, 'Transport');
    await expect(positionTimer(page)).toHaveText(START);

    await test.step('Play starts the position moving', async () => {
      await controls.getByRole('button', { name: 'Play', exact: true }).click();

      await expect(transport).toHaveText('Playing', { timeout: AUDIO_START });
      await expect
        .poll(async () => await positionNow(page), { timeout: AUDIO_START })
        .toBeGreaterThan(0);
    });

    const paused = await test.step('Pause holds the position where it is', async () => {
      await controls.getByRole('button', { name: 'Pause', exact: true }).click();
      await expect(transport).toHaveText('Paused');

      const held = await positionTimer(page).innerText();
      const readings: string[] = [];
      const watchedFrom = Date.now();
      await expect
        .poll(
          async () => {
            readings.push(await positionTimer(page).innerText());
            return Date.now() - watchedFrom;
          },
          { intervals: [PAUSE_READ_INTERVAL], timeout: PAUSE_WATCH * 10 },
        )
        .toBeGreaterThanOrEqual(PAUSE_WATCH);

      expect([...new Set(readings)]).toEqual([held]);
      return millisecondsOf(held);
    });

    await test.step('Play resumes from where it paused', async () => {
      await controls.getByRole('button', { name: 'Play', exact: true }).click();

      await expect(transport).toHaveText('Playing', { timeout: AUDIO_START });
      await expect
        .poll(async () => await positionNow(page), { timeout: AUDIO_START })
        .toBeGreaterThan(paused);
    });

    await test.step('Stop returns the position to the start', async () => {
      await controls.getByRole('button', { name: 'Stop', exact: true }).click();

      await expect(transport).toHaveText('Stopped');
      await expect(positionTimer(page)).toHaveText(START);
    });
  });

  test('renders the test signal offline to its known fingerprint', async ({ page }) => {
    await openTransport(page);

    await page.getByRole('button', { name: 'Render the test signal offline', exact: true }).click();

    await expect(reading(page, 'Fingerprint')).toHaveText(TEST_SIGNAL_FINGERPRINT, {
      timeout: RENDER,
    });
  });
});
