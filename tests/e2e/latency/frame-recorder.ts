import type { Page } from '@playwright/test';

/**
 * How long an input takes to reach the screen, read in the page.
 *
 * Each input event the recorder is armed for stamps its own `timeStamp`, which
 * the browser sets when the input arrived, before any handler ran. A listener
 * on the window, in the bubbling phase, runs after the application's own, so
 * the frame it then asks for comes after every frame callback the application
 * asked for while handling the input: a canvas the editor redraws in its next
 * frame is drawn before the recorder's callback. A message posted from that
 * callback is delivered once the frame has been rendered, and its time is the
 * sample's end. The sample is therefore the time from the input to the end of
 * the first frame that could show its effect, which is what "pointer to paint"
 * measures, within the frame the compositor presents it in.
 *
 * A wait condition can hold a sample open past that first frame, for an input
 * whose effect is only due in a later one: the command palette is mounted by
 * React after the key that opens it, so its sample ends at the first frame
 * after the dialogue exists.
 */

/** The page-side state the recorder keeps, on the window. */
interface RecorderState {
  readonly samples: number[];
  pending: Promise<void> | undefined;
}

declare global {
  interface Window {
    /** The recorder's samples, for the suite to read. */
    __agLatency?: RecorderState;

    /** The listener armed last, so arming again replaces it. */
    __agLatencyListener?: { readonly type: string; readonly listener: (event: Event) => void };
  }
}

/** What the recorder samples, and when a sample ends. */
export interface RecorderArming {
  /** The input event each sample starts at. */
  readonly eventType: string;

  /**
   * The key a keyboard sample starts at, when the input is a chord and only its
   * last press opens what is measured: its character or, as a shortcut names a
   * key by its place on the keyboard, its code.
   */
  readonly key?: string;

  /**
   * A CSS selector that holds each sample open until an element it matches is
   * in the document. Absent, a sample ends at the first frame.
   */
  readonly until?: string;
}

/**
 * Arms the recorder on `page`. The samples already taken are discarded, so a
 * warm-up is thrown away by arming again.
 */
export async function armRecorder(page: Page, arming: RecorderArming): Promise<void> {
  await page.evaluate(
    ({ type, key, selector }) => {
      const previous = window.__agLatencyListener;
      if (previous !== undefined) window.removeEventListener(previous.type, previous.listener);
      const state: RecorderState = { samples: [], pending: undefined };
      window.__agLatency = state;

      const afterFrame = (): Promise<number> =>
        new Promise((resolve) => {
          requestAnimationFrame(() => {
            const channel = new MessageChannel();
            channel.port1.onmessage = () => {
              resolve(performance.now());
            };
            channel.port2.postMessage(undefined);
          });
        });

      const listener = (event: Event): void => {
        if (
          key !== undefined &&
          !(event instanceof KeyboardEvent && (event.key === key || event.code === key))
        ) {
          return;
        }
        const start = event.timeStamp;
        state.pending = (async () => {
          let end = await afterFrame();
          if (selector !== undefined) {
            while (document.querySelector(selector) === null) end = await afterFrame();
          }
          state.samples.push(end - start);
        })();
      };
      window.__agLatencyListener = { type, listener };
      window.addEventListener(type, listener);
    },
    { type: arming.eventType, key: arming.key, selector: arming.until },
  );
}

/** Waits until the sample the last input began has been taken. */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await window.__agLatency?.pending;
  });
}

/** The samples taken since the recorder was last armed, in milliseconds. */
export async function samplesOf(page: Page): Promise<readonly number[]> {
  return await page.evaluate(() => [...(window.__agLatency?.samples ?? [])]);
}
