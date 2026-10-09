import { expect, type Locator, type Page } from '@playwright/test';

import { sine, wavFile, type SignalFixture } from '../../packages/test-fixtures/src/index.js';
import { editorPanel, pointAt, runCommand, scopeOf, writeTimesAs } from './editor.js';
import { menuBarMenu, openFresh } from './shell.js';
import { test } from './test.js';

/**
 * The effect rack, driven in a real browser (the packet's acceptance: "A
 * browser test applies a chain to a selection, gives a region a rack, reloads,
 * and hears the same project"; ADR-0060).
 *
 * A short sound is imported into a project; a chain holding a gain is applied
 * over a selected range of it from the Effects rack panel, and its gain set; a
 * region is made of another range and given a rack holding a gain, and that
 * gain set too. What is heard is then captured: the sound played processed,
 * played as the original, and the region played; the page is reloaded; and the
 * sound and the region are played again. The two hearings of the project are
 * the same samples, and what is heard processed differs from the original by
 * each gain over its own range, and is the original everywhere else, so a rack
 * dropped on the way, or kept but not heard, fails.
 *
 * What is heard is taken from the samples the page plays to its output: an init
 * script taps every node the page connects to its audio context's destination
 * with a recorder on the audio thread, which hands the page every render
 * quantum it is given while a hearing is captured. The application offers no
 * other sample-exact view of an edited sound: it renders only the test signal
 * offline, export is Phase 09's, and the waveform it draws is peaks, not
 * samples. Playback is also exactly what "hears" asks for: the plan, the racks
 * run by the feeder or read from the preview worker's render, and the engine's
 * output, all of it. A script processor was tried first and dropped quanta
 * while the page was busy; the worklet drops none.
 *
 * Every step is taken as a person takes it, through the banner, the menus, the
 * palette, the Effects rack panel and the editor; the file is chosen through
 * the file input the application falls back to, as in the core-editing spec.
 */

const RATE = 48_000;
const LENGTH = 2 * RATE;

/**
 * Two seconds of mono: a cosine, so the first sample, and the first of each
 * range below, is far from silence, with a second partial over it.
 */
const QUAY: SignalFixture = {
  ...sine(440, { sampleRate: RATE, length: LENGTH }),
  channels: [
    Float32Array.from(
      { length: LENGTH },
      (_, frame) =>
        0.25 * Math.cos((2 * Math.PI * 440 * frame) / RATE) +
        0.1 * Math.sin((2 * Math.PI * 1_210 * frame) / RATE),
    ),
  ],
};

/** The range the chain processes, and the region's, in frames. */
const PROCESSED = { start: 12_000, end: 36_000 } as const;
const REGION = { start: 48_000, end: 72_000 } as const;

/** The gains set, in decibels: the selection's chain's and the region's rack's. */
const SELECTION_GAIN = -6;
const REGION_GAIN = 6;

/** How long the audio context may take to start and a hearing to play. */
const HEARING = 60_000;

/** The strip under the menu bar that says what project is open. */
function banner(page: Page): Locator {
  return page.getByRole('region', { name: 'Project' });
}

/** The panel whose heading is `title`. */
function panelTitled(page: Page, title: string): Locator {
  return page
    .locator('section.ag-panel')
    .filter({ has: page.getByRole('heading', { name: title, level: 2, exact: true }) });
}

/**
 * Waits for the page to say `text` in a polite live region: it says each
 * sentence in one of two regions in turn, so a repeat is heard.
 */
async function said(page: Page, text: string): Promise<void> {
  await expect(
    page.locator('.ag-live-regions [role="status"]').filter({ hasText: text }),
  ).toHaveCount(1);
}

/**
 * The recorder, an audio worklet processor: while recording, it posts each
 * render quantum of the first two channels it is given to the page, from the
 * audio thread, so none is dropped however busy the page is.
 */
