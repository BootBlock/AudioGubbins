import { describe, expect, it, vi } from 'vitest';

import { TakeState, punchStackOf, type TakeStack } from '@audiogubbins/domain';

import { CaptureWriter } from '../testing/capture-writer.js';
import { holdPlatformFiles, windowWithAudio, type AudioWindow } from '../testing/project-audio.js';
import { inputOpened } from '../testing/recording-fakes.js';
import { everythingQueued } from '../testing/waiting.js';

holdPlatformFiles();

/** The rate the loop is at, and the fake input records at. */
const RATE = 48_000;

/** The range punched: the loop's third second. */
const RANGE = { start: 2 * RATE, end: 3 * RATE };

/** The project's only take stack, as `audio`'s window holds it now. */
function stackOf(audio: AudioWindow): TakeStack {
  const [stack] = audio.session.getSnapshot().model.state.project.takeStacks.values();
  if (stack === undefined) throw new Error('No take stack was made.');
  return stack;
}

/** Waits until the window says something containing `text`. */
async function heard(audio: AudioWindow, text: string): Promise<void> {
  await vi.waitFor(() => {
    expect(audio.window.said.some((said) => said.includes(text))).toBe(true);
  });
}

/**
 * Records one punch take through the capture of `audio`'s armed input: the
 * pre-roll plays, the capture is told the frames the take begins and stops on,
 * and the take runs through them.
 */
async function punchTake(audio: AudioWindow, name: string): Promise<void> {
  const { window } = audio;
  const capture = window.recording.captures.at(-1);
  if (capture === undefined) throw new Error('No input is open.');
  // The punch plays its audio, which the page reads again once the last take
  // changed the project.
  await vi.waitFor(() => {
    expect(window.context.assets.find(audio.entry)).toBeDefined();
  });
  const asked = capture.records.length;
  const recorded = window.run('recording.record');
  expect(recorded.kind === 'refused' ? recorded.failures[0].summary : recorded.kind).toBe(
    'applied',
  );
  await vi.waitFor(() => {
    expect(capture.records.length).toBe(asked + 1);
  });
  const recordAt = capture.records.at(-1) ?? 0;
  const stopAt = capture.stops.at(-1) ?? 0;
  const take = new CaptureWriter(capture, recordAt);
  take.begin();
  take.post(stopAt - recordAt, (channel) => (channel === 0 ? 0.25 : -0.25));
  take.end();
  await heard(audio, `“${name}” is recorded`);
}

/** The loop, a punch armed over its third second, and two takes punched into it. */
async function punched(): Promise<AudioWindow> {
  const audio = await windowWithAudio();
  const { window } = audio;
  window.context.editorViews.open('editor', audio.asset());
  window.context.editorViews.measured('editor', 1000, audio.asset().length);
  window.context.editorViews.focus('editor');
  window.run('editor.select-time', RANGE);
  expect(window.run('recording.arm-punch').kind).toBe('applied');
  await inputOpened(window.recording);
  await punchTake(audio, 'Take 1');
  await punchTake(audio, 'Take 2');
  return audio;
}

describe('a punch and the write lease', () => {
  it('records nothing where the project was taken over while the pre-roll played (REQ-STOR-098)', async () => {
    const audio = await windowWithAudio();
    const { window } = audio;
    window.context.editorViews.open('editor', audio.asset());
    window.context.editorViews.measured('editor', 1000, audio.asset().length);
    window.context.editorViews.focus('editor');
    window.run('editor.select-time', RANGE);
    expect(window.run('recording.arm-punch').kind).toBe('applied');
    const capture = await inputOpened(window.recording);
    await vi.waitFor(() => {
      expect(window.context.assets.find(audio.entry)).toBeDefined();
    });
    expect(window.run('recording.record').kind).toBe('applied');

    // Another tab takes the project over before the pre-roll reaches the take.
    const held = audio.session.getSnapshot;
    vi.spyOn(audio.session, 'getSnapshot').mockImplementation(() => ({
      ...held(),
      access: {
        kind: 'read-only',
        reason: { kind: 'busy', owner: { instance: 'window-2', label: 'another tab' } },
      },
    }));

    await heard(audio, 'Another tab holds this project for writing');
    expect(capture.records).toEqual([]);
    expect(window.context.recording.input.view.get().session.kind).toBe('armed');
  });
});

