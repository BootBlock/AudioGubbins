import { describe, expect, it } from 'vitest';

import {
  FindingKind,
  MeasureUnit,
  createDeterministicIdGenerator,
  derivedSampleCount,
  instantiateProcessor,
  validateProcessorInstance,
  type DetectorFinding,
  type TreatmentStep,
} from '@audiogubbins/domain';

import { PROCESSOR_CATALOGUE } from '../catalogue.js';
import { partials, withClicks } from '../testing/repair-signals.js';
import { clipped, detect, hiss, mixed, scaled, tone } from '../testing/detection-signals.js';
import { TEST_RATE } from '../testing/processor-run.js';
import { CANONICAL_ASSISTANTS, SILENCE_ASSISTANT, recommendation } from './assistants.js';
import type { Assistant } from './audio-detector.js';

/** The assistant this build has of `key`. */
function assistantOf(key: string): Assistant {
  const found = CANONICAL_ASSISTANTS.find((assistant) => assistant.key === key);
  if (found === undefined) throw new Error(`This build has no ${key} assistant.`);
  return found;
}

const CLASSIFICATION_ASSISTANT = assistantOf('classification');
const REPAIR_ASSISTANT = assistantOf('repair');
const RESTORATION_ASSISTANT = assistantOf('restoration');

const ids = createDeterministicIdGenerator(61);

/** A finding of `kind` over frames `start` to `end`, treated by `steps`. */
function finding(
  kind: DetectorFinding['kind'],
  steps: readonly TreatmentStep[],
  start = 0,
  end = 100,
): DetectorFinding {
  return {
    kind,
    range: { start: derivedSampleCount(start), end: derivedSampleCount(end) },
    channels: [0],
    measure: { value: 1, unit: MeasureUnit.Decibels },
    treatment: steps.length > 0 ? { kind: 'steps', steps } : { kind: 'none', reason: 'None.' },
  };
}

const range = (start: number, end: number) => ({
  start: derivedSampleCount(start),
  end: derivedSampleCount(end),
});
const DC: TreatmentStep = { typeKey: 'dc-offset-removal', values: {} };
const HUM: TreatmentStep = { typeKey: 'de-hum', values: { fundamental: '60-hz', offset: 0.1 } };
const OTHER_HUM: TreatmentStep = { typeKey: 'de-hum', values: { fundamental: '50-hz' } };
const CLICK: TreatmentStep = { typeKey: 'de-click', values: { sensitivity: 8 } };
const NOISE_A: TreatmentStep = { typeKey: 'noise-reduction', values: {}, learnFrom: range(0, 9) };
const NOISE_B: TreatmentStep = { typeKey: 'noise-reduction', values: {}, learnFrom: range(5, 30) };

/**
 * Whether `step` is one the catalogue accepts: an instance of its type, with
 * each value it names set by its parameter key, passes the domain's check.
 */
function accepted(step: TreatmentStep): boolean {
  const descriptor = PROCESSOR_CATALOGUE.get(step.typeKey);
  if (descriptor === undefined) return false;
  const instance = instantiateProcessor(ids.next(), descriptor);
  const values = new Map(instance.values);
  for (const [key, value] of Object.entries(step.values)) {
    const parameter = descriptor.parameters.find((one) => one.key === key);
    if (parameter === undefined) return false;
    values.set(parameter.id, value);
  }
  return validateProcessorInstance({ ...instance, values }, descriptor).ok;
}

/** Every finding of `assistant`'s detectors over `channels`. */
async function findingsOf(
  assistant: Assistant,
  channels: Float32Array[],
): Promise<DetectorFinding[]> {
  const found: DetectorFinding[] = [];
  for (const detector of assistant.detectors) found.push(...(await detect(detector, channels)));
  return found;
}

