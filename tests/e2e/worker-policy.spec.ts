import { expect, type Locator, type Page, type Worker } from '@playwright/test';

import { sine, wavFile } from '../../packages/test-fixtures/src/index.js';
import { runCommand } from './editor.js';
import { menuBarMenu, openFresh } from './shell.js';
import { test } from './test.js';

/**
 * Every worker runs under the page's security policy, in a real browser
 * against the production build.
 *
 * The policy is a `<meta>` tag, and a worker started from its script's own URL
 * takes the policy of that script's response instead (CSP Level 3), which the
 * preview server, like a static host, sends none of. So a worker could fetch
 * from any origin, and the two that fetch at all are the storage worker, which
 * downloads a model pack's files, and the inference worker, which reads the
 * runtime's WebAssembly. Each worker here is asked, from inside it, to fetch
 * from another origin; the fetch must be refused by the page's `connect-src`,
 * which the browser says by a violation event in that worker. The other origin
 * is answered by the test where a request reaches it, so a worker with no
 * policy would fetch it, and the test would see that it had.
 *
 * The inference worker starts only once a model runs, so the second test
 * installs DeepFilterNet 3 from the application's own origin, puts it on a
 * sound's rack, and waits for the worker its render starts. It needs a build
 * that carries the packs, `AUDIOGUBBINS_PACK_CACHE` naming the pack build's
 * cache and `AUDIOGUBBINS_PACKS_IN_BUILD=1`, and fails rather than passes
 * without them.
 */

/** An origin the page's policy does not allow, which the test answers where a request reaches it. */
const ELSEWHERE = 'https://elsewhere.example.com';

/** How long the model pack may take to install and its first render to start a worker. */
const MODEL = 180_000;

/** What came of a fetch from inside a worker: whether it was answered, and the directive that refused it. */
interface FetchOutcome {
  readonly outcome: 'answered' | 'refused';
  readonly directive: string;
}

/** Asks `worker` to fetch from {@link ELSEWHERE}, from inside it. */
async function fetchElsewhereFrom(worker: Worker): Promise<FetchOutcome> {
  return await worker.evaluate(async (url): Promise<FetchOutcome> => {
    const violated = new Promise<string>((resolve) => {
      self.addEventListener(
        'securitypolicyviolation',
        (event) => {
          resolve(event.violatedDirective);
        },
        { once: true },
      );
    });
    let outcome: FetchOutcome['outcome'] = 'answered';
    try {
      await fetch(url);
    } catch {
      outcome = 'refused';
    }
    const none = new Promise<string>((resolve) => {
      setTimeout(() => {
        resolve('none');
      }, 2_000);
    });
    return { outcome, directive: await Promise.race([violated, none]) };
  }, `${ELSEWHERE}/probe`);
}

/** The page's worker whose name is `name`, once it has started. */
async function workerNamed(page: Page, name: string, timeout: number): Promise<Worker> {
  let found: Worker | undefined;
  await expect
    .poll(
      async () => {
        for (const worker of page.workers()) {
          const named = await worker.evaluate(() => self.name).catch(() => '');
          if (named === name) found = worker;
        }
        return found !== undefined;
      },
      { timeout, message: `The worker "${name}" did not start.` },
    )
    .toBe(true);
  if (found === undefined) throw new Error(`The worker "${name}" did not start.`);
  return found;
}

/** The panel whose heading is `title`. */
function panelTitled(page: Page, title: string): Locator {
  return page
    .locator('section.ag-panel')
    .filter({ has: page.getByRole('heading', { name: title, level: 2, exact: true }) });
}

/** Answers every request that reaches {@link ELSEWHERE}, and gives the URLs of those that did. */
async function answerElsewhere(page: Page): Promise<readonly string[]> {
  const reached: string[] = [];
  await page.context().route(`${ELSEWHERE}/**`, async (route) => {
    reached.push(route.request().url());
    await route.fulfill({
      status: 200,
      body: 'reached',
      headers: { 'access-control-allow-origin': '*' },
    });
  });
  return reached;
}

test.describe('the workers under the page’s security policy', () => {
  test('the storage worker is refused a fetch from another origin', async ({ page }) => {
    const reached = await answerElsewhere(page);
    await openFresh(page);

    const storage = await workerNamed(page, 'AudioGubbins storage', 30_000);

    expect(await fetchElsewhereFrom(storage)).toEqual({
      outcome: 'refused',
      directive: 'connect-src',
    });
    expect(reached).toEqual([]);
  });

  test('the inference worker is refused a fetch from another origin', async ({ page }) => {
    test.setTimeout(MODEL + 60_000);
    const reached = await answerElsewhere(page);
    await page.addInitScript(() => {
      // The file input the application falls back to, which a test can fill.
      for (const picker of ['showOpenFilePicker', 'showSaveFilePicker', 'showDirectoryPicker']) {
        Reflect.deleteProperty(window, picker);
      }
    });
    await openFresh(page);

    await runCommand(page, 'Show the Model packs panel');
    const packs = panelTitled(page, 'Model packs');
    const pack = packs.getByRole('group', { name: 'DeepFilterNet 3 1.0.0' });
    await expect(pack, 'The build carries no model packs to install.').toBeVisible({
      timeout: 30_000,
    });
    await pack.getByRole('button', { name: 'Install' }).click();
    await expect(pack.getByText('Installed, every file checked against its SHA-256')).toBeVisible({
      timeout: MODEL,
    });

    await page
      .getByRole('region', { name: 'Project' })
      .getByRole('button', { name: 'New project…' })
      .click();
    const dialogue = page.getByRole('dialog', { name: 'Projects' });
    await dialogue.getByRole('textbox', { name: 'Name' }).fill('Policy');
    await dialogue.getByRole('button', { name: 'Make the project' }).click();
    await expect(dialogue).toBeHidden();
    const choosing = page.waitForEvent('filechooser');
    await menuBarMenu(page, 'File').click();
    await page.getByRole('menuitem', { name: 'Import audio…' }).click();
    const tone = sine(440, { sampleRate: 48_000, length: 48_000 });
    await (
      await choosing
    ).setFiles({ name: 'Tone.wav', mimeType: 'audio/wav', buffer: Buffer.from(wavFile(tone)) });
    await expect(page.getByText('“Tone” is imported and open.').first()).toBeVisible();

    await runCommand(page, 'Show the Effects rack panel');
    const rack = panelTitled(page, 'Effects rack');
    await rack.getByRole('button', { name: 'Add a processor' }).first().click();
    await page.getByRole('menuitem', { name: 'DeepFilterNet 3' }).click();

    // The racked sound's waveform is read from a render, which runs the model.
    const inference = await workerNamed(page, 'AudioGubbins inference', MODEL);

    expect(await fetchElsewhereFrom(inference)).toEqual({
      outcome: 'refused',
      directive: 'connect-src',
    });
    expect(reached).toEqual([]);
  });
});
