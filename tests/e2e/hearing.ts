/**
 * Hearing what the page plays, sample for sample, and the steps the browser
 * specs that hear a project share: making a project, opening a sound from the
 * Assets panel, selecting a range of it and waiting for what the page says.
 *
 * What is heard is taken from the samples the page plays to its output: an init
 * script taps every node the page connects to its audio context's destination
 * with a recorder on the audio thread, which hands the page every render
 * quantum it is given while a hearing is captured. The application offers no
 * other sample-exact view of an edited sound, and playback is exactly what
 * "hears" asks for: the plan, the racks and the engine's output, all of it. A
 * script processor was tried first and dropped quanta while the page was busy;
 * the worklet drops none. The recorder is a module made from a blob, which the
 * page's policy refuses a worklet, so a spec that hears sets the policy aside
 * for its own pages (`bypassCSP`).
 */

import { expect, type Locator, type Page } from '@playwright/test';

import { editorPanel, pointAt, runCommand, scopeOf } from './editor.js';

/** How long the audio context may take to start and a hearing to play. */
const HEARING = 60_000;

/** The strip under the menu bar that says what project is open. */
export function banner(page: Page): Locator {
  return page.getByRole('region', { name: 'Project' });
}

/** The panel whose heading is `title`. */
export function panelTitled(page: Page, title: string): Locator {
  return page
    .locator('section.ag-panel')
    .filter({ has: page.getByRole('heading', { name: title, level: 2, exact: true }) });
}

/**
 * Waits for the page to say `text` in a polite live region: it says each
 * sentence in one of two regions in turn, so a repeat is heard.
 */
export async function said(page: Page, text: string): Promise<void> {
  await expect(
    page.locator('.ag-live-regions [role="status"]').filter({ hasText: text }),
  ).toHaveCount(1);
}

/**
 * The recorder, an audio worklet processor: while recording, it posts each
 * render quantum of the first two channels it is given to the page, from the
 * audio thread, so none is dropped however busy the page is.
 */
export const TAP_PROCESSOR = `
registerProcessor('ag-hearing-tap', class extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;
    this.port.onmessage = (event) => {
      this.recording = event.data === 'start';
    };
  }
  process(inputs) {
    if (this.recording) {
      const input = inputs[0] ?? [];
      const silence = new Float32Array(128);
      const left = input[0] ?? silence;
      this.port.postMessage([left.slice(), (input[1] ?? left).slice()]);
    }
    return true;
  }
});
`;

/**
 * Taps every node the page connects to an audio context's destination, from
 * before the application's first script runs, with the recorder above, and
 * keeps what it records between the events `ag-hearing-start` and
 * `ag-hearing-stop` as `agHeard` on the window, quantum by quantum. Each
 * context loads the recorder, from a blob the script makes, as the context is
 * made, and its own worklet modules after it, so the recorder is there before
 * anything plays. `agQuiet` says whether a tenth of a second of silence has
 * followed sound.
 */
export function tapTheOutput(processor: string): void {
  const module = URL.createObjectURL(new Blob([processor], { type: 'text/javascript' }));
  // Taken as they are, to be called on the objects the page calls them on.
  const addModule: unknown = Reflect.get(AudioWorklet.prototype, 'addModule');
  const connect: unknown = Reflect.get(AudioNode.prototype, 'connect');
  if (typeof addModule !== 'function' || typeof connect !== 'function') {
    throw new Error('This browser has no audio worklets.');
  }
  // The page's own `addModule`, called on `worklet` with `args`.
  const load = (worklet: AudioWorklet, args: readonly unknown[]): Promise<unknown> => {
    const loading: unknown = Reflect.apply(addModule, worklet, args);
    return Promise.resolve(loading);
  };
  const ready = new WeakMap<AudioWorklet, Promise<unknown>>();
  const taps = new WeakMap<BaseAudioContext, AudioWorkletNode>();
  const ports = new Set<MessagePort>();
  let heard: number[][][] = [];
  let recording = false;
  let sounded = false;
  let quietFor = 0;
  const Made = window.AudioContext;
  window.AudioContext = class TappedContext extends Made {
    constructor(options?: AudioContextOptions) {
      super(options);
      ready.set(this.audioWorklet, load(this.audioWorklet, [module]));
    }
  };
  Reflect.set(
    AudioWorklet.prototype,
    'addModule',
    async function after(this: AudioWorklet, ...args: unknown[]): Promise<void> {
      await ready.get(this);
      await load(this, args);
    },
  );
  const tapOf = (context: BaseAudioContext): AudioWorkletNode => {
    const known = taps.get(context);
    if (known !== undefined) return known;
    const tap = new AudioWorkletNode(context, 'ag-hearing-tap', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
    });
    tap.port.onmessage = (event: MessageEvent<Float32Array[]>) => {
      if (!recording) return;
      const [left = new Float32Array(), right = new Float32Array()] = event.data;
      const silent = left.every((sample) => sample === 0) && right.every((sample) => sample === 0);
      sounded ||= !silent;
      quietFor = silent ? quietFor + left.length : 0;
      // A tenth of a second at 48 kHz.
      Reflect.set(window, 'agQuiet', sounded && quietFor >= 4_800);
      heard.push([Array.from(left), Array.from(right)]);
    };
    ports.add(tap.port);
    // Made by the Play a hearing waits on, after the hearing began.
    if (recording) tap.port.postMessage('start');
    // It writes nothing to its output: it reaches the destination only so the
    // context runs it, and adds silence there.
    Reflect.apply(connect, tap, [context.destination]);
    taps.set(context, tap);
    return tap;
  };
  Reflect.set(
    AudioNode.prototype,
    'connect',
    function tapped(this: AudioNode, ...args: unknown[]): unknown {
      const result: unknown = Reflect.apply(connect, this, args);
      const [destination, output] = args;
      if (destination instanceof AudioDestinationNode) {
        Reflect.apply(connect, this, [tapOf(this.context), output ?? 0]);
      }
      return result;
    },
  );
  window.addEventListener('ag-hearing-start', () => {
    heard = [];
    sounded = false;
    quietFor = 0;
    Reflect.set(window, 'agQuiet', false);
    recording = true;
    for (const port of ports) port.postMessage('start');
  });
  window.addEventListener('ag-hearing-stop', () => {
    recording = false;
    for (const port of ports) port.postMessage('stop');
    Reflect.set(window, 'agHeard', heard);
  });
}

