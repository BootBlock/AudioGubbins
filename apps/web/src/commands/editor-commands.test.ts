import { beforeEach, describe, expect, it } from 'vitest';

import {
  commandId,
  createCommandBus,
  createCommandRegistry,
  type CommandBus,
  type CommandInvocation,
  type ExecutionResult,
} from '@audiogubbins/commands';
import { createDiagnosticCentre, createLogStore } from '@audiogubbins/diagnostics';
import { boundaryAt, pixelOf, samplesWithin } from '@audiogubbins/timeline';

import { PictureSoundDecoder, type DecodeSound } from '../picture/picture-sound.js';
import { playbackSettled } from '../testing/audio-fakes.js';
import { DESCRIPTORS, buildShellContext } from '../testing/shell-context.js';
import type { ShellContext } from './shell-context.js';
import { shellCommands } from './shell-commands.js';

type Arguments = NonNullable<CommandInvocation['arguments']>;

let context: ShellContext;
let bus: CommandBus<ShellContext>;
let fakes: ReturnType<typeof buildShellContext>['audio'];

function run(id: string, args?: Arguments): ExecutionResult<ShellContext> {
  return bus.execute(context, {
    commandId: commandId(id),
    ...(args === undefined ? {} : { arguments: args }),
  });
}

/** Shows `asset` in editor panel `panel`, a thousand pixels wide. */
function openView(panel: string, asset: string): void {
  const found = context.assets.find(asset);
  if (found === undefined) throw new Error(`No asset ${asset}.`);
  context.editorViews.open(panel, found);
  context.editorViews.measured(panel, { width: 1000, height: 300 }, found.length);
  context.editorViews.focus(panel);
}

function view(panel: string) {
  const entry = context.editorViews.entry(panel);
  if (entry === undefined) throw new Error(`No view in ${panel}.`);
  return entry.state;
}

beforeEach(() => {
  const built = buildShellContext();
  context = built.context;
  fakes = built.audio;
  const registry = createCommandRegistry<ShellContext>();
  for (const command of shellCommands(DESCRIPTORS)) registry.register(command);
  bus = createCommandBus(
    registry,
    createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('commands'),
  );
});

describe('two views of one asset (REQ-EDIT-061)', () => {
  it('keep their own zoom and tool while sharing the selection', () => {
    openView('one', 'test:loop');
    openView('two', 'test:loop');

    run('editor.zoom-in', { view: 'one' });
    run('editor.tool-hand', { view: 'one' });
    run('editor.select-time', { view: 'two', start: 4800, end: 9600 });

    expect(view('one').viewport.zoom).not.toEqual(view('two').viewport.zoom);
    expect(view('one').tool).toBe('hand');
    expect(view('two').tool).toBe('select');
    expect(context.selections.of('test:loop').time).toEqual({ start: 4800, end: 9600 });
  });
});

describe("a view's spectral settings (REQ-EDIT-061, REQ-EDIT-062)", () => {
  it('are its own, its band reaching half the asset rate, never below 20 Hz spaced by octave', () => {
    openView('one', 'test:tone-bursts');
    openView('two', 'test:tone-bursts');

    run('editor.spectral-scale-linear', { view: 'one' });
    run('editor.spectral-band-whole', { view: 'one' });
    run('editor.spectral-band-whole', { view: 'two' });

    expect(view('one').spectral).toEqual({ frequencyScale: 'linear', lowest: 0, highest: 24_000 });
    expect(view('two').spectral).toEqual({
      frequencyScale: 'logarithmic',
      lowest: 20,
      highest: 24_000,
    });
    expect(run('editor.spectral-band-whole', { view: 'two' }).kind).toBe('unchanged');
  });
});

