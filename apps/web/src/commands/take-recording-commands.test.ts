import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  commandId,
  createCommandBus,
  createCommandRegistry,
  type CommandInvocation,
} from '@audiogubbins/commands';
import { createDiagnosticCentre, createLogStore } from '@audiogubbins/diagnostics';
import { RecordingEnding } from '@audiogubbins/project-format';

import { CaptureWriter } from '../testing/capture-writer.js';
import { firstRecorded } from '../testing/recorded-takes.js';
import { projectWorld, type ProjectWindow } from '../testing/project-context.js';
import { DESCRIPTORS } from '../testing/shell-context.js';
import { everythingQueued } from '../testing/waiting.js';
import { shellCommands } from './shell-commands.js';

/** The rate the fake input records at. */
const RATE = 48_000;

const windows: ProjectWindow[] = [];
afterEach(() => {
  for (const window of windows.splice(0)) window.takeDown();
});

/** A window with a project open to change here, and a runner of its commands. */
async function inAProject() {
  const window = await projectWorld().window();
  windows.push(window);
  await window.runAndHear('file.create-project', { name: 'Harbour' });
  const registry = createCommandRegistry<typeof window.context>();
  for (const command of shellCommands(DESCRIPTORS)) registry.register(command);
  const bus = createCommandBus(
    registry,
    createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('commands'),
  );
  const run = (id: string, args?: CommandInvocation['arguments']) =>
    bus.execute(window.context, {
      commandId: commandId(id),
      ...(args === undefined ? {} : { arguments: args }),
    });
  const refusal = (id: string, args?: CommandInvocation['arguments']) => {
    const outcome = run(id, args);
    return outcome.kind === 'refused' ? outcome.failures[0].summary : outcome.kind;
  };
  return { window, run, refusal };
}

/** Arms the input of `window`'s project and waits for it to open. */
async function armed(
  scene: Awaited<ReturnType<typeof inAProject>>,
  args?: CommandInvocation['arguments'],
) {
  expect(scene.run('recording.arm', args).kind).toBe('applied');
  await everythingQueued();
  const capture = scene.window.recording.captures.at(-1);
  if (capture === undefined) throw new Error('No input opened.');
  return capture;
}

/** Waits until `window` says something containing `text`. */
async function heard(window: ProjectWindow, text: string): Promise<string> {
  await vi.waitFor(() => {
    expect(window.said.some((said) => said.includes(text))).toBe(true);
  });
  return window.said.find((said) => said.includes(text)) ?? '';
}

/** The project as `window` holds it. */
function projectOf(window: ProjectWindow) {
  const open = window.projects.project.get();
  if (open.kind !== 'open') throw new Error('No project is open.');
  return open.snapshot.model.state;
}

