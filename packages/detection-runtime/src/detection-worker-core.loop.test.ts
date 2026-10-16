import { describe, expect, it } from 'vitest';

import {
  PcmDescriptionKind,
  REFERENCE_DSP,
  memorySource,
  type PcmDescription,
} from '@audiogubbins/audio-engine';
import { NO_CHAIN_PROCESSING } from '@audiogubbins/audio-engine/testing';
import {
  MAXIMUM_QUALITY,
  StandardLayouts,
  createCancellationSource,
  derivedSampleCount,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import {
  analyseLoop,
  defaultLoopSearch,
  type LoopAnalysisRequest,
} from '@audiogubbins/loop-analysis';
import {
  cutNoise,
  fixtureSource,
  quarterPeriodShort,
  type LoopFixture,
} from '@audiogubbins/loop-analysis/testing';
import { CANONICAL_ASSISTANTS, PROCESSOR_TYPES_BY_KEY } from '@audiogubbins/processors';
import { TEST_RATE } from '@audiogubbins/processors/testing';

import { FromDetectionWorkerKind, type FromDetectionWorker } from './detection-messages.js';
import { DetectionWorkerCore } from './detection-worker-core.js';
import { measureLoudness } from './loudness-run.js';
import { FAULTY_LENGTH, faultyDescription, faultySignal } from './testing/faulty-signal.js';
import { turn } from './testing/local-detection-worker.js';

/** The core, with what it posts kept, and a wait for a job's last answer. */
function rig() {
  const posted: FromDetectionWorker[] = [];
  const waiting = new Map<string, (message: FromDetectionWorker) => void>();
  const core = new DetectionWorkerCore({
    post: (message) => {
      posted.push(message);
      if (message.kind === FromDetectionWorkerKind.Refused) return;
      if (message.kind !== FromDetectionWorkerKind.Progress) waiting.get(message.job)?.(message);
    },
    yieldToHost: turn,
    dsp: REFERENCE_DSP,
    processing: NO_CHAIN_PROCESSING,
    assistants: CANONICAL_ASSISTANTS,
    types: PROCESSOR_TYPES_BY_KEY,
    reportFault: (error) => {
      throw error;
    },
  });
  const answer = (job: string): Promise<FromDetectionWorker> =>
    new Promise((resolve) => {
      waiting.set(job, resolve);
    });
  return { core, posted, answer };
}

/** A fixture's region, described as a decoded clip in memory. */
function described(fixture: LoopFixture): PcmDescription {
  return {
    kind: PcmDescriptionKind.Pcm,
    sampleRate: fixture.sampleRate,
    channels: fixture.channels.map((channel) => channel.slice()),
  };
}

/** A request to analyse `fixture`'s loop, heard and plain the same audio. */
function analyse(
  job: string,
  fixture: LoopFixture,
  request: LoopAnalysisRequest = { loop: fixture.loop },
  target = 'region:1',
) {
  return {
    kind: 'analyse-loop',
    job,
    target,
    channels: fixture.channels.length,
    heard: described(fixture),
    plain: described(fixture),
    quality: MAXIMUM_QUALITY,
    request,
  };
}

/** A request to measure the loudness of the faulty signal. */
function measure(job: string, target = 'region:1') {
  return {
    kind: 'measure-loudness',
    job,
    target,
    channels: 1,
    description: faultyDescription(),
    quality: MAXIMUM_QUALITY,
    range: { start: derivedSampleCount(0), end: derivedSampleCount(FAULTY_LENGTH) },
  };
}

const TOOLS = {
  dsp: REFERENCE_DSP,
  signal: createCancellationSource().signal,
  yieldToHost: () => Promise.resolve(),
  onProgress: () => undefined,
};

// A searched analysis measures hundreds of pairs on the reference DSP: a
// second or two alone, several under the whole suite's load.
describe('the detection worker core’s loop analyses', { timeout: 60_000 }, () => {
  it('answers the analysis of the region heard with its crossfade and without, with its progress', async () => {
    const fixture = quarterPeriodShort();
    // Without its crossfade the region sounds otherwise: here, played backwards,
    // so an analysis that read one for the other answers otherwise.
    const plain: LoopFixture = {
      ...fixture,
      channels: fixture.channels.map((channel) => channel.toReversed()),
    };
    const request = { loop: fixture.loop, search: defaultLoopSearch(fixture.sampleRate) };
    const { core, posted, answer } = rig();
    const answered = answer('one');
    core.receive({ ...analyse('one', fixture, request), plain: described(plain) });
    const message = await answered;
    const direct = expectSuccess(
      await analyseLoop(fixtureSource(fixture), fixtureSource(plain), request, TOOLS),
    );

    expect(message).toEqual({
      kind: FromDetectionWorkerKind.LoopAnalysed,
      job: 'one',
      analysis: direct,
    });
    const progress = posted.flatMap((one) =>
      one.kind === FromDetectionWorkerKind.Progress ? [one] : [],
    );
    expect(progress.length).toBeGreaterThan(1);
    expect(progress.at(-1)?.framesRead).toBe(progress.at(-1)?.framesTotal);
  });

  it('answers a loop it refuses as failed, saying why', async () => {
    const fixture = quarterPeriodShort();
    const { core, answer } = rig();
    const answered = answer('one');
    const { start } = fixture.loop;
    core.receive(
      analyse('one', fixture, {
        loop: { ...fixture.loop, end: start + 8 },
      }),
    );

    expect(await answered).toEqual({
      kind: FromDetectionWorkerKind.Failed,
      job: 'one',
      reason: 'A loop shorter than 16 frames has too few frames to measure.',
    });
  });

  it('answers an analysis it is asked to cancel as cancelled, never as failed', async () => {
    const fixture = cutNoise();
    const { core, posted, answer } = rig();
    const answered = answer('one');
    core.receive(
      analyse('one', fixture, {
        loop: fixture.loop,
        search: defaultLoopSearch(fixture.sampleRate),
      }),
    );
    await turn();
    core.receive({ kind: 'cancel', job: 'one' });

    expect(await answered).toEqual({ kind: FromDetectionWorkerKind.Cancelled, job: 'one' });
    await turn();
    expect(posted.map((one) => one.kind)).not.toContain(FromDetectionWorkerKind.LoopAnalysed);
  });

  it('cancels a region’s analysis for its next, but not for a detection of it', async () => {
    const fixture = quarterPeriodShort();
    const { core, answer } = rig();
    const first = answer('first');
    const detection = answer('detection');
    const second = answer('second');
    core.receive(analyse('first', fixture));
    core.receive({
      ...measure('detection'),
      kind: 'detect',
      assistants: ['repair'],
      detectors: {},
    });
    core.receive(analyse('second', fixture));

    expect(await first).toEqual({ kind: FromDetectionWorkerKind.Cancelled, job: 'first' });
    expect((await detection).kind).toBe(FromDetectionWorkerKind.Done);
    expect((await second).kind).toBe(FromDetectionWorkerKind.LoopAnalysed);
  });

  it('answers audio it cannot open as failed', async () => {
    const fixture = quarterPeriodShort();
    const { core, answer } = rig();
    const answered = answer('one');
    core.receive({ ...analyse('one', fixture), channels: 0 });

    expect((await answered).kind).toBe(FromDetectionWorkerKind.Failed);
  });
});

describe('the detection worker core’s loudness measurements', { timeout: 30_000 }, () => {
  it('answers the measurement of the range of the audio asked for', async () => {
    const { core, answer } = rig();
    const answered = answer('one');
    core.receive(measure('one'));
    const source = expectSuccess(
      memorySource({
        layout: StandardLayouts.mono,
        sampleRate: TEST_RATE,
        frames: FAULTY_LENGTH,
        channels: [faultySignal()],
      }),
    );
    const direct = expectSuccess(
      await measureLoudness(
        source,
        { start: derivedSampleCount(0), end: derivedSampleCount(FAULTY_LENGTH) },
        TOOLS,
      ),
    );

    expect(await answered).toEqual({
      kind: FromDetectionWorkerKind.LoudnessMeasured,
      job: 'one',
      measurement: direct,
    });
  });
});