describe("a view's spectrogram (ADR-0080, ADR-0082)", () => {
  beforeEach(() => {
    openView('one', 'test:tone-bursts');
    openView('two', 'test:tone-bursts');
  });

  it('is analysed as its own commands say, within the windows a spectrogram takes', () => {
    run('editor.spectrogram-window-longer', { view: 'one' });
    run('editor.spectrogram-window-hann', { view: 'one' });
    run('editor.spectrogram-overlap-8', { view: 'one' });

    expect(view('one').spectrogram.analysis).toEqual({
      windowLength: 4096,
      window: 'hann',
      overlap: 8,
    });
    expect(view('two').spectrogram.analysis).toEqual({
      windowLength: 2048,
      window: 'blackman-harris',
      overlap: 4,
    });
    for (let step = 0; step < 3; step += 1)
      run('editor.spectrogram-window-shorter', { view: 'two' });
    expect(view('two').spectrogram.analysis.windowLength).toBe(256);
    expect(run('editor.spectrogram-window-shorter', { view: 'two' })).toMatchObject({
      kind: 'refused',
    });
    expect(view('two').spectrogram.analysis.windowLength).toBe(256);

    expect(run('editor.spectrogram-analysis', { view: 'one', windowLength: 3000 })).toMatchObject({
      kind: 'refused',
    });
    run('editor.spectrogram-analysis', {
      view: 'one',
      windowLength: 32_768,
      window: 'blackman-harris',
    });
    expect(view('one').spectrogram.analysis).toEqual({
      windowLength: 32_768,
      window: 'blackman-harris',
      overlap: 8,
    });
  });

  it('spans the levels its range commands say, never past what a tile holds or narrower than 6 dB', () => {
    for (let step = 0; step < 3; step += 1) run('editor.spectrogram-floor-lower', { view: 'one' });
    // From -120 dBFS in steps of 6 down to the quietest level a tile holds.
    expect(view('one').spectrogram.range).toEqual({ floor: -127.5, ceiling: 0 });
    expect(run('editor.spectrogram-ceiling-raise', { view: 'one' }).kind).toBe('unchanged');

    run('editor.spectrogram-range', { view: 'two', floor: -30, ceiling: -24 });
    expect(view('two').spectrogram.range).toEqual({ floor: -30, ceiling: -24 });
    expect(run('editor.spectrogram-ceiling-lower', { view: 'two' })).toMatchObject({
      kind: 'refused',
    });
    expect(run('editor.spectrogram-floor-raise', { view: 'two' })).toMatchObject({
      kind: 'refused',
    });
    expect(run('editor.spectrogram-range', { view: 'two', floor: -30.2 })).toMatchObject({
      kind: 'refused',
    });
    expect(view('two').spectrogram.range).toEqual({ floor: -30, ceiling: -24 });

    run('editor.spectrogram-range-default', { view: 'two' });
    expect(view('two').spectrogram.range).toEqual({ floor: -120, ceiling: 0 });
  });

  it('is drawn in the ramp its view chooses', () => {
    run('editor.spectrogram-colours-greyscale', { view: 'one' });

    expect(view('one').spectrogram.colours).toBe('greyscale');
    expect(view('two').spectrogram.colours).toBe('theme');
    expect(run('editor.spectrogram-colours-theme', { view: 'two' }).kind).toBe('unchanged');
  });
});

describe('a selection (REQ-EDIT-063, REQ-EDIT-064)', () => {
  beforeEach(() => {
    openView('editor', 'test:tone-bursts');
  });

  it('is kept across zooming, scrolling and a change of tool', () => {
    run('editor.select-time', { start: 1000, end: 2000, channels: '1' });
    const made = context.selections.of('test:tone-bursts');

    run('editor.zoom-in');
    run('editor.scroll-forward');
    run('editor.tool-zoom');

    expect(context.selections.of('test:tone-bursts')).toBe(made);
    expect(made.channels).toEqual([1]);
  });

  it('extends with the playhead by exactly one sample, and shrinks back the same way', () => {
    // The keyboard could only grow a range, a sample a press, from wherever the
    // range was: a second of audio took 48,000 presses and a press too many
    // could not be taken back. The playhead is the moving end, as a text
    // field's caret is.
    run('editor.select-time', { start: 1000, end: 2000 });
    run('editor.set-playhead', { position: 2000 });
    run('editor.extend-selection-forward-sample');
    run('editor.extend-selection-forward-sample');
    run('editor.extend-selection-back-sample');

    expect(context.selections.of('test:tone-bursts').time).toEqual({ start: 1000, end: 2001 });
    expect(context.cues.of('test:tone-bursts')).toBe(2001);
  });

  it('extends with the playhead by a pixel of the view, growing the way the key points', () => {
    const perPixel = samplesWithin(view('editor').viewport, 1);
    run('editor.select-time', { start: 100_000, end: 200_000 });

    // The playhead is on neither end, so the end the key moves towards moves.
    run('editor.extend-selection-back');
    expect(context.selections.of('test:tone-bursts').time).toEqual({
      start: 100_000 - perPixel,
      end: 200_000,
    });
    run('editor.extend-selection-forward');
    run('editor.extend-selection-forward');
    expect(context.selections.of('test:tone-bursts').time).toEqual({
      start: 100_000 + perPixel,
      end: 200_000,
    });
  });

  it('starts a selection at the playhead and ends it at the playhead, as in and out points', () => {
    run('editor.set-playhead', { position: 24_000 });
    run('editor.selection-start-at-playhead');
    expect(context.selections.of('test:tone-bursts').time).toEqual({ start: 24_000, end: 480_000 });

    run('editor.set-playhead', { position: 72_000 });
    run('editor.selection-end-at-playhead');
    expect(context.selections.of('test:tone-bursts').time).toEqual({ start: 24_000, end: 72_000 });

    run('editor.set-playhead', { position: 12_000 });
    expect(run('editor.selection-end-at-playhead').kind).toBe('refused');
    expect(context.selections.of('test:tone-bursts').time).toEqual({ start: 24_000, end: 72_000 });
  });

  it('refuses a range outside the asset, and one that ends before it starts', () => {
    expect(run('editor.select-time', { start: 10, end: 5 }).kind).toBe('refused');
    expect(run('editor.select-time', { start: 0, end: 480_001 }).kind).toBe('refused');
  });
});