const TAP_PROCESSOR = `
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
function tapTheOutput(processor: string): void {
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
interface Hearing {
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
async function hear(page: Page): Promise<Hearing> {
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

/** The root mean square of `samples` from `start` to `end`, in decibels. */
function levelOf(samples: Float32Array, start: number, end: number): number {
  let sum = 0;
  for (let frame = start; frame < end; frame += 1) sum += (samples[frame] ?? 0) ** 2;
  return 10 * Math.log10(sum / (end - start));
}

/** The largest difference between `one` and `other` from `start` to `end`. */
function largestDifference(
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

/**
 * The largest difference between `heard` and `expected`, frame for frame, in
 * units of float32 rounding at each expected sample: a sample heard is the
 * expected value rounded to float32, so no frame differs by more than one.
 */
function largestRoundingError(heard: Float32Array, expected: Float32Array): number {
  let most = 0;
  for (const [frame, wanted] of expected.entries()) {
    const unit = Math.max(Math.abs(wanted) * 2 ** -23, 2 ** -149);
    most = Math.max(most, Math.abs((heard[frame] ?? 0) - wanted) / unit);
  }
  return most;
}

/** Makes a project through the banner's New project button, and waits for it to open. */
async function makeProject(page: Page, name: string): Promise<void> {
  await banner(page).getByRole('button', { name: 'New project…' }).click();
  const dialogue = page.getByRole('dialog', { name: 'Projects' });
  await dialogue.getByRole('textbox', { name: 'Name' }).fill(name);
  await dialogue.getByRole('button', { name: 'Make the project' }).click();
  await expect(dialogue).toBeHidden();
  await expect(banner(page).getByText(`“${name}”`, { exact: true })).toBeVisible();
}

/** A stretch of frames. */
interface Range {
  readonly start: number;
  readonly end: number;
}

/** A selection's scope as the editor writes it in samples. */
const SCOPE = /^(?<start>[\d,]+) to (?<end>[\d,]+) on every channel$/u;

/** A whole number as the editor writes one, grouped: `24,000`. */
function whole(value: number): string {
  return value.toLocaleString('en-GB');
}

/** Selects about `range` of the sound in `panel` by a drag, and gives what it selected. */
async function selectRange(page: Page, panel: Locator, range: Range): Promise<Range> {
  const from = await pointAt(panel, range.start);
  const to = await pointAt(panel, range.end);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
  await expect(scopeOf(panel)).toHaveText(SCOPE);
  const parts = SCOPE.exec(await scopeOf(panel).innerText())?.groups;
  const frames = (text: string | undefined) => Number((text ?? '').replaceAll(',', ''));
  return { start: frames(parts?.['start']), end: frames(parts?.['end']) };
}

/**
 * Selects the gain the rack panel shows, which opens its controls, and sets
 * it to `decibels`, typed as a person types it.
 */
async function setGain(rack: Locator, decibels: number): Promise<void> {
  await rack.getByRole('button', { name: 'Gain', exact: true }).click();
  await expect(rack.getByRole('button', { name: 'Gain, selected', exact: true })).toBeVisible();
  const field = rack.getByRole('textbox', { name: 'Gain in dB, typed' });
  await field.fill(String(decibels));
  await field.press('Enter');
  await expect(field).toHaveValue(String(decibels));
}

/** A box on the page, as Playwright measures one. */
interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function overlaps(one: Box, other: Box): boolean {
  return (
    one.x < other.x + other.width &&
    other.x < one.x + one.width &&
    one.y < other.y + other.height &&
    other.y < one.y + one.height
  );
}

/** The smallest width a slider's track may have and still be set by a pointer. */
const SETTABLE_TRACK = 64;

/**
 * Every slider in the panel keeps its label, its track and its value apart and
 * inside the panel, however narrow the panel is docked, with a track wide
 * enough to set: the rack's controls are long ("Mix of" and the processor's
 * name), and a field that cannot shrink them must move the track under them.
 */
async function keepsItsSlidersApart(panel: Locator): Promise<void> {
  const within = await panel.boundingBox();
  if (within === null) throw new Error('The panel is not on screen.');
  const fields = panel.locator('.ag-slider-field');
  const count = await fields.count();
  expect(count).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    const field = fields.nth(index);
    const parts: Box[] = [];
    for (const part of ['.ag-slider-label', '.ag-slider', '.ag-slider-value']) {
      const box = await field.locator(part).boundingBox();
      if (box === null) continue;
      expect(
        box.x,
        `${part} of field ${String(index)} starts inside the panel`,
      ).toBeGreaterThanOrEqual(within.x);
      expect(
        box.x + box.width,
        `${part} of field ${String(index)} ends inside the panel`,
      ).toBeLessThanOrEqual(within.x + within.width);
      if (part === '.ag-slider') expect(box.width).toBeGreaterThanOrEqual(SETTABLE_TRACK);
      for (const other of parts)
        expect(overlaps(box, other), `${part} of field ${String(index)}`).toBe(false);
      parts.push(box);
    }
  }
}

/** Opens the sound or the region named `name` from the Assets panel. */
async function openFromAssets(page: Page, name: string): Promise<void> {
  await runCommand(page, 'Show the Assets panel');
  await panelTitled(page, 'Assets').getByRole('button', { name, exact: true }).click();
  await expect(editorPanel(page).locator('.ag-editor-asset-name')).toHaveText(name);
}

test.describe('the effect rack', () => {
  // The recorder is a module made from a blob, which the page's policy
  // refuses a worklet; the policy is set aside for this test's pages alone,
  // and the smoke suite holds the page to it.
  test.use({ viewport: { width: 1280, height: 1400 }, bypassCSP: true });

  test('applies a chain to a selection, gives a region a rack, reloads, and hears the same project', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.addInitScript(() => {
      for (const picker of ['showOpenFilePicker', 'showSaveFilePicker', 'showDirectoryPicker']) {
        Reflect.deleteProperty(window, picker);
      }
    });
    await page.addInitScript(tapTheOutput, TAP_PROCESSOR);
    await openFresh(page);
    await makeProject(page, 'Quayside');

    const choosing = page.waitForEvent('filechooser');
    await menuBarMenu(page, 'File').click();
    await page.getByRole('menuitem', { name: 'Import audio…' }).click();
    await (
      await choosing
    ).setFiles({ name: 'Quay.wav', mimeType: 'audio/wav', buffer: Buffer.from(wavFile(QUAY)) });
    await expect(page.getByText('“Quay” is imported and open.').first()).toBeVisible();
    const editor = editorPanel(page);
    await writeTimesAs(page, editor, 'Samples');
    await runCommand(page, 'Show the Effects rack panel');
    const rack = panelTitled(page, 'Effects rack');

    const processed =
      await test.step('A chain holding a gain is applied over the selection, and its gain set', async () => {
        const selected = await selectRange(page, editor, PROCESSED);
        await rack.getByRole('button', { name: 'Add over the selection' }).click();
        await page.getByRole('menuitem', { name: 'Gain', exact: true }).click();
        await said(page, 'Added “Gain” over the selection of Quay, in a chain of its own.');
        await rack
          .getByRole('button', {
            name: `From ${whole(selected.start)} to ${whole(selected.end)}: Gain`,
          })
          .click();
        await setGain(rack, SELECTION_GAIN);
        await keepsItsSlidersApart(rack);
        return selected;
      });

    const region =
      await test.step('A region is made, opened, and given a rack holding a gain, its gain set', async () => {
        const selected = await selectRange(page, editor, REGION);
        await runCommand(page, 'Make a region of the selection');
        await said(page, 'Region 1 made of Quay.');
        await runCommand(page, 'Select the next region');
        await runCommand(page, 'Open the region in this view');
        await said(page, 'Region 1 is open.');
        await rack.getByRole('button', { name: 'Add a processor' }).click();
        await page.getByRole('menuitem', { name: 'Gain', exact: true }).click();
        await said(page, 'Gave “Region 1” a rack, with “Gain” in it.');
        await setGain(rack, REGION_GAIN);
        await expect(
          page.getByRole('contentinfo', { name: 'Status' }).getByText('Saved'),
        ).toBeVisible();
        return selected;
      });

    const before =
      await test.step('The project is heard: the region, the sound processed, and the original', async () => {
        const regionHeard = await hear(page);
        await openFromAssets(page, 'Quay');
        const processedHeard = await hear(page);
        await runCommand(page, 'Hear the original');
        const originalHeard = await hear(page);
        await runCommand(page, 'Hear it processed');
        return { region: regionHeard, processed: processedHeard, original: originalHeard };
      });

    await test.step('What is heard processed differs from the original over each range alone', () => {
      const heard = before;
      expect(heard.processed.left.length).toBe(LENGTH);
      expect(heard.original.left.length).toBe(LENGTH);
      // Inside the processed range, a millisecond in from each end, the
      // chain's gain; everywhere outside it, the original to the sample.
      const inside = [processed.start + 48, processed.end - 48] as const;
      expect(
        levelOf(heard.processed.left, ...inside) - levelOf(heard.original.left, ...inside),
      ).toBeCloseTo(SELECTION_GAIN, 1);
      expect(largestDifference(heard.processed.left, heard.original.left, 0, processed.start)).toBe(
        0,
      );
      expect(
        largestDifference(heard.processed.left, heard.original.left, processed.end, LENGTH),
      ).toBe(0);
      // The region heard is its span of the sound, through its rack's gain,
      // sample for sample: a level alone would not tell another span.
      const span = region.end - region.start;
      const factor = 10 ** (REGION_GAIN / 20);
      for (const channel of ['left', 'right'] as const) {
        expect(heard.region[channel].length).toBe(span);
        const scaled = heard.original[channel]
          .slice(region.start, region.end)
          .map((sample) => sample * factor);
        expect(largestRoundingError(heard.region[channel], scaled)).toBeLessThanOrEqual(1);
      }
    });

    await page.reload();
    await expect(banner(page).getByText('“Quayside”', { exact: true })).toBeVisible();

    await test.step('After the reload the project is heard again, the same samples', async () => {
      await openFromAssets(page, 'Quay');
      const processedAgain = await hear(page);
      await openFromAssets(page, 'Region 1');
      const regionAgain = await hear(page);
      for (const [again, first] of [
        [processedAgain, before.processed],
        [regionAgain, before.region],
      ] as const) {
        expect(again.left.length).toBe(first.left.length);
        expect(largestDifference(again.left, first.left, 0, first.left.length)).toBe(0);
        expect(largestDifference(again.right, first.right, 0, first.right.length)).toBe(0);
      }
    });
  });
});