describe('recording a take', () => {
  it('records the capture into a new stack, stops once, and arms the next take of that stack', async () => {
    const scene = await inAProject();
    const capture = await armed(scene);
    expect(scene.run('recording.record').kind).toBe('applied');
    expect(capture.records).toEqual([0]);
    const take = new CaptureWriter(capture, 0);
    take.begin();
    take.post(RATE, (channel, frame) => ((frame + channel) % 100) / 128);
    await vi.waitFor(() => {
      expect(scene.window.context.recording.takes.progress.get().kind).toBe('recording');
    });

    expect(scene.run('recording.stop').kind).toBe('applied');
    expect(capture.stops).toEqual([0]);
    take.end();
    expect(await heard(scene.window, 'is recorded')).toBe('“Take 1” is recorded: 1.0 s.');

    const state = projectOf(scene.window);
    const [stack] = state.project.takeStacks.values();
    expect(stack?.name).toBe('Recording 1');
    expect(stack?.takes.map((one) => one.name)).toEqual(['Take 1']);
    const recorded = firstRecorded(state);
    expect(recorded.asset).toMatchObject({ origin: 'recorded', length: RATE });
    expect(recorded.ending).toBe(RecordingEnding.Stopped);
    // Successive recordings go into the stack that is armed (REQ-REC-089).
    const { session } = scene.window.context.recording.input.view.get();
    expect(session.kind === 'armed' && session.purpose).toEqual({ kind: 'take', stack: stack?.id });
    expect(scene.refusal('recording.stop')).toBe('Nothing is being recorded.');
  });

  it('puts the next take into the armed stack, chosen', async () => {
    const scene = await inAProject();
    const capture = await armed(scene);
    for (const name of ['Take 1', 'Take 2']) {
      scene.run('recording.record');
      const take = new CaptureWriter(capture, 0);
      take.begin();
      take.post(RATE / 2, () => 0.25);
      await vi.waitFor(() => {
        expect(scene.window.context.recording.takes.progress.get().kind).toBe('recording');
      });
      scene.run('recording.stop');
      take.end();
      await heard(scene.window, `“${name}” is recorded`);
    }
    const [stack] = projectOf(scene.window).project.takeStacks.values();
    expect(stack?.takes.map((one) => one.name)).toEqual(['Take 1', 'Take 2']);
    expect(stack?.chosen).toBe(stack?.takes[1]?.id);
  });

  it('stops a take whose input is lost, keeping what came, and says why it ended', async () => {
    const scene = await inAProject();
    const capture = await armed(scene);
    scene.run('recording.record');
    const take = new CaptureWriter(capture, 0);
    take.begin();
    take.post(RATE, () => 0.5);
    await vi.waitFor(() => {
      expect(scene.window.context.recording.takes.progress.get().kind).toBe('recording');
    });
    scene.window.recording.media.opened.at(-1)?.end();
    // The capture is told to stop where it is, and its channel ends.
    expect(capture.stops).toHaveLength(1);
    take.end();
    expect(await heard(scene.window, 'is recorded')).toContain(
      'It ended because the input was disconnected, so it may need review.',
    );
    expect(firstRecorded(projectOf(scene.window)).ending).toBe(RecordingEnding.DeviceLost);
  });

  it('stops by itself after the timed length, on the frame it was set for', async () => {
    const scene = await inAProject();
    expect(scene.run('recording.set-timed-stop', { seconds: 1 }).kind).toBe('applied');
    const capture = await armed(scene);
    scene.run('recording.record');
    // The capture is told the frame to stop before as the take is asked for.
    expect(capture.stops).toEqual([RATE]);
    const take = new CaptureWriter(capture, 0);
    take.begin();
    take.post(RATE, () => 0.5);
    take.end();
    expect(await heard(scene.window, 'is recorded')).toBe('“Take 1” is recorded: 1.0 s.');
    expect(firstRecorded(projectOf(scene.window)).ending).toBe(RecordingEnding.Timed);
  });

  it('counts in to the frame the take begins on, and records nothing when stopped while counting', async () => {
    const scene = await inAProject();
    scene.run('recording.set-count-in', { seconds: 2 });
    const capture = await armed(scene);
    expect(scene.run('recording.record').kind).toBe('applied');
    expect(capture.records).toEqual([2 * RATE]);
    expect(scene.window.context.recording.input.view.get().session.kind).toBe('counting-in');
    expect(scene.run('recording.stop').kind).toBe('applied');
    await everythingQueued();
    expect(scene.window.context.recording.input.view.get().session.kind).toBe('armed');
    expect(projectOf(scene.window).project.takeStacks.size).toBe(0);
    expect(scene.refusal('recording.stop')).toBe('Nothing is being recorded.');
  });

  it('says where the browser may suspend capture before a controlled recording, and stops when hidden', async () => {
    const scene = await inAProject();
    scene.run('recording.set-timed-stop', { seconds: 30 });
    const capture = await armed(scene);
    scene.run('recording.record');
    const take = new CaptureWriter(capture, 0);
    take.begin();
    take.post(RATE, () => 0.5);
    await vi.waitFor(() => {
      expect(scene.window.context.recording.takes.progress.get().kind).toBe('recording');
    });
    scene.window.recording.page.set('hidden');
    expect(scene.window.context.recording.input.view.get().session).toMatchObject({
      kind: 'stopping',
      reason: { kind: 'background-suspended' },
    });
    take.end();
    expect(await heard(scene.window, 'is recorded')).toContain(
      'It ended because the browser may have paused capture in the background',
    );
  });

  it('is refused, with the reason, in a tab that does not hold the project for writing', async () => {
    const world = projectWorld();
    const first = await world.window();
    windows.push(first);
    await first.runAndHear('file.create-project', { name: 'Harbour' });
    const second = await world.window();
    windows.push(second);
    const open = first.projects.project.get();
    if (open.kind !== 'open') throw new Error('No project is open.');
    await second.runAndHear('file.open', { project: open.snapshot.project });
    const outcome = second.run('recording.arm');
    expect(outcome.kind === 'refused' && outcome.failures[0].summary).toBe(
      'Another tab holds this project for writing, so this tab cannot arm or record into it.',
    );
  });
});
