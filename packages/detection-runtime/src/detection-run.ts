/**
 * One detection: a range of a source read once, in order, every detector the
 * chosen assistants run hearing each chunk as it is read (each an
 * `AudioDetector`, its `Detection` a whole pass), then each assistant's
 * recommendation over their findings, and the state each recommended step
 * learns from the stretch its treatment names, read again for that step alone
 * (ADR-0061, ADR-0062). Nothing here changes the audio or the project.
 *
 * Findings are made from the audio the person hears, the target after its
 * racks. A learned state is learned from the audio its processor will receive,
 * which is another source where the two differ: a recommendation over a range
 * is applied as a rack edit, which acts before the target's racks (ADR-0060's
 * order), so its state is learned from the target before them; one over the
 * whole target follows a copy of its rack, so its state is learned from the
 * audio heard. The caller, which knows how it will apply the recommendation,
 * gives the source; it has the heard source's frames and rate, and the layout
 * its processor reads.
 *
 * A detector shared by two assistants, as the noise floor is, runs once. Every
 * detection and learner is released on every path, answered, refused, failed or
 * cancelled, and a cancellation is read between chunks and by every pass it
 * reaches. Progress is reported in frames read.
 */

import {
  allocateBlock,
  blockView,
  type AudioFrameBlock,
  type CanonicalDsp,
  type PcmSource,
} from '@audiogubbins/audio-engine';
import {
  FailureKind,
  derivedSampleCount,
  fail,
  failure,
  succeed,
  throwIfCancelled,
  treatmentValues,
  type CancellationSignal,
  type DetectorFinding,
  type DomainResult,
  type EditRange,
  type FindingKind,
  type TreatmentStep,
} from '@audiogubbins/domain';
import {
  recommendation,
  type Assistant,
  type AudioDetector,
  type Detection,
  type ProcessorType,
} from '@audiogubbins/processors';

import {
  MOST_FINDINGS_SHOWN,
  type AssistantReport,
  type DetectionResult,
  type KindCount,
  type LearnedState,
} from './detection-result.js';

/** The frames read at a time: under a second, so a cancellation waits on no more. */
const CHUNK_FRAMES = 32_768;

/** What a detection runs with, apart from the audio. */
export interface DetectionTools {
  readonly dsp: CanonicalDsp;
  /** The processor types by key, whose learners learn a recommended step's state. */
  readonly types: ReadonlyMap<string, ProcessorType>;
  readonly signal: CancellationSignal;
  /** Resolves once the scope has read the messages that arrived meanwhile. */
  readonly yieldToHost: () => Promise<void>;
  readonly onProgress: (framesRead: number, framesTotal: number) => void;
}

function refused(code: string, summary: string): DomainResult<never> {
  return fail(failure(code, FailureKind.Rejected, summary));
}

/** Each detector `assistants` run, once, in the order they first name it. */
function detectorsOf(assistants: readonly Assistant[]): readonly AudioDetector[] {
  const byKey = new Map<string, AudioDetector>();
  for (const assistant of assistants) {
    for (const detector of assistant.detectors) {
      if (!byKey.has(detector.identity.key)) byKey.set(detector.identity.key, detector);
    }
  }
  return [...byKey.values()];
}

/** `range` moved `offset` frames on. */
function moved(range: EditRange, offset: number): EditRange {
  return {
    start: derivedSampleCount(range.start + offset),
    end: derivedSampleCount(range.end + offset),
  };
}

/**
 * `finding` with its range and its treatment's stretches moved `offset` frames
 * on, from the range read to the source it was read from.
 */
function onSource(finding: DetectorFinding, offset: number): DetectorFinding {
  const { treatment } = finding;
  return {
    ...finding,
    range: moved(finding.range, offset),
    treatment:
      treatment.kind === 'none'
        ? treatment
        : {
            kind: 'steps',
            steps: treatment.steps.map((step) =>
              step.learnFrom === undefined
                ? step
                : { ...step, learnFrom: moved(step.learnFrom, offset) },
            ),
          },
  };
}

/** Reads `range` of `source` into `block` a chunk at a time, handing each chunk to `hear`. */
async function readRange(
  source: PcmSource,
  range: EditRange,
  block: AudioFrameBlock,
  tools: Pick<DetectionTools, 'signal' | 'yieldToHost'>,
  hear: (chunk: AudioFrameBlock, frames: number) => Promise<void>,
): Promise<number> {
  let position: number = range.start;
  while (position < range.end) {
    const wanted = Math.min(block.frames, range.end - position);
    const into = wanted === block.frames ? block : blockView(block, 0, wanted);
    const read = await source.read(derivedSampleCount(position), into, tools.signal);
    if (read === 0) break;
    await hear(into, read);
    position += read;
    await tools.yieldToHost();
    throwIfCancelled(tools.signal);
  }
  return position - range.start;
}

/** The findings of every detection over `range` of `source`, on the source's frames. */
async function findingsOver(
  source: PcmSource,
  range: EditRange,
  detections: readonly Detection[],
  tools: DetectionTools,
): Promise<DomainResult<{ readonly frames: number; readonly findings: DetectorFinding[] }>> {
  const block = allocateBlock(source.layout, source.sampleRate, CHUNK_FRAMES);
  const total = range.end - range.start;
  let heard = 0;
  const frames = await readRange(source, range, block, tools, async (chunk, read) => {
    for (const detection of detections) await detection.add(chunk.channels, read, tools.signal);
    heard += read;
    tools.onProgress(heard, total);
  });
  const findings: DetectorFinding[] = [];
  for (const detection of detections) {
    const found = await detection.result(tools.signal);
    if (!found.ok) return found;
    // One at a time: a detector's findings have no bound, and a spread passes
    // each as an argument, past the engine's limit on a long, noisy recording.
    for (const finding of found.value) findings.push(onSource(finding, range.start));
  }
  return succeed({ frames, findings });
}

