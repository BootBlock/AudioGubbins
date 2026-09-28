import { test as base } from '@playwright/test';

/**
 * The browser suite's `test`: Playwright's, with every request a page makes
 * naming the project and the test that made it, and the touch points a page
 * reports given where a project stands for a device the engine cannot be.
 *
 * The preview servers log each request they receive. Four workers run the
 * projects side by side, most of them against the one server, and a user
 * agent tells one engine from another but not one project of an engine from
 * another, nor one test from the next, so each page sends a header that does,
 * and the log writes it down. Every spec takes its `test` from here, and a
 * rule in `tests/architecture/browser-suite.test.ts` holds that none takes it
 * from Playwright, whose pages would send no such header.
 */

/**
 * The request header that names the project and the test.
 *
 * The request log declares the name it reads in
 * `apps/web/preview-request-log.ts`, which the compiler keeps apart from this
 * module, and `tests/preview-request-log.test.ts` sends this header as the
 * suite does and finds it in the log, so the two cannot name different
 * headers unseen.
 */
export const TEST_HEADER = 'AudioGubbins-Test';

/**
 * The header's value for a test: the project's name, then each part of the
 * test's title path, its file, each group it is in and its own title, each
 * encoded as a URI component and separated by spaces.
 *
 * Encoded, any character a title holds survives a header value, which carries
 * visible ASCII alone, and no part holds a space, so the parts can be split
 * apart and decoded again.
 */
export function testLabel(project: string, titlePath: readonly string[]): string {
  return [project, ...titlePath].map((part) => encodeURIComponent(part)).join(' ');
}

/** The options the suite adds to Playwright's, each set in a project's `use`. */
export interface SuiteOptions {
  /**
   * The touch points every page of the test reports as
   * `navigator.maxTouchPoints`, or nothing to leave the engine's own.
   *
   * iPadOS Safari sends the Mac's agent, and a page tells an iPad from a Mac by
   * its touch points alone, more than one on an iPad. Playwright's WebKit
   * reports none even with touch emulated, so a project that stands for an iPad
   * sets the iPad's here, or its pages read a Mac. Only such a project sets it,
   * which a rule in `tests/architecture/browser-suite.test.ts` holds.
   */
  readonly touchPoints: number | undefined;
}

export const test = base.extend<SuiteOptions>({
  touchPoints: [undefined, { option: true }],

  // On the context rather than on one page, so every page the test opens,
  // popups included, reports the same, and before any script of the page
  // runs, so the application reads the value from its first probe.
  context: async ({ context, touchPoints }, use) => {
    if (touchPoints !== undefined) {
      await context.addInitScript((points) => {
        Object.defineProperty(Navigator.prototype, 'maxTouchPoints', {
          configurable: true,
          enumerable: true,
          get: () => points,
        });
      }, touchPoints);
    }
    await use(context);
  },

  extraHTTPHeaders: async ({ extraHTTPHeaders }, use, testInfo) => {
    await use({
      ...extraHTTPHeaders,
      [TEST_HEADER]: testLabel(testInfo.project.name, testInfo.titlePath),
    });
  },
});
