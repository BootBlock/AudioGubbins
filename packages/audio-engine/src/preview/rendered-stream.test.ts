import { describe, expect, it } from 'vitest';

import { FailureKind, createCancellationSource, failure } from '@audiogubbins/domain';

import { MediaReadFailure } from '../pcm/plan-content.js';
import { RenderPhase, RenderedStream } from './rendered-stream.js';

/** Frames each their own index plus one, so no made frame is silence. */
function counting(from: number, frames: number): Float32Array {
  return Float32Array.from({ length: frames }, (_, frame) => from + frame + 1);
}

/** Whether `promise` has settled once every queued task has run. */
async function settled(promise: Promise<unknown>): Promise<boolean> {
  let done = false;
  void promise.then(
    () => {
      done = true;
    },
    () => {
      done = true;
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  return done;
}

describe('a render read while it is made', () => {
  it('answers a read within what is made at once, and waits past it rather than answer silence', async () => {
    const stream = new RenderedStream(1, 1_000);
    stream.begin();
    stream.append([counting(0, 400)], 400);

    const within = [new Float32Array(100)];
    await stream.read(300, 100, within);
    expect(within[0]).toEqual(counting(300, 100));

    // Frames 300 to 600 reach past the 400 made: the read must wait for
    // them, never answering the 200 not made as zeros.
    const past = [new Float32Array(300)];
    const reading = stream.read(300, 300, past);
    expect(await settled(reading)).toBe(false);
    expect(past[0]?.every((sample) => sample === 0)).toBe(true);

    stream.append([counting(400, 300)], 300);
    await reading;
    expect(past[0]).toEqual(counting(300, 300));
    expect(stream.phase).toBe(RenderPhase.Making);

    stream.append([counting(700, 300)], 300);
    expect(stream.phase).toBe(RenderPhase.Made);
  });

  it('fails a read waiting, and every read after, with the reason the render failed', async () => {
    const stream = new RenderedStream(1, 1_000);
    stream.append([counting(0, 100)], 100);
    const waiting = stream.read(0, 500, [new Float32Array(500)]);
    const problem = failure('test.render-failed', FailureKind.Rejected, 'The model was refused.');
    stream.fail(problem);
    await expect(waiting).rejects.toBeInstanceOf(MediaReadFailure);
    await expect(waiting).rejects.toThrow('The model was refused.');
    await expect(stream.read(0, 10, [new Float32Array(10)])).rejects.toThrow(
      'The model was refused.',
    );
  });

  it('stops waiting for a read whose reader was cancelled', async () => {
    const stream = new RenderedStream(1, 1_000);
    const cancel = createCancellationSource();
    const waiting = stream.read(0, 500, [new Float32Array(500)], cancel.signal);
    cancel.cancel();
    await expect(waiting).rejects.toThrow();
  });
});
