import { describe, expect, it } from 'vitest';

import { PcmDescriptionKind, REFERENCE_DSP, type CanonicalDsp } from '@audiogubbins/audio-engine';
import { NO_CHAIN_PROCESSING } from '@audiogubbins/audio-engine/testing';
import {
  FindingKind,
  MAXIMUM_QUALITY,
  derivedSampleCount,
  mapResult,
  type DetectorFinding,
} from '@audiogubbins/domain';
import {
  CLASSIFICATION_ASSISTANT,
  PROCESSOR_TYPES_BY_KEY,
  REPAIR_ASSISTANT,
  RESTORATION_ASSISTANT,
} from '@audiogubbins/processors';
import { TEST_RATE } from '@audiogubbins/processors/testing';

import {
  FromDetectionWorkerKind,
  ToDetectionWorkerKind,
  type FromDetectionWorker,
} from './detection-messages.js';
import type { DetectionResult } from './detection-result.js';
import { DetectionWorkerCore } from './detection-worker-core.js';
import {
  CLICKS,
  FAULTY_LENGTH,
  HUM_HERTZ,
  QUIET,
  faultyDescription,
  faultySignal,
} from './testing/faulty-signal.js';

/** A turn of the event loop, as the worker's yield between chunks takes. */
function turn(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** The reference DSP, counting the feature extractors it makes and those still unfreed. */
function countingDsp(): {
  readonly dsp: CanonicalDsp;
  readonly made: () => number;
  readonly live: () => number;
} {
  let made = 0;
  let live = 0;
  const dsp: CanonicalDsp = {
    ...REFERENCE_DSP,
    createDetectorFeatures: (settings) =>
      mapResult(REFERENCE_DSP.createDetectorFeatures(settings), (features) => {
        made += 1;
        live += 1;
        return {
          kind: features.kind,
          channels: features.channels,
          recordWidth: features.recordWidth,
          push: (chunk) => {
            features.push(chunk);
          },
          pull: (into) => features.pull(into),
          release: () => {
            live -= 1;
            features.release();
          },
        };
      }),
  };
  return { dsp, made: () => made, live: () => live };
}

/** The core, with what it posts kept, and a wait for a job's last answer. */
function rig(dsp: CanonicalDsp = REFERENCE_DSP) {
  const posted: FromDetectionWorker[] = [];
  const waiting = new Map<string, (message: FromDetectionWorker) => void>();
  const core = new DetectionWorkerCore({
    post: (message) => {
      posted.push(message);
      if (message.kind === FromDetectionWorkerKind.Refused) return;
      if (message.kind !== FromDetectionWorkerKind.Progress) waiting.get(message.job)?.(message);
    },
    yieldToHost: turn,
    dsp,
    processing: NO_CHAIN_PROCESSING,
    assistants: [CLASSIFICATION_ASSISTANT, REPAIR_ASSISTANT, RESTORATION_ASSISTANT],
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

/** A request to detect over `start` to `end` of the faulty signal. */
function detect(
  job: string,
  options: {
    readonly target?: string;
    readonly start?: number;
    readonly end?: number;
    readonly assistants?: readonly string[];
  } = {},
) {
  return {
    kind: 'detect',
    job,
    target: options.target ?? 'asset:1',
    channels: 1,
    description: faultyDescription(),
    quality: MAXIMUM_QUALITY,
    range: {
      start: derivedSampleCount(options.start ?? 0),
      end: derivedSampleCount(options.end ?? FAULTY_LENGTH),
    },
    assistants: options.assistants ?? ['repair', 'restoration', 'classification'],
  };
}

function resultOf(message: FromDetectionWorker): DetectionResult {
  if (message.kind !== FromDetectionWorkerKind.Done) {
    throw new Error(`The detection ended ${message.kind}: ${JSON.stringify(message)}`);
  }
  return message.result;
}

function ofKind(findings: readonly DetectorFinding[], kind: FindingKind): DetectorFinding[] {
  return findings.filter((finding) => finding.kind === kind);
}

// Each detection reads seconds of audio through every detector on the
// reference DSP: well under a second alone, and several times that under the
// whole suite's load, so the file has a budget of its own.
describe('the detection worker core', { timeout: 30_000 }, () => {
  it('answers the clicks, the clipping and the hum the signal holds, and the assistants’ order', async () => {
    const { core, answer } = rig();
    const answered = answer('one');
    core.receive(detect('one'));
    const result = resultOf(await answered);

    expect(result.frames).toBe(FAULTY_LENGTH);
    expect(result.reports.map((report) => report.recommendation.assistant)).toEqual([
      'repair',
      'restoration',
      'classification',
    ]);
    const [repair, restoration, classification] = result.reports;
    const clicks = ofKind(repair?.recommendation.findings ?? [], FindingKind.Click);
    for (const at of CLICKS) {
      expect(clicks.some((click) => click.range.start <= at + 1 && click.range.end > at)).toBe(
        true,
      );
    }
    expect(
      ofKind(repair?.recommendation.findings ?? [], FindingKind.Clipping).length,
    ).toBeGreaterThan(0);
    expect(repair?.recommendation.steps.map((step) => step.typeKey)).toEqual(['de-click']);
    expect(repair?.learned).toEqual([{ kind: 'none' }]);

    const [hum] = ofKind(restoration?.recommendation.findings ?? [], FindingKind.Hum);
    expect(hum?.range).toEqual({ start: 0, end: FAULTY_LENGTH });
    expect(restoration?.recommendation.steps.map((step) => step.typeKey)).toEqual([
      'de-hum',
      'noise-reduction',
    ]);
    const [deHum] = restoration?.recommendation.steps ?? [];
    expect(deHum?.values).toEqual({
      fundamental: '60-hz',
      offset: expect.closeTo(HUM_HERTZ - 60, 1),
    });

    expect(classification?.recommendation.steps).toEqual([]);
    expect(
      ofKind(classification?.recommendation.findings ?? [], FindingKind.Transient).length,
    ).toBeGreaterThan(0);
  });

  it('learns the noise reduction’s profile from the stretch of the noise alone', async () => {
    const { core, answer } = rig();
    const answered = answer('one');
    core.receive(detect('one', { assistants: ['restoration'] }));
    const [restoration] = resultOf(await answered).reports;

    const steps = restoration?.recommendation.steps ?? [];
    const noise = steps.findIndex((step) => step.typeKey === 'noise-reduction');
    const stretch = steps[noise]?.learnFrom;
    expect(stretch?.start).toBeGreaterThanOrEqual(QUIET.start);
    expect(stretch?.end).toBeLessThanOrEqual(QUIET.end);
    const learned = restoration?.learned[noise];
    expect(learned?.kind).toBe('learned');
    // A profile at the default resolution of 2,048: the header, then 1,025 bins.
    expect(learned?.kind === 'learned' ? learned.state.kind : undefined).toBe('noise-profile');
    expect(learned?.kind === 'learned' ? learned.state.values.slice(0, 3) : []).toEqual([
      2048,
      TEST_RATE,
      1,
    ]);
  });

  it('refuses audio to learn from that is not on the frames of the audio analysed', async () => {
    const { core, answer } = rig();
    const answered = answer('one');
    const shorter = faultySignal().subarray(0, FAULTY_LENGTH - 1);
    core.receive({
      ...detect('one', { assistants: ['restoration'] }),
      learning: {
        channels: 1,
        description: { kind: PcmDescriptionKind.Pcm, sampleRate: TEST_RATE, channels: [shorter] },
      },
    });

    expect(await answered).toEqual({
      kind: FromDetectionWorkerKind.Failed,
      job: 'one',
      reason: 'The audio a treatment would learn from is not on the frames of the audio analysed.',
    });
  });

  it('states every range on the source’s frames when it reads a range part way in', async () => {
    const { core, answer } = rig();
    const answered = answer('one');
    const start = CLICKS[0] - 10_000;
    core.receive(detect('one', { start, end: start + 40_000, assistants: ['repair'] }));
    const [repair] = resultOf(await answered).reports;

    const clicks = ofKind(repair?.recommendation.findings ?? [], FindingKind.Click);
    expect(clicks.some((click) => click.range.start === CLICKS[0])).toBe(true);
    for (const finding of repair?.recommendation.findings ?? []) {
      expect(finding.range.start).toBeGreaterThanOrEqual(start);
      expect(finding.range.end).toBeLessThanOrEqual(start + 40_000);
    }
  });

  it('runs a detector two assistants share once, and frees every extractor it made', async () => {
    const counting = countingDsp();
    const { core, answer } = rig(counting.dsp);
    const answered = answer('one');
    core.receive(detect('one', { assistants: ['restoration', 'classification'] }));
    await answered;

    // DC offset, hum and the noise floor for restoration; transients and the
    // noise floor again for classification, which runs once.
    expect(counting.made()).toBe(4);
    expect(counting.live()).toBe(0);
  });

  it('frees every extractor of a detection it cancels', async () => {
    const counting = countingDsp();
    const { core, answer } = rig(counting.dsp);
    const answered = answer('one');
    core.receive(detect('one'));
    await turn();
    core.receive({ kind: 'cancel', job: 'one' });
    await answered;

    expect(counting.made()).toBeGreaterThan(0);
    expect(counting.live()).toBe(0);
  });

  it('reports its progress in frames, chunk by chunk, up to the frames asked for', async () => {
    const { core, posted, answer } = rig();
    const answered = answer('one');
    core.receive(detect('one', { assistants: ['repair'] }));
    await answered;

    const progress = posted.flatMap((message) =>
      message.kind === FromDetectionWorkerKind.Progress ? [message] : [],
    );
    // A chunk at a time: each report a chunk on from the last, the last at the end.
    const chunk = progress[0]?.framesRead ?? 0;
    expect(progress.length).toBeGreaterThan(1);
    expect(progress.map((one) => one.framesRead)).toEqual(
      progress.map((_, index) => Math.min(FAULTY_LENGTH, (index + 1) * chunk)),
    );
    expect(progress.at(-1)?.framesRead).toBe(FAULTY_LENGTH);
    expect(new Set(progress.map((one) => one.framesTotal))).toEqual(new Set([FAULTY_LENGTH]));
  });

  it('stops a detection it is asked to cancel, answering it cancelled and nothing more', async () => {
    const { core, posted, answer } = rig();
    const answered = answer('one');
    core.receive(detect('one'));
    // Let it start reading, so the cancellation reaches a running detection.
    await turn();
    core.receive({ kind: 'cancel', job: 'one' });

    expect(await answered).toEqual({ kind: FromDetectionWorkerKind.Cancelled, job: 'one' });
    await turn();
    expect(posted.filter((message) => message.kind === FromDetectionWorkerKind.Done)).toEqual([]);
    const progress = posted.flatMap((message) =>
      message.kind === FromDetectionWorkerKind.Progress ? [message] : [],
    );
    expect(progress.at(-1)?.framesRead ?? 0).toBeLessThan(FAULTY_LENGTH);
  });

  it('cancels a target’s detection when the target is asked for again, and answers the new one', async () => {
    const { core, posted, answer } = rig();
    const first = answer('first');
    const second = answer('second');
    const other = answer('other');
    core.receive(detect('first', { assistants: ['repair'] }));
    await turn();
    core.receive(detect('other', { target: 'region:2', assistants: ['repair'] }));
    core.receive(detect('second', { assistants: ['repair'] }));

    expect(await first).toEqual({ kind: FromDetectionWorkerKind.Cancelled, job: 'first' });
    expect((await second).kind).toBe(FromDetectionWorkerKind.Done);
    // Another target's detection is no request for this one's.
    expect((await other).kind).toBe(FromDetectionWorkerKind.Done);
    const ends = posted.flatMap((message) =>
      message.kind === FromDetectionWorkerKind.Progress ||
      message.kind === FromDetectionWorkerKind.Refused
        ? []
        : [[message.job, message.kind]],
    );
    expect(ends).toEqual([
      ['first', 'cancelled'],
      ['other', 'done'],
      ['second', 'done'],
    ]);
  });

  it('cancels a queued detection of the target without starting it', async () => {
    const { core, posted, answer } = rig();
    const running = answer('running');
    const queued = answer('queued');
    const latest = answer('latest');
    core.receive(detect('running', { target: 'region:2', assistants: ['repair'] }));
    core.receive(detect('queued', { assistants: ['repair'] }));
    core.receive(detect('latest', { assistants: ['repair'] }));

    expect(await queued).toEqual({ kind: FromDetectionWorkerKind.Cancelled, job: 'queued' });
    expect((await running).kind).toBe(FromDetectionWorkerKind.Done);
    expect((await latest).kind).toBe(FromDetectionWorkerKind.Done);
    expect(
      posted.some(
        (message) => message.kind === FromDetectionWorkerKind.Progress && message.job === 'queued',
      ),
    ).toBe(false);
  });

  it('refuses a range the audio does not hold and an assistant this build lacks, saying why', async () => {
    const { core, answer } = rig();
    const outside = answer('outside');
    const unknown = answer('unknown');
    core.receive(detect('outside', { end: FAULTY_LENGTH + 1 }));
    core.receive(detect('unknown', { target: 'region:2', assistants: ['declipping'] }));

    expect(await outside).toEqual({
      kind: FromDetectionWorkerKind.Failed,
      job: 'outside',
      reason: 'The range to analyse runs past the end of the audio.',
    });
    expect(await unknown).toEqual({
      kind: FromDetectionWorkerKind.Failed,
      job: 'unknown',
      reason: 'This build has no assistant "declipping" to analyse the audio with.',
    });
  });

  it('takes the port to the preview worker, and refuses anything else in its place', () => {
    const { core, posted } = rig();
    const { port1, port2 } = new MessageChannel();
    core.receive({ kind: ToDetectionWorkerKind.Previews, port: port1 });
    core.receive({ kind: ToDetectionWorkerKind.Previews, port: {} });
    expect(posted).toEqual([
      {
        kind: FromDetectionWorkerKind.Refused,
        reason: "The message's port is not the end of a message channel.",
      },
    ]);
    port1.close();
    port2.close();
  });

  it('refuses a message it cannot read, naming the field', () => {
    const { core, posted } = rig();
    core.receive({ ...detect('one'), channels: -1 });
    core.receive({
      ...detect('two'),
      description: { kind: PcmDescriptionKind.Pcm, sampleRate: TEST_RATE },
    });

    expect(posted.map((message) => message.kind)).toEqual([
      FromDetectionWorkerKind.Refused,
      FromDetectionWorkerKind.Refused,
    ]);
    expect(posted[0]).toEqual({
      kind: FromDetectionWorkerKind.Refused,
      reason: "The message's channels is not a whole number, zero or more.",
    });
  });

  it('fails the running detection and every queued one when a message cannot be received', async () => {
    const { core, answer } = rig();
    const running = answer('running');
    const queued = answer('queued');
    core.receive(detect('running', { assistants: ['repair'] }));
    core.receive(detect('queued', { target: 'region:2', assistants: ['repair'] }));
    await turn();
    core.messageFailed();

    const reason = 'A message to the detection worker could not be read.';
    expect(await queued).toEqual({ kind: FromDetectionWorkerKind.Failed, job: 'queued', reason });
    expect(await running).toEqual({ kind: FromDetectionWorkerKind.Failed, job: 'running', reason });
  });
});
