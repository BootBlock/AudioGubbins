import { describe, expect, it } from 'vitest';

import { PcmDescriptionKind, type PcmDescription } from '@audiogubbins/audio-engine';
import {
  MAXIMUM_QUALITY,
  createCancellationSource,
  derivedSampleCount,
} from '@audiogubbins/domain';
import { defaultLoopSearch, type LoopAnalysisRequest } from '@audiogubbins/loop-analysis';
import {
  cutNoise,
  quarterPeriodShort,
  type LoopFixture,
} from '@audiogubbins/loop-analysis/testing';

import { DetectionHost, type DetectionWorkerPort } from './detection-host.js';
import {
  FromDetectionWorkerKind,
  ToDetectionWorkerKind,
  type ToDetectionWorker,
} from './detection-messages.js';
import type { LoopSubject, LoudnessSubject } from './job-subjects.js';
import { FAULTY_LENGTH, faultyDescription } from './testing/faulty-signal.js';
import { LocalDetectionWorker, turn } from './testing/local-detection-worker.js';

/** A host on one local worker, and how many requests of `kind` its workers were sent. */
function rig() {
  const workers: LocalDetectionWorker[] = [];
  const host = new DetectionHost({
    createWorker: () => {
      const worker = new LocalDetectionWorker();
      workers.push(worker);
      return worker;
    },
  });
  const sent = (kind: ToDetectionWorker['kind']): number =>
    workers.reduce(
      (count, worker) => count + worker.sent.filter((message) => message.kind === kind).length,
      0,
    );
  return { host, workers, sent };
}

function described(fixture: LoopFixture): PcmDescription {
  return {
    kind: PcmDescriptionKind.Pcm,
    sampleRate: fixture.sampleRate,
    channels: fixture.channels.map((channel) => channel.slice()),
  };
}

/** `value` frozen all the way down, so anything that wrote to it would throw. */
function frozen<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const one of Object.values(value)) frozen(one);
    Object.freeze(value);
  }
  return value;
}

/** A loop subject over `fixture`'s region, its audio made of `identity`. */
function loopSubject(
  identity: string,
  fixture: LoopFixture = quarterPeriodShort(),
  request: LoopAnalysisRequest = { loop: fixture.loop },
): LoopSubject {
  return {
    target: 'region:1',
    identity,
    channels: fixture.channels.length,
    describe: () => ({ heard: described(fixture), plain: described(fixture) }),
    quality: MAXIMUM_QUALITY,
    request,
  };
}

/** The faulty signal as a loudness subject, its audio made of `identity`. */
function loudnessSubject(identity: string): LoudnessSubject {
  return {
    target: 'asset:1',
    identity,
    channels: 1,
    describe: faultyDescription,
    quality: MAXIMUM_QUALITY,
    range: { start: derivedSampleCount(0), end: derivedSampleCount(FAULTY_LENGTH) },
  };
}