describe('a punch and its takes', () => {
  it('records each take through the pre-roll and post-roll, into one punch stack', async () => {
    const audio = await punched();
    const capture = audio.window.recording.captures.at(-1);
    // The pre-roll begins two seconds before the range, which the loop's
    // start allows, and the post-roll ends one second after it.
    expect(capture?.records).toEqual([0, 0]);
    expect(capture?.stops).toEqual([4 * RATE, 4 * RATE]);
    const stack = stackOf(audio);
    expect(stack.takes.map((take) => take.name)).toEqual(['Take 1', 'Take 2']);
    expect(stack.punch).toMatchObject({ length: RATE, preRoll: 2 * RATE, postRoll: RATE });
    expect(stack.chosen).toBe(stack.takes[1]?.id);
    const chain = audio.session.getSnapshot().model.state.project.assets.get(audio.assetId)?.edits;
    expect(chain?.map(punchStackOf)).toEqual([stack.id]);
    expect(chain?.[0]).toMatchObject({ kind: 'process', range: RANGE });
  });

  it('chooses another take, which one undo gives back, and refuses to choose it again', async () => {
    const audio = await punched();
    const stack = stackOf(audio);
    const first = stack.takes[0];
    if (first === undefined) throw new Error('No first take.');
    const args = { stack: stack.id, take: first.id };
    await audio.window.runAndHear('take.choose', args);
    expect(stackOf(audio).chosen).toBe(first.id);
    expect(await audio.window.runAndHear('take.choose', args)).toContain('already');
    await audio.window.runAndHear('edit.undo');
    expect(stackOf(audio).chosen).toBe(stack.takes[1]?.id);
  });

  it('hears a take with it chosen without changing the project', async () => {
    const audio = await punched();
    const stack = stackOf(audio);
    const first = stack.takes[0];
    if (first === undefined) throw new Error('No first take.');
    await vi.waitFor(() => {
      expect(audio.window.context.assets.find(audio.entry)).toBeDefined();
    });
    const before = audio.session.getSnapshot().model.state;
    expect(audio.window.run('take.audition', { stack: stack.id, take: first.id }).kind).toBe(
      'applied',
    );
    await everythingQueued();
    expect(audio.session.getSnapshot().model.state).toBe(before);
    expect(audio.window.context.playback.programme()).toBe(`take:${stack.id}:${first.id}`);

    // Each take is heard where it is chosen: the punch reads another recording.
    const second = stack.takes[1];
    if (second === undefined) throw new Error('No second take.');
    audio.window.run('take.audition', { stack: stack.id, take: second.id });
    await everythingQueued();
    const loads = audio.window.audio.playback.latest().loads;
    const sources = loads.slice(-2).map((load) => JSON.stringify(load.sources));
    expect(sources).toHaveLength(2);
    expect(sources[0]).not.toBe(sources[1]);
  });

  it.each([
    ['take.reject', TakeState.Rejected],
    ['take.remove', TakeState.Removed],
  ] as const)('%s keeps the take, marked, and is refused a second time', async (id, state) => {
    const audio = await punched();
    const stack = stackOf(audio);
    const first = stack.takes[0];
    if (first === undefined) throw new Error('No first take.');
    const args = { stack: stack.id, take: first.id };
    await audio.window.runAndHear(id, args);
    expect(stackOf(audio).takes[0]?.state).toBe(state);
    const said = await audio.window.runAndHear(id, args);
    expect(said).toContain('already');
  });

  it('names and notes a take, duplicates and branches it, and keeps only the chosen take', async () => {
    const audio = await punched();
    const stack = stackOf(audio);
    const first = stack.takes[0];
    if (first === undefined) throw new Error('No first take.');
    const args = { stack: stack.id, take: first.id };
    await audio.window.runAndHear('take.rename', { ...args, name: 'Verse' });
    await audio.window.runAndHear('take.note', { ...args, note: 'Late on the downbeat' });
    expect(stackOf(audio).takes[0]).toMatchObject({ name: 'Verse', note: 'Late on the downbeat' });
    await audio.window.runAndHear('take.duplicate', args);
    expect(stackOf(audio).takes.map((take) => take.name)).toEqual([
      'Verse',
      'Take 2',
      'Verse (copy)',
    ]);
    expect(stackOf(audio).takes[2]?.asset).toBe(first.asset);
    await audio.window.runAndHear('take.branch', args);
    const stacks = [...audio.session.getSnapshot().model.state.project.takeStacks.values()];
    expect(stacks.map((one) => one.name)).toContain(`${stack.name} from Verse`);
    await audio.window.runAndHear('take-stack.consolidate', { stack: stack.id });
    expect(stackOf(audio).takes.filter((take) => take.state !== TakeState.Removed)).toHaveLength(1);
  });

  it('withdraws the punch, after which the stack can be removed, each undone by one undo', async () => {
    const audio = await punched();
    const stack = stackOf(audio);
    const refused = await audio.window.runAndHear('take-stack.remove', { stack: stack.id });
    expect(refused).not.toContain('is removed');
    await audio.window.runAndHear('take-stack.remove-punch', { stack: stack.id });
    const chain = audio.session.getSnapshot().model.state.project.assets.get(audio.assetId)?.edits;
    expect(chain).toEqual([]);
    await audio.window.runAndHear('edit.undo');
    expect(
      audio.session.getSnapshot().model.state.project.assets.get(audio.assetId)?.edits,
    ).toHaveLength(1);
  });

  it('shows a take in the Inspector, and the recording configuration again', async () => {
    const audio = await punched();
    const stack = stackOf(audio);
    const { recording } = audio.window.context;
    audio.window.run('take.inspect', { stack: stack.id, take: stack.takes[0]?.id ?? '' });
    expect(recording.inspected.get()).toEqual({ stack: stack.id, take: stack.takes[0]?.id });
    expect(recording.focus.get()).toBe(true);
    audio.window.run('take.inspect');
    expect(recording.inspected.get()).toBeUndefined();
  });
});