/** What `step` learns from the stretch its treatment names, read again from `source`. */
async function learned(
  source: PcmSource,
  step: TreatmentStep,
  tools: DetectionTools,
): Promise<LearnedState> {
  if (step.learnFrom === undefined) return { kind: 'none' };
  const type = tools.types.get(step.typeKey);
  if (type?.learner === undefined) {
    return {
      kind: 'refused',
      reason: `This build cannot learn what a "${step.typeKey}" processor needs.`,
    };
  }
  const values = treatmentValues(type.descriptor, step);
  if (!values.ok) return { kind: 'refused', reason: values.failures[0].summary };
  const made = type.learner({
    values: values.value,
    input: source.layout,
    sampleRate: source.sampleRate,
    dsp: tools.dsp,
  });
  if (!made.ok) return { kind: 'refused', reason: made.failures[0].summary };
  const learner = made.value;
  try {
    const block = allocateBlock(source.layout, source.sampleRate, CHUNK_FRAMES);
    await readRange(source, step.learnFrom, block, tools, (chunk, read) => {
      learner.add(chunk.channels, read);
      return Promise.resolve();
    });
    return { kind: 'learned', state: learner.result() };
  } finally {
    learner.release();
  }
}

/** How many of `findings` there are of each kind, in the order the kinds first come. */
function countsOf(findings: readonly DetectorFinding[]): readonly KindCount[] {
  const counts = new Map<FindingKind, number>();
  for (const finding of findings) counts.set(finding.kind, (counts.get(finding.kind) ?? 0) + 1);
  return [...counts].map(([kind, count]) => ({ kind, count }));
}

/** The first {@link MOST_FINDINGS_SHOWN} of `findings` of each kind, in their order. */
function shownOf(findings: readonly DetectorFinding[]): readonly DetectorFinding[] {
  const taken = new Map<FindingKind, number>();
  const shown: DetectorFinding[] = [];
  for (const finding of findings) {
    const count = taken.get(finding.kind) ?? 0;
    if (count >= MOST_FINDINGS_SHOWN) continue;
    taken.set(finding.kind, count + 1);
    shown.push(finding);
  }
  return shown;
}

/** Whether `finding` is treated by a step of `typeKey`. */
function treatedBy(finding: DetectorFinding, typeKey: string): boolean {
  return (
    finding.treatment.kind === 'steps' &&
    finding.treatment.steps.some((step) => step.typeKey === typeKey)
  );
}

/** Each assistant's report over `findings`, every step's state learned from `source`. */
async function reportsOf(
  source: PcmSource,
  assistants: readonly Assistant[],
  findings: readonly DetectorFinding[],
  tools: DetectionTools,
): Promise<readonly AssistantReport[]> {
  const reports: AssistantReport[] = [];
  for (const assistant of assistants) {
    const recommended = recommendation(assistant, findings);
    const states: LearnedState[] = [];
    for (const step of recommended.steps) states.push(await learned(source, step, tools));
    const weighed = recommended.findings;
    reports.push({
      label: assistant.label,
      recommendation: { ...recommended, findings: shownOf(weighed) },
      learned: states,
      found: countsOf(weighed),
      treated: recommended.steps.map((step) =>
        countsOf(weighed.filter((finding) => treatedBy(finding, step.typeKey))),
      ),
    });
  }
  return reports;
}

/** The audio a detection reads: what it finds faults in, and what its steps learn from. */
export interface DetectionAudio {
  /** The audio the person hears, which the findings are made from. */
  readonly heard: PcmSource;
  /** The audio each recommended step's processor will receive, which it learns its state from. */
  readonly learning: PcmSource;
}

/**
 * What `assistants` find in and recommend for `range` of the audio heard, or
 * why they cannot: a range the audio does not hold, audio to learn from that is
 * not on the frames heard, or a detector that cannot hear audio of its shape
 * and rate. A cancellation is thrown, as the signal's reason.
 */
export async function runDetection(
  audio: DetectionAudio,
  range: EditRange,
  assistants: readonly Assistant[],
  tools: DetectionTools,
): Promise<DomainResult<DetectionResult>> {
  const { heard: source, learning } = audio;
  if (range.end <= range.start) {
    return refused('detection.range-empty', 'The range to analyse holds no audio.');
  }
  if (learning.sampleRate !== source.sampleRate || learning.length !== source.length) {
    return refused(
      'detection.learning-mismatched',
      'The audio a treatment would learn from is not on the frames of the audio analysed.',
    );
  }
  if (source.length !== undefined && range.end > source.length) {
    return refused(
      'detection.range-outside',
      'The range to analyse runs past the end of the audio.',
    );
  }
  const detections: Detection[] = [];
  try {
    for (const detector of detectorsOf(assistants)) {
      const opened = detector.open({
        input: source.layout,
        sampleRate: source.sampleRate,
        dsp: tools.dsp,
      });
      if (!opened.ok) return opened;
      detections.push(opened.value);
    }
    const heard = await findingsOver(source, range, detections, tools);
    if (!heard.ok) return heard;
    const reports = await reportsOf(learning, assistants, heard.value.findings, tools);
    return succeed({ frames: heard.value.frames, reports });
  } finally {
    for (const detection of detections) detection.release();
  }
}
