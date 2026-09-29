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
import { SelectionFacet, activeFacet, pixelOf } from '@audiogubbins/timeline';

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
  context.editorViews.measured(panel, 1000, found.length);
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
  it('keep their own zoom and tool while sharing the selection and the markers', () => {
    openView('one', 'test:loop');
    openView('two', 'test:loop');

    run('editor.zoom-in', { view: 'one' });
    run('editor.tool-hand', { view: 'one' });
    run('editor.select-time', { view: 'two', start: 4800, end: 9600 });
    run('editor.add-marker', { view: 'two', at: 1200 });

    expect(view('one').viewport.zoom).not.toEqual(view('two').viewport.zoom);
    expect(view('one').tool).toBe('hand');
    expect(view('two').tool).toBe('select');
    expect(context.selections.of('test:loop').time).toEqual({ start: 4800, end: 9600 });
    const loop = context.assets.find('test:loop');
    if (loop === undefined) throw new Error('No loop test.');
    expect(context.content.of(loop).markers.map((marker) => marker.position)).toEqual([
      0, 1200, 4800, 244_800,
    ]);
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

  it('extends by exactly one sample at each end', () => {
    run('editor.select-time', { start: 1000, end: 2000 });
    run('editor.extend-selection-forward');
    run('editor.extend-selection-back');

    expect(context.selections.of('test:tone-bursts').time).toEqual({ start: 999, end: 2001 });
  });

  it('makes the marker selected last the active facet, and keeps the range behind it', () => {
    openView('editor', 'test:loop');
    const loop = context.assets.find('test:loop');
    const [attack] = loop === undefined ? [] : context.content.of(loop).markers;
    if (attack === undefined) throw new Error('No marker.');

    run('editor.select-time', { start: 100, end: 200 });
    run('editor.select-marker', { marker: attack.id });

    const set = context.selections.of('test:loop');
    expect(activeFacet(set)).toBe(SelectionFacet.Objects);
    expect(set.time).toEqual({ start: 100, end: 200 });
  });

  it('refuses a range outside the asset, and one that ends before it starts', () => {
    expect(run('editor.select-time', { start: 10, end: 5 }).kind).toBe('refused');
    expect(run('editor.select-time', { start: 0, end: 480_001 }).kind).toBe('refused');
  });
});

describe('the marker commands (ADR-0047)', () => {
  beforeEach(() => {
    openView('editor', 'test:loop');
  });

  const markers = () => {
    const loop = context.assets.find('test:loop');
    return loop === undefined ? [] : context.content.of(loop).markers;
  };

  /** Runs what reverses an applied result. */
  function reverse(result: ExecutionResult<ShellContext>): void {
    if (result.kind !== 'applied' || result.entry === undefined) throw new Error('Not undoable.');
    for (const invocation of result.entry.inverse) bus.execute(context, invocation);
  }

  it('add a marker at the playhead, and remove it again by its inverse', () => {
    run('editor.set-playhead', { position: 24_000 });
    const added = run('editor.add-marker');

    expect(markers().map((marker) => [marker.displayName, marker.position])).toContainEqual([
      'Marker 4',
      24_000,
    ]);
    reverse(added);
    expect(markers().map((marker) => marker.displayName)).toEqual(['Attack', 'Sustain', 'Release']);
  });

  it('restore removed markers with the identities, names and positions they had', () => {
    const before = markers();
    run('editor.select-marker', { marker: before[1]?.id ?? '' });
    const removed = run('editor.remove-markers');

    expect(markers()).toHaveLength(2);
    expect(context.selections.of('test:loop').objects).toBeUndefined();
    reverse(removed);
    expect(markers()).toEqual(before);
  });

  it('move a marker, and move it back by its inverse', () => {
    const [first] = markers();
    const moved = run('editor.move-marker', { marker: first?.id ?? '', to: 960 });

    expect(markers()[0]?.position).toBe(960);
    reverse(moved);
    expect(markers()[0]?.position).toBe(0);
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
  it('marks the frame the playhead is in, named by its timecode', () => {
    openView('editor', 'test:loop');
    run('picture.open', { file: context.chosenFiles.offer(new File([], 'reference.webm')) });
    context.picture.element.dispatchEvent(new Event('loadedmetadata'));
    run('editor.set-playhead', { position: 48_000 + 100 });

    run('picture.mark-frame');

    const loop = context.assets.find('test:loop');
    const marker =
      loop === undefined
        ? undefined
        : context.content.of(loop).markers.find((each) => each.displayName.startsWith('Frame'));
    // At 25 frames a second a frame is 1920 samples, so the playhead is in
    // frame 25, which starts at one second.
    expect(marker).toMatchObject({ displayName: 'Frame 00:00:01:00', position: 48_000 });
  });

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