describe('zooming (ADR-0041)', () => {
  it('reaches single samples and comes back to the same place without drift', () => {
    openView('editor', 'test:long-session');
    run('editor.set-playhead', { position: 123_456_789 });
    // Onto a rung first: fitted to the width, the zoom is between two.
    run('editor.zoom-in');
    const start = view('editor').viewport;

    let steps = 0;
    while (run('editor.zoom-in').kind === 'applied') steps += 1;
    expect(view('editor').viewport.zoom).toEqual({ kind: 'pixels-per-sample', pixels: 256 });
    // The playhead is held under the pixel it was in at every rung, so the
    // single samples shown are the ones the person zoomed in on.
    const moved = pixelOf(view('editor').viewport, 123_456_789) - pixelOf(start, 123_456_789);
    expect(Math.abs(moved)).toBeLessThan(1);
    for (let step = 0; step < steps; step += 1) run('editor.zoom-out');

    expect(view('editor').viewport).toEqual(start);
  });
});

describe('zooming about a point (ADR-0041)', () => {
  /** The boundary under pixel `x` of the view, before and after running `id` about it. */
  function aboutAnchor(id: string, x: number, args: Arguments = {}, rungsIn = 1) {
    openView('editor', 'test:tone-bursts');
    const tones = context.assets.find('test:tone-bursts');
    if (tones === undefined) throw new Error('No tone bursts.');
    // Onto a rung first, and away from the playhead at the start, which a zoom
    // that names no point keeps where it is, and far enough in that a zoom out
    // is not stopped by either end of the asset.
    for (let rung = 0; rung < rungsIn; rung += 1) run('editor.zoom-in');
    run('editor.scroll', { pixels: 300 });
    const before = view('editor').viewport;
    const under = boundaryAt(before, x, tones.length);
    const result = run(id, { anchor: x, ...args });
    return { result, moved: pixelOf(view('editor').viewport, under) - x, before };
  }

  it('keeps the audio under the fingers, the wheel or the pointer where it was', () => {
    // A pinch, a Ctrl+wheel and a zoom-tool click each name the pixel they zoom
    // about, and a zoom that dropped it zoomed about the left edge, so the
    // audio under the person's fingers left the view; every suite passed.
    const { result, moved, before } = aboutAnchor('editor.zoom-by', 700, { factor: 0.5 });

    expect(result.kind).toBe('applied');
    expect(view('editor').viewport.zoom).not.toEqual(before.zoom);
    expect(Math.abs(moved)).toBeLessThan(1);
  });

  it('keeps it for a step in and a step out about a point, as the zoom tool takes them', () => {
    expect(Math.abs(aboutAnchor('editor.zoom-in', 640).moved)).toBeLessThan(1);
    expect(Math.abs(aboutAnchor('editor.zoom-out', 130, {}, 3).moved)).toBeLessThan(1);
  });
});