describe('the assistants', () => {
  it('restoration recommends an offset removal, a de-hum and a noise reduction, in that order', () => {
    const findings = [
      finding(FindingKind.Noise, [NOISE_A]),
      finding(FindingKind.Hum, [HUM]),
      finding(FindingKind.DcOffset, [DC]),
    ];
    expect(RESTORATION_ASSISTANT.recommend(findings)).toEqual([DC, HUM, NOISE_A]);
  });

  it('gives each treatment once, the first finding’s, and only for its own detectors’ findings', () => {
    const findings = [
      finding(FindingKind.Noise, [NOISE_A]),
      finding(FindingKind.Click, [CLICK]),
      finding(FindingKind.DcOffset, [DC]),
      finding(FindingKind.Noise, [NOISE_B]),
      finding(FindingKind.DcOffset, [DC]),
      finding(FindingKind.Hum, [HUM]),
      finding(FindingKind.Hum, [OTHER_HUM]),
    ];
    expect(RESTORATION_ASSISTANT.recommend(findings)).toEqual([DC, HUM, NOISE_A]);
    expect(REPAIR_ASSISTANT.recommend(findings)).toEqual([CLICK]);
  });

  it('repair recommends one de-click for every click, and nothing for clipping', () => {
    const findings = [
      finding(FindingKind.Clipping, []),
      finding(FindingKind.Click, [CLICK], 10, 20),
      finding(FindingKind.Click, [CLICK], 50, 60),
    ];
    expect(REPAIR_ASSISTANT.recommend(findings)).toEqual([CLICK]);
    expect(REPAIR_ASSISTANT.recommend([finding(FindingKind.Clipping, [])])).toEqual([]);
  });

  it('puts a treatment no order names after those it does, as it was found', () => {
    const gain: TreatmentStep = { typeKey: 'gain', values: {} };
    const findings = [
      finding(FindingKind.Noise, [NOISE_A, gain]),
      finding(FindingKind.DcOffset, [DC]),
    ];
    expect(RESTORATION_ASSISTANT.recommend(findings)).toEqual([DC, NOISE_A, gain]);
  });

  it('classification reports and recommends nothing', () => {
    const findings = [
      finding(FindingKind.Noise, [NOISE_A]),
      finding(FindingKind.Transient, []),
      finding(FindingKind.DcOffset, [DC]),
    ];
    expect(CLASSIFICATION_ASSISTANT.recommend(findings)).toEqual([]);
    expect(recommendation(CLASSIFICATION_ASSISTANT, findings)).toEqual({
      assistant: 'classification',
      detectors: [
        { key: 'transients', label: 'Transients', version: 1 },
        { key: 'noise-floor', label: 'Noise floor', version: 1 },
      ],
      // The DC offset is no finding of its detectors, so it is left out.
      findings: findings.slice(0, 2),
      steps: [],
      removals: [],
    });
  });

  it('recommend steps the catalogue accepts, from audio with every fault they treat', async () => {
    const length = 4 * TEST_RATE;
    const music = scaled(partials(length), TEST_RATE, 2 * TEST_RATE, 0);
    const restoration = mixed(
      music,
      hiss(length, -50),
      tone(length, 60.2, -40),
      new Float32Array(length).fill(0.01),
    );
    const found = await findingsOf(RESTORATION_ASSISTANT, [restoration]);
    expect(found.map(({ kind }) => kind)).toEqual([
      FindingKind.DcOffset,
      FindingKind.Hum,
      FindingKind.Noise,
    ]);
    const restored = recommendation(RESTORATION_ASSISTANT, found);
    expect(restored.assistant).toBe('restoration');
    expect(restored.findings).toEqual(found);
    expect(restored.steps.map(({ typeKey }) => typeKey)).toEqual([
      'dc-offset-removal',
      'de-hum',
      'noise-reduction',
    ]);
    expect(restored.steps[2]?.learnFrom).toEqual(found[2]?.range);

    const repair = withClicks(clipped(partials(length), 0.4), [
      { at: 30_000, width: 9, size: 0.2 },
    ]);
    const steps = REPAIR_ASSISTANT.recommend(await findingsOf(REPAIR_ASSISTANT, [repair]));
    expect(steps.map(({ typeKey }) => typeKey)).toEqual(['de-click']);

    for (const step of [...restored.steps, ...steps]) expect(accepted(step)).toBe(true);
  });

  it('hold a check that refuses a step the catalogue would not accept', () => {
    expect(accepted({ typeKey: 'de-hum', values: { offset: 3 } })).toBe(false);
    expect(accepted({ typeKey: 'de-hum', values: { fundamental: '55-hz' } })).toBe(false);
    expect(accepted({ typeKey: 'de-click', values: { strength: 1 } })).toBe(false);
    expect(accepted({ typeKey: 'declipper', values: {} })).toBe(false);
  });
});

describe('the silence assistant', () => {
  /** A silence over frames `start` to `end`, taken out, or treated by nothing. */
  function silence(start: number, end: number, removed = true): DetectorFinding {
    return {
      kind: FindingKind.Silence,
      range: range(start, end),
      channels: [0],
      measure: { value: 0, unit: MeasureUnit.Linear },
      treatment: removed ? { kind: 'removal' } : { kind: 'none', reason: 'All quiet.' },
    };
  }

  it('recommends no processor, and gives the frames its findings take out, in order and apart', () => {
    const found = [
      silence(900, 1_000),
      silence(0, 50),
      silence(400, 500),
      silence(450, 600),
      silence(600, 700),
      silence(800, 820, false),
      finding(FindingKind.Click, [CLICK], 10, 20),
    ];
    const recommended = recommendation(SILENCE_ASSISTANT, found);
    expect(recommended.steps).toEqual([]);
    expect(recommended.removals).toEqual([range(0, 50), range(400, 700), range(900, 1_000)]);
    expect(recommended.findings).toHaveLength(6);
    expect(recommendation(REPAIR_ASSISTANT, found).removals).toEqual([]);
  });
});