// A loop analysis and a measurement each read up to seconds of audio on the
// reference DSP, several times slower under the whole suite's load.
describe('the detection host’s loop analyses', { timeout: 60_000 }, () => {
  it('answers an unchanged loop from the analysis it kept, and reads nothing', async () => {
    const { host, sent } = rig();
    const first = await host.analyseLoop(loopSubject('plan A'));
    const again = await host.analyseLoop(loopSubject('plan A'));

    expect(first).toMatchObject({ kind: 'done', kept: false });
    expect(again).toEqual({
      kind: 'done',
      analysis: first.kind === 'done' ? first.analysis : undefined,
      kept: true,
    });
    expect(sent(ToDetectionWorkerKind.AnalyseLoop)).toBe(1);
  });

  it('analyses again when the region’s audio, its loop or the search asked for changes', async () => {
    const { host, sent } = rig();
    const fixture = quarterPeriodShort();
    await host.analyseLoop(loopSubject('plan A', fixture));
    await host.analyseLoop(loopSubject('plan A, edited', fixture));
    await host.analyseLoop(
      loopSubject('plan A', fixture, { loop: { ...fixture.loop, end: fixture.loop.end - 1 } }),
    );
    const searched = await host.analyseLoop(
      loopSubject('plan A', fixture, {
        loop: fixture.loop,
        search: defaultLoopSearch(fixture.sampleRate),
      }),
    );

    expect(sent(ToDetectionWorkerKind.AnalyseLoop)).toBe(4);
    expect(searched.kind === 'done' ? searched.analysis.candidates.length : 0).toBe(5);
  });

  it('answers a refused analysis as failed, keeping nothing and leaving the loop asked about as it was', async () => {
    const { host, sent } = rig();
    const fixture = quarterPeriodShort();
    const request = frozen({ loop: { ...fixture.loop, end: fixture.loop.start + 8 } });
    const failed = await host.analyseLoop(loopSubject('plan A', fixture, request));
    await host.analyseLoop(loopSubject('plan A', fixture, request));

    expect(failed).toEqual({
      kind: 'failed',
      reason: 'A loop shorter than 16 frames has too few frames to measure.',
    });
    expect(request.loop).toEqual({ ...fixture.loop, end: fixture.loop.start + 8 });
    expect(sent(ToDetectionWorkerKind.AnalyseLoop)).toBe(2);
  });

  it('answers a cancelled analysis as cancelled, keeping nothing and leaving the loop as it was', async () => {
    const { host, workers, sent } = rig();
    const fixture = cutNoise();
    const request = frozen({ loop: fixture.loop, search: defaultLoopSearch(fixture.sampleRate) });
    const cancellation = createCancellationSource();
    const analysing = host.analyseLoop(loopSubject('plan A', fixture, request), {
      signal: cancellation.signal,
    });
    await turn();
    cancellation.cancel();

    expect(await analysing).toEqual({ kind: 'cancelled' });
    expect(request.loop).toEqual(fixture.loop);
    await turn();
    expect(workers[0]?.answered(FromDetectionWorkerKind.LoopAnalysed)).toBe(0);
    expect((await host.analyseLoop(loopSubject('plan A', fixture, request))).kind).toBe('done');
    expect(sent(ToDetectionWorkerKind.AnalyseLoop)).toBe(2);
  });

  it('reports the analysis’s progress up to its whole', async () => {
    const { host } = rig();
    const progress: [number, number][] = [];
    await host.analyseLoop(loopSubject('plan A'), {
      onProgress: (done, total) => progress.push([done, total]),
    });

    const [done, total] = progress.at(-1) ?? [0, 1];
    expect(done).toBe(total);
  });
});

describe('the detection host’s loudness measurements', { timeout: 30_000 }, () => {
  it('answers an unchanged target from the measurement it kept, and reads nothing', async () => {
    const { host, sent } = rig();
    const first = await host.measureLoudness(loudnessSubject('plan A'));
    const again = await host.measureLoudness(loudnessSubject('plan A'));
    await host.measureLoudness(loudnessSubject('plan A, edited'));

    expect(first.kind === 'done' ? first.measurement.frames : 0).toBe(FAULTY_LENGTH);
    expect(again).toEqual({
      kind: 'done',
      measurement: first.kind === 'done' ? first.measurement : undefined,
      kept: true,
    });
    expect(sent(ToDetectionWorkerKind.MeasureLoudness)).toBe(2);
  });

  it('fails a job the worker answers with an answer of another kind, keeping nothing', async () => {
    const posted: ToDetectionWorker[] = [];
    let onMessage: (value: unknown) => void = () => undefined;
    const port: DetectionWorkerPort = {
      post: (message) => {
        posted.push(message);
        if (message.kind !== ToDetectionWorkerKind.MeasureLoudness) return;
        const answer = {
          kind: FromDetectionWorkerKind.Done,
          job: message.job,
          result: { frames: 0, reports: [] },
        };
        setTimeout(() => {
          onMessage(answer);
        }, 0);
      },
      listen: (listener) => {
        onMessage = listener;
      },
      terminate: () => undefined,
    };
    const host = new DetectionHost({ createWorker: () => port });

    expect(await host.measureLoudness(loudnessSubject('plan A'))).toEqual({
      kind: 'failed',
      reason: 'The detection worker answered a job with an answer of another kind.',
    });
    await host.measureLoudness(loudnessSubject('plan A'));
    expect(posted).toHaveLength(2);
  });
});