describe('the playhead and Play', () => {
  it('plays the asset in use at its own rate from where its playhead is parked', async () => {
    openView('editor', 'test:tone-bursts');
    run('editor.set-playhead', { position: 9600 });

    run('transport.play');
    await playbackSettled(context.audio);

    expect(fakes.playback.opened[0]?.rate).toBe(48_000);
    expect(fakes.playback.latest().seeks).toEqual([9600]);
    expect(context.playback.programme()).toBe('test:tone-bursts');
  });

  it('moves a transport that holds the asset when the playhead is set', async () => {
    openView('editor', 'test:tone-bursts');
    run('transport.play');
    await playbackSettled(context.audio);

    run('editor.set-playhead', { position: 2400 });

    expect(fakes.playback.latest().seeks).toContain(2400);
  });

  it('opens a context at another rate for an asset at another rate', async () => {
    openView('editor', 'test:tone-bursts');
    run('transport.play-test-signal');
    await playbackSettled(context.audio);
    run('transport.play');
    await playbackSettled(context.audio);

    expect(fakes.playback.opened.map((opened) => [opened.rate, opened.closed])).toEqual([
      [undefined, true],
      [48_000, false],
    ]);
  });
});

describe('the reference picture', () => {
  it('says why a file the browser cannot decode is not shown, and leaves the audio alone', () => {
    openView('editor', 'test:loop');
    run('picture.open', { file: context.chosenFiles.offer(new File([], 'broken.webm')) });
    Object.defineProperty(context.picture.element, 'error', { value: { code: 4 } });
    context.picture.element.dispatchEvent(new Event('error'));

    expect(context.picture.get().media).toEqual({
      kind: 'undecodable',
      name: 'broken.webm',
      reason: 'This browser cannot play this kind of video.',
    });
    expect(run('picture.mark-frame').kind).toBe('refused');
  });
});

describe("the reference picture's sound (REQ-EXEC-216)", () => {
  /** What the decoder was asked, and a sound of two channels it answers each time. */
  const asked: { file: Blob; signal: AbortSignal }[] = [];

  const decode: DecodeSound = (file, signal) => {
    asked.push({ file, signal });
    return Promise.resolve({ channels: [new Float32Array(480), new Float32Array(480)] });
  };

  /** The picture's sound decoded by `decode`, in a page with `available` bytes to spare. */
  function soundIn(available: number | undefined): void {
    asked.length = 0;
    context = {
      ...context,
      pictureSound: new PictureSoundDecoder({
        decode,
        picture: context.picture,
        catalogue: context.assets,
        logger: createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('editor'),
        resources: () => ({ availableMemoryBytes: available }),
      }),
    };
  }

  /** Opens a picture of ten seconds, as the fake element reports. */
  function openPicture(): void {
    openView('editor', 'test:loop');
    run('picture.open', { file: context.chosenFiles.offer(new File([], 'reel.webm')) });
    context.picture.element.dispatchEvent(new Event('loadeddata'));
  }

  it('reads nothing of the sound when a picture is opened', () => {
    soundIn(undefined);
    openPicture();

    expect(asked).toEqual([]);
    expect(context.picture.get().sound).toEqual({ kind: 'none' });
  });

  it('opens the sound as an asset when asked, within the memory the page can spare', async () => {
    soundIn(undefined);
    openPicture();

    expect(run('picture.extract-sound').kind).toBe('applied');
    expect(asked.map(({ file }) => file)).toEqual([context.picture.file]);
    await Promise.resolve();

    const { sound } = context.picture.get();
    expect(sound.kind).toBe('decoded');
    expect(sound.kind === 'decoded' && context.assets.find(sound.asset)?.name).toBe(
      'Sound of reel.webm',
    );
  });

  it('refuses before reading anything when the sound would need more than the page can spare', () => {
    // Ten seconds in eight channels is 15 MB; a quarter of 40 MB is 10 MB.
    soundIn(40e6);
    openPicture();

    const result = run('picture.extract-sound');

    expect(result.kind).toBe('refused');
    expect(result.kind === 'refused' && result.failures[0].summary).toContain(
      'This page can spare 10 MB for it.',
    );
    expect(asked).toEqual([]);
  });

  it('abandons the sound being extracted when the picture is closed', async () => {
    soundIn(undefined);
    openPicture();
    run('picture.extract-sound');

    run('picture.close');
    await Promise.resolve();

    expect(asked[0]?.signal.aborted).toBe(true);
    expect(context.assets.get().assets.map((asset) => asset.name)).not.toContain(
      'Sound of reel.webm',
    );
    expect(context.picture.get().sound).toEqual({ kind: 'none' });
  });
});