/** One hearing: the two channels the output was given, its first sound to its last. */
export interface Hearing {
  readonly left: Float32Array;
  readonly right: Float32Array;
}

/** Whether what the page kept is chunks of two channels of samples. */
function isChunks(value: unknown): value is readonly (readonly (readonly number[])[])[] {
  return (
    Array.isArray(value) &&
    value.every(
      (chunk) =>
        Array.isArray(chunk) &&
        chunk.length === 2 &&
        chunk.every(
          (channel) =>
            Array.isArray(channel) && channel.every((sample) => typeof sample === 'number'),
        ),
    )
  );
}

/** `chunks`, joined, from the first frame either channel sounds to the last. */
function hearingOf(chunks: readonly (readonly (readonly number[])[])[]): Hearing {
  const joined = (channel: number) =>
    Float32Array.from(chunks.flatMap((chunk) => chunk[channel] ?? []));
  const left = joined(0);
  const right = joined(1);
  const sounds = (frame: number) => (left[frame] ?? 0) !== 0 || (right[frame] ?? 0) !== 0;
  let first = 0;
  while (first < left.length && !sounds(first)) first += 1;
  let last = left.length - 1;
  while (last > first && !sounds(last)) last -= 1;
  return { left: left.slice(first, last + 1), right: right.slice(first, last + 1) };
}

/** The Transport panel's reading of what the transport is doing. */
function transportState(page: Page): Locator {
  return page.locator('xpath=//dt[normalize-space()="Transport"]/following-sibling::dd[1]');
}

/** Plays what the editor in use shows, start to end, and gives what was heard. */
export async function hear(page: Page): Promise<Hearing> {
  await runCommand(page, 'Move the playhead to the start');
  await page.getByRole('tab', { name: 'Transport', exact: true }).click();
  await page.evaluate(() => window.dispatchEvent(new Event('ag-hearing-start')));
  // The Transport's own button: a click, the gesture a browser starts audio on.
  await page
    .getByRole('group', { name: 'Transport', exact: true })
    .getByRole('button', { name: 'Play', exact: true })
    .click();
  // Played through: the tap heard sound, then silence once the transport
  // stopped, so nothing played is still on its way to it.
  await expect
    .poll(async () => await page.evaluate((): unknown => Reflect.get(window, 'agQuiet')), {
      timeout: HEARING,
    })
    .toBe(true);
  await expect(transportState(page)).toHaveText('Stopped');
  const kept = await page.evaluate((): unknown => {
    window.dispatchEvent(new Event('ag-hearing-stop'));
    return Reflect.get(window, 'agHeard');
  });
  if (!isChunks(kept)) throw new Error('The page kept no hearing.');
  return hearingOf(kept);
}

/** The largest difference between `one` and `other` from `start` to `end`. */
export function largestDifference(
  one: Float32Array,
  other: Float32Array,
  start: number,
  end: number,
): number {
  let most = 0;
  for (let frame = start; frame < end; frame += 1) {
    most = Math.max(most, Math.abs((one[frame] ?? 0) - (other[frame] ?? 0)));
  }
  return most;
}

/** Makes a project through the banner's New project button, and waits for it to open. */
export async function makeProject(page: Page, name: string): Promise<void> {
  await banner(page).getByRole('button', { name: 'New project…' }).click();
  const dialogue = page.getByRole('dialog', { name: 'Projects' });
  await dialogue.getByRole('textbox', { name: 'Name' }).fill(name);
  await dialogue.getByRole('button', { name: 'Make the project' }).click();
  await expect(dialogue).toBeHidden();
  await expect(banner(page).getByText(`“${name}”`, { exact: true })).toBeVisible();
}

/** A stretch of frames. */
export interface Range {
  readonly start: number;
  readonly end: number;
}

/** A selection's scope as the editor writes it in samples. */
const SCOPE = /^(?<start>[\d,]+) to (?<end>[\d,]+) on every channel$/u;

/**
 * Selects about `range` of the sound in `panel` by a drag, down across its
 * first `lanes` lanes so every channel of a sound of that many is selected, and
 * gives what it selected.
 */
export async function selectRange(
  page: Page,
  panel: Locator,
  range: Range,
  lanes = 1,
): Promise<Range> {
  const from = await pointAt(panel, range.start);
  const to = await pointAt(panel, range.end, lanes - 0.5);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
  await expect(scopeOf(panel)).toHaveText(SCOPE);
  const parts = SCOPE.exec(await scopeOf(panel).innerText())?.groups;
  const frames = (text: string | undefined) => Number((text ?? '').replaceAll(',', ''));
  return { start: frames(parts?.['start']), end: frames(parts?.['end']) };
}

/** Opens the sound or the region named `name` from the Assets panel. */
export async function openFromAssets(page: Page, name: string): Promise<void> {
  await runCommand(page, 'Show the Assets panel');
  await panelTitled(page, 'Assets').getByRole('button', { name, exact: true }).click();
  await expect(editorPanel(page).locator('.ag-editor-asset-name')).toHaveText(name);
}
