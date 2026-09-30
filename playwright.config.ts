/**
 * The end-to-end suite.
 *
 * This is where AudioGubbins is driven in a real browser, which is what the
 * Phase 01 acceptance criteria ask for: the application starting through Vite,
 * the shell responding to mouse, keyboard, touch and pen, and the accessibility
 * checks that a rendered page can answer and a unit test cannot.
 *
 * It also settles a debt the unit tests could not. Under jsdom only the first
 * pointer click on a menu trigger per file opens anything, because the menu
 * library keeps module-level layer state that unmounting does not unwind. The
 * unit tests therefore open menus from the keyboard. The pointer path is
 * covered here, where a real browser has no such artefact.
 *
 * The projects are separated by what they cost. `chromium-smoke` is the fast
 * tier REQ-REPO-188.1 places on every checkpoint; the browser matrix and the
 * touch and pen projects belong to the heavier tiers.
 */

import { join } from 'node:path';

import { defineConfig, devices } from '@playwright/test';

import type { SuiteOptions } from './tests/e2e/test.js';

/** The sub-path a GitHub Pages project site is served from. */
const PAGES_BASE = '/AudioGubbins/';

/** Where the sub-path build is served. */
const PAGES_URL = `http://127.0.0.1:4174${PAGES_BASE}`;

/**
 * The run's output folder, where each failing test's trace and screenshot
 * are written. Playwright empties it before it starts the servers.
 */
const OUTPUT = join(import.meta.dirname, 'test-results');

/**
 * The environment that has a preview server write what it received and
 * answered to a file in the run's output, one file for each server.
 *
 * A page load that times out shows in its trace as a request with no
 * response, and only the server can say whether it received that request
 * and answered it. Kept in the output folder, the log is emptied with it at
 * the start of each run and sits beside the traces of the run it describes,
 * so the one copy of the folder keeps both.
 */
function requestLog(port: number): Record<string, string> {
  return {
    AUDIOGUBBINS_PREVIEW_REQUEST_LOG: join(OUTPUT, `preview-${String(port)}-requests.log`),
  };
}

/**
 * Firefox's pointer, pinned to a mouse: one fine pointer that hovers, and no
 * other among the inputs.
 *
 * Playwright emulates no pointer in Firefox, which otherwise reports the
 * pointers of the machine it runs on: on a machine with a touch screen a
 * finger is among the inputs of every run, whatever the project says, and a
 * field is drawn as a finger needs it. Pinned, as the text size is, so a run
 * measures the page and not the machine; a finger among the inputs is the
 * touch projects' to test. Each preference is a set of bit flags, 1 coarse,
 * 2 fine and 4 hover, for the primary pointer and for every pointer.
 */
const FIREFOX_MOUSE = {
  'ui.primaryPointerCapabilities': 6,
  'ui.allPointerCapabilities': 6,
} as const;

