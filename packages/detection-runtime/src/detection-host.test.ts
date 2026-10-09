import { describe, expect, it } from 'vitest';

import {
  MAXIMUM_QUALITY,
  QualityLevel,
  createCancellationSource,
  derivedSampleCount,
  namedQualityMode,
} from '@audiogubbins/domain';

import { DetectionHost, type DetectionSubject } from './detection-host.js';
import { FromDetectionWorkerKind, ToDetectionWorkerKind } from './detection-messages.js';
import { FAULTY_LENGTH, faultyDescription } from './testing/faulty-signal.js';
import { LocalDetectionWorker, turn } from './testing/local-detection-worker.js';

/** A host on one local worker, which it makes again after a fault. */
function rig() {
  const workers: LocalDetectionWorker[] = [];
  const host = new DetectionHost({
    createWorker: () => {
      const worker = new LocalDetectionWorker();
      workers.push(worker);
      return worker;
    },
  });
  const detections = (): number =>
    workers.reduce(
      (count, worker) =>
        count +
        worker.sent.filter((message) => message.kind === ToDetectionWorkerKind.Detect).length,
      0,
    );
  return { host, workers, detections };
}

/** The faulty signal as a subject, its audio made of `identity`. */
function subject(identity: string, changes: Partial<DetectionSubject> = {}): DetectionSubject {
  return {
    target: 'asset:1',
    identity,
    channels: 1,
    describe: faultyDescription,
    quality: MAXIMUM_QUALITY,
    range: { start: derivedSampleCount(0), end: derivedSampleCount(FAULTY_LENGTH) },
    assistants: ['repair'],
    detectors: {},
    ...changes,
  };
}

// Each detection reads seconds of audio through the repair assistant's
// detectors on the reference DSP, several times slower under the whole
// suite's load than alone, so the file has a budget of its own.
describe('the detection host', { timeout: 30_000 }, () => {
  it('answers an unchanged subject from the result it kept, and reads nothing', async () => {
    const { host, detections } = rig();
    const first = await host.detect(subject('plan A'));
    const again = await host.detect(subject('plan A'));

    expect(first.kind).toBe('done');
    expect(again).toEqual({
      kind: 'done',
      result: first.kind === 'done' ? first.result : undefined,
      kept: true,
    });
    expect(detections()).toBe(1);
  });

  it('reads again when what the audio is made of, what its steps learn from, its quality, range or assistants change', async () => {
    const { host, detections } = rig();
    await host.detect(subject('plan A'));
    const edited = await host.detect(subject('plan A, edited'));
    await host.detect(subject('plan A', { quality: namedQualityMode(QualityLevel.Draft) }));
    await host.detect(
      subject('plan A', {
        range: { start: derivedSampleCount(0), end: derivedSampleCount(48_000) },
      }),
    );
    await host.detect(subject('plan A', { assistants: ['restoration'] }));
    // The same assistants judging by other values find other things.
    await host.detect(subject('plan A', { detectors: { clicks: {} } }));
    await host.detect(
      subject('plan A', {
        assistants: ['repair', 'silence'],
        detectors: { silence: { threshold: -40 } },
      }),
    );
    await host.detect(
      subject('plan A', {
        assistants: ['repair', 'silence'],
        detectors: { silence: { threshold: -41 } },
      }),
    );
    // The same audio heard, its steps learning from audio before a rack.
    await host.detect(
      subject('plan A', {
        learning: { identity: 'plan A, unracked', channels: 1, describe: faultyDescription },
      }),
    );

    expect(edited).toMatchObject({ kind: 'done', kept: false });
    expect(detections()).toBe(9);
    // Values set in another order are the same values.
    const same = await host.detect(
      subject('plan A', {
        assistants: ['repair', 'silence'],
        detectors: { silence: { threshold: -41 }, clicks: {} },
      }),
    );
    expect(detections()).toBe(10);
    const again = await host.detect(
      subject('plan A', {
        assistants: ['repair', 'silence'],
        detectors: { clicks: {}, silence: { threshold: -41 } },
      }),
    );
    expect(same.kind).toBe('done');
    expect(again).toMatchObject({ kind: 'done', kept: true });
  });

  it('reports progress in frames as the worker reads', async () => {
    const { host } = rig();
    const progress: number[] = [];
    await host.detect(subject('plan A'), {
      onProgress: (framesRead, framesTotal) => {
        expect(framesTotal).toBe(FAULTY_LENGTH);
        progress.push(framesRead);
      },
    });

    expect(progress.at(-1)).toBe(FAULTY_LENGTH);
    expect(progress).toEqual(progress.toSorted((one, other) => one - other));
  });

  it('ends a detection as cancelled when its signal is aborted, and tells the worker', async () => {
    const { host, workers } = rig();
    const cancellation = createCancellationSource();
    const outcome = host.detect(subject('plan A'), { signal: cancellation.signal });
    await turn();
    cancellation.cancel();

    expect(await outcome).toEqual({ kind: 'cancelled' });
    expect(workers[0]?.sent.map((message) => message.kind)).toEqual([
      ToDetectionWorkerKind.Detect,
      ToDetectionWorkerKind.Cancel,
    ]);
    // Nothing was kept of it: asked again, it is read again.
    await turn();
    await host.detect(subject('plan A'));
    expect(workers[0]?.answered(FromDetectionWorkerKind.Done)).toBe(1);
  });

  it('ends a detection superseded by another of its target as cancelled', async () => {
    const { host } = rig();
    const first = host.detect(subject('plan A'));
    const second = host.detect(subject('plan B'));

    expect(await first).toEqual({ kind: 'cancelled' });
    expect((await second).kind).toBe('done');
  });

  it('fails every detection waiting when the worker fails, and makes a new one for the next', async () => {
    const { host, workers } = rig();
    const waiting = host.detect(subject('plan A'));
    const other = host.detect(subject('plan B', { target: 'region:2' }));
    workers[0]?.fault('It ran out of memory.');

    const failed = {
      kind: 'failed',
      reason: 'The detection worker stopped: It ran out of memory.',
    };
    expect(await waiting).toEqual(failed);
    expect(await other).toEqual(failed);
    expect(workers[0]?.terminated).toBe(true);
    expect((await host.detect(subject('plan A'))).kind).toBe('done');
    expect(workers).toHaveLength(2);
  });
});
