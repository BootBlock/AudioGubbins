import { afterEach, describe, expect, it, vi } from 'vitest';

import { RecordingEnding } from '@audiogubbins/project-format';

import { CaptureWriter } from '../testing/capture-writer.js';
import { firstRecorded } from '../testing/recorded-takes.js';
import { projectWorld, type ProjectWindow } from '../testing/project-context.js';
import { everythingQueued } from '../testing/waiting.js';

/** The rate the fake input records at. */
const RATE = 48_000;

/**
 * What a take is placed by in the fake world, uncalibrated, in frames at
 * `RATE`: the context's base and output latency and the input's own.
 */
const PLACEMENT = Math.round((0.005 + 0.02 + 0.004) * RATE);

const windows: ProjectWindow[] = [];
afterEach(() => {
  for (const window of windows.splice(0)) window.takeDown();
});

/**
 * A window whose project holds a recording cut short: a take recorded for a
 * second and a half, then the project closed under it, as a reload would, and
 * opened again.
 */
async function cutShort(): Promise<ProjectWindow> {
  const window = await projectWorld().window();
  windows.push(window);
  await window.runAndHear('file.create-project', { name: 'Harbour' });
  const open = window.projects.project.get();
  if (open.kind !== 'open') throw new Error('No project is open.');
  const { project } = open.snapshot;
  window.run('recording.arm');
  await everythingQueued();
  const capture = window.recording.captures.at(-1);
  if (capture === undefined) throw new Error('No input opened.');
  window.run('recording.record');
  const take = new CaptureWriter(capture, 0);
  take.begin();
  take.post(RATE * 1.5, () => 0.5);
  await vi.waitFor(() => {
    const progress = window.context.recording.takes.progress.get();
    expect(progress.kind === 'recording' && progress.committed).toBe(RATE);
  });
  await window.runAndHear('file.close-project');
  // What is offered as the project shows open: the opening's own report,
  // before the worker is asked again.
  let offeredOnOpening: number | undefined;
  const stop = window.projects.project.subscribe(() => {
    if (offeredOnOpening === undefined && window.projects.project.get().kind === 'open') {
      offeredOnOpening = window.projects.interrupted.get().recordings.length;
    }
  });
  await window.runAndHear('file.open', { project });
  await vi.waitFor(() => {
    expect(offeredOnOpening).toBeDefined();
  });
  stop();
  expect(offeredOnOpening).toBe(1);
  return window;
}

describe('a recording cut short', () => {
  it('is offered when its project opens, with its length, and recovered as the take it began as, which ended unexpectedly', async () => {
    const window = await cutShort();
    await vi.waitFor(() => {
      expect(window.projects.interrupted.get().recordings).toHaveLength(1);
    });
    const [offered] = window.projects.interrupted.get().recordings;
    // Every frame that reached storage before the project closed is kept.
    expect(offered?.frames).toBe(RATE * 1.5);
    // The take is named and placed as it was when Record was pressed: the
    // input's latency, which a recovery cannot know, not none.
    expect(offered?.take).toEqual({
      name: 'Take 1',
      stackName: 'Recording 1',
      compensation: PLACEMENT,
    });

    const said = await window.runAndHear('recording.recover-interrupted', {
      session: offered?.session ?? '',
    });
    expect(said).toMatch(/^“Take 1” is recovered\. It ended because .*, so it may need review\.$/u);
    expect(window.projects.interrupted.get().recordings).toEqual([]);
    const open = window.projects.project.get();
    if (open.kind !== 'open') throw new Error('No project is open.');
    const recorded = firstRecorded(open.snapshot.model.state);
    expect(recorded.asset.length).toBe(RATE * 1.5);
    expect(recorded.take).toMatchObject({ name: 'Take 1', compensation: PLACEMENT });
    expect(recorded.stack.name).toBe('Recording 1');
    expect(recorded.ending).not.toBe(RecordingEnding.Stopped);
  });

  it('is discarded only once the person confirms, and kept when they do not', async () => {
    const window = await cutShort();
    await vi.waitFor(() => {
      expect(window.projects.interrupted.get().recordings).toHaveLength(1);
    });
    const session = window.projects.interrupted.get().recordings[0]?.session ?? '';
    expect(await window.runAndHear('recording.discard-interrupted', { session })).toMatch(
      /^Discard “Take 1”, the recording of 1\.5 s started .* for good\?/u,
    );
    expect(window.projects.interrupted.get().confirming).toBe(session);
    window.run('recording.keep-interrupted');
    expect(window.projects.interrupted.get().confirming).toBeUndefined();
    const unconfirmed = window.run('recording.confirm-discard-interrupted');
    expect(unconfirmed.kind).toBe('refused');

    window.run('recording.discard-interrupted', { session });
    expect(await window.runAndHear('recording.confirm-discard-interrupted')).toBe(
      'The recording is discarded.',
    );
    expect(window.projects.interrupted.get().recordings).toEqual([]);
    window.projects.interrupted.refresh();
    await everythingQueued();
    expect(window.projects.interrupted.get().recordings).toEqual([]);
  });
});