export default defineConfig<SuiteOptions>({
  testDir: './tests/e2e',
  outputDir: OUTPUT,

  // A test that depends on another having run is a test that cannot be run
  // alone, and the first thing anyone does with a failure is run it alone.
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),

  // No retries. REQ-EXEC-180 prohibits adding retries to hide a race: a test
  // that passes on the second attempt has found something.
  retries: 0,

  /*
   * Four browser contexts at a time.
   *
   * The default is half the machine's cores, which on this hardware is sixteen
   * WebKit contexts against one preview server. Under that load a click can be
   * dispatched into a page that has painted but is still settling, and a menu
   * opened by pointer intermittently fails to open. The same project passes
   * every test with fewer workers, which is what shows the load, and not the
   * tests, to be the cause.
   *
   * This is a limit on the harness, not a retry and not a weakened assertion.
   * REQ-EXEC-180 forbids hiding a race behind retries; it does not require
   * running more browsers than the machine can serve.
   */
  workers: 4,

  reporter: process.env['CI'] === undefined ? [['list']] : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',

    // British English, so the application renders the language it is written in
    // and a date or a number in a fixture reads the way a user would see it.
    locale: 'en-GB',
    timezoneId: 'Europe/London',
  },

  projects: [
    {
      name: 'chromium-smoke',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /smoke\.spec\.ts/,
    },
    {
      name: 'chromium-accessibility',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /accessibility\.spec\.ts/,
    },
    {
      name: 'chromium-input',
      use: {
        ...devices['Desktop Chrome'],
        // Touch and pen are driven explicitly per test through CDP, so the
        // project only needs the pointer capabilities enabled.
        hasTouch: true,
      },
      testMatch: /(input|touch)\.spec\.ts/,
    },
    {
      // Playback and the offline render, driven from the Transport panel. A
      // project of its own, so the fast tier does not wait on an audio context
      // starting and a render running in a worker.
      name: 'chromium-transport',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /transport\.spec\.ts/,
    },
    {
      // The editor's timeline: zoom to single samples, snapping, and two views
      // of one asset (the packet's `test:e2e:timeline`).
      name: 'chromium-timeline',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /timeline\.spec\.ts/,
    },
    {
      // The editor's renderer losing its WebGL 2 context, where WebGPU gives
      // no adapter, as it does in the headless shell.
      name: 'chromium-renderer',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /renderer-loss\.spec\.ts/,
    },
    {
      // The same with WebGPU on a software adapter, in Chromium's own headless
      // mode, which offers one: no graphics hardware is asked for, so a run
      // measures the renderer and not the machine.
      name: 'chromium-renderer-webgpu',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chromium',
        launchOptions: { args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'] },
      },
      testMatch: /renderer-webgpu\.spec\.ts/,
    },
    {
      // A browser with WebGL switched off, where the editor draws with Canvas 2D.
      name: 'chromium-renderer-reduced',
      use: { ...devices['Desktop Chrome'], launchOptions: { args: ['--disable-webgl'] } },
      testMatch: /renderer-reduced\.spec\.ts/,
    },
    {
      // Pinch, pan, pen and long press in the editor, sent as the browser's own
      // touch and pen events through the DevTools protocol, which Chromium has.
      name: 'chromium-touch-pen',
      use: { ...devices['Desktop Chrome'], hasTouch: true },
      testMatch: /touch-pen\.spec\.ts/,
    },
    {
      // Reference picture recorded in the page and kept on the transport.
      name: 'chromium-video-reference',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /video-reference\.spec\.ts/,
    },
    {
      // Accessibility as well as the smoke suite: asserted on Chromium alone,
      // the focus ring, the live regions and the reduced-motion handling would
      // go untested on the two engines whose focus heuristics differ most from
      // it.
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        // Firefox scales by the system's text size as well, which the other
        // engines here do not. Pinned at 100, as the device profile is, so a
        // run of this project measures the page and not the machine it is on;
        // Firefox at a text size that is not 100 is a project of its own below.
        launchOptions: { firefoxUserPrefs: { ...FIREFOX_MOUSE, 'ui.textScaleFactor': 100 } },
      },
      testMatch: /(smoke|accessibility)\.spec\.ts/,
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      testMatch: /(smoke|accessibility)\.spec\.ts/,
    },
    {
      // A display scaled to 125%, as many Windows laptops ship, which Chromium
      // exposes as a device pixel ratio. What that exercises is a box laid out
      // and read at a ratio that is a fraction: a box laid out at 24 pixels
      // reads 23.99999237 here, which the target test allows for. What it does
      // not: Playwright sets the viewport in CSS pixels, so every width the
      // page takes here is whole, and Chromium computes a ring at the width
      // declared; the width it paints is not measured. A fractional width and
      // a ring rounded down are the next project's.
      //
      // It runs the whole of the smoke and accessibility specs, every test of
      // both files and not a chosen few: a ratio that is a fraction reaches
      // whatever the page lays out, hit-tests, scrolls or reads back from where
      // it drew, which is more than any list of tests can be relied on to name,
      // and a test left off a list would go unscaled with nothing to say so.
      name: 'chromium-scaled',
      use: { ...devices['Desktop Chrome'], deviceScaleFactor: 1.25 },
      testMatch: /(smoke|accessibility)\.spec\.ts/,
    },
    {
      // Firefox at a text size of 110 per cent, as Windows users set it. It
      // reports a device pixel ratio of one, and still lays the page out on
      // device pixels that are not whole CSS pixels: it lays a page out in
      // sixtieths of a CSS pixel, 55 of them to a device pixel here, so a
      // device pixel is 55/60 of a CSS pixel. The page takes a whole number of
      // device pixels, so its widths are fractional, 389.58 for a viewport of
      // 390 (425 device pixels) and 391.42 for 391 (427), with nothing between,
      // and a ring is drawn in whole device pixels, rounded down, so one
      // declared three wide is floor(3 * 60/55) = 3 of them, 2.75 wide, and one
      // declared two wide floor(2 * 60/55) = 2 of them, 1.83 wide.
      //
      // It runs the tests that read a ring, a border, a target, a box, a width
      // the page takes or the size text is drawn at, that run an audit, or
      // whose proof rests on the dock's own reading of where it drew a group,
      // which are the ones a scale can move, and which carry the `@scale` tag:
      // chosen by tag rather than by file, because each file holds far more
      // that a scale cannot touch, and a tag stays on its test when a test is
      // renamed or moved.
      name: 'firefox-text-110',
      use: {
        ...devices['Desktop Firefox'],
        launchOptions: { firefoxUserPrefs: { ...FIREFOX_MOUSE, 'ui.textScaleFactor': 110 } },
      },
      testMatch: /(smoke|accessibility)\.spec\.ts/,
      grep: /@scale/,
    },
    {
      // A tablet runs the touch suite as well as the smoke suite. The smoke
      // suite contains no touch at all: every interaction in it is a click,
      // which Playwright dispatches as a mouse, so with the smoke suite alone
      // the project would describe touch and test none.
      //
      // It sends the agent an iPad on the floor sends. iPadOS Safari sends the
      // Mac's agent by default, and the descriptor's claims iOS 12.2, which is
      // below the floor.
      name: 'tablet',
      use: {
        ...devices['iPad Pro 11'],
        userAgent: devices['Desktop Safari'].userAgent,
        // The application tells an iPad from a Mac by its touch points, more
        // than one on an iPad, which Playwright's WebKit does not report with
        // touch emulated: it reports none. Given the iPad's five here, the page
        // reads the system as an iPad user's does.
        touchPoints: 5,
      },
      testMatch: /(smoke|touch)\.spec\.ts/,
    },
    {
      // The GitHub Pages deployment REQ-PWA-031 requires, which serves a
      // project site from a sub-path. Without this project, every asset URL,
      // the manifest link and the base path could be wrong there and every test
      // would still pass at the origin's root.
      name: 'pages',
      use: { ...devices['Desktop Chrome'], baseURL: PAGES_URL },
      testMatch: /pages\.spec\.ts/,
    },
  ],

  webServer: [
    {
      // The preview server serves the production build, so the suite exercises
      // what a user receives rather than what the development server
      // assembles. The host is explicit. Vite's preview server binds to
      // localhost, which on Windows resolves to the IPv6 loopback, and the
      // browser then cannot reach the IPv4 address the suite navigates to.
      command:
        'pnpm --filter @audiogubbins/web build && pnpm --filter @audiogubbins/web preview --host 127.0.0.1 --port 4173 --strictPort',
      url: 'http://127.0.0.1:4173',
      // Both of the server's streams are printed with the run's, each line
      // under the server's name, so the log of a run that fails keeps what the
      // server said while it failed. Playwright drops the standard output
      // unless it is asked for.
      name: 'preview',
      stdout: 'pipe',
      stderr: 'pipe',
      env: requestLog(4173),
      // Never reused. Reusing a server that is already bound skips the build
      // half of the command above, so the suite can run against whatever was
      // built last while the evidence claims it ran against the current source.
      // The evidence says which source these results came from, which only
      // holds while every run builds the source it names.
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      // The same build under the sub-path a project site is served from, into
      // its own directory so the two builds cannot overwrite each other, and
      // through the same output gate the ordinary build passes.
      command:
        'pnpm --filter @audiogubbins/web exec vite build --outDir dist-pages && node tools/check-build-output.mjs apps/web/dist-pages && pnpm --filter @audiogubbins/web exec vite preview --outDir dist-pages --host 127.0.0.1 --port 4174 --strictPort',
      url: PAGES_URL,
      name: 'pages preview',
      stdout: 'pipe',
      stderr: 'pipe',
      // Playwright gives the server its own environment with these added,
      // each one here taking the place of the same name there.
      env: { AUDIOGUBBINS_BASE: PAGES_BASE, ...requestLog(4174) },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
