/**
 * The machine-learning processors' pinned golden renders (ADR-0062): for each
 * pack, the type, its model, the settings and the signal a render runs, and the
 * SHA-256 of its output's samples' bytes. The one authority for both runs of
 * them: in Node over the pack cache (`golden-render.ts`, the `ml-golden`
 * project) and in every browser the suite drives, through the real inference
 * worker (`tests/e2e/ml-golden.spec.ts`), each held to the same digest. Every
 * signal is the canonical sine and basic arithmetic, the same bits everywhere.
 * Nothing here reads a file, so a browser loads it.
 */

import { StandardLayouts } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import type { ProcessorType } from '../framework/processor-type.js';
import { deepFilterNet3 } from '../ml/deepfilternet/deepfilternet.js';
import { DEEPFILTERNET_3_MODEL } from '../ml/deepfilternet/deepfilternet-model.js';
import type { ModelDefinition } from '../ml/model-definition.js';
import type { ModelServices } from '../ml/model-sessions.js';
import { mossFormer2Se48k } from '../ml/mossformer2/mossformer2.js';
import { MOSSFORMER2_SE_48K_MODEL } from '../ml/mossformer2/mossformer2-model.js';
import { spleeter2Stems, spleeter4Stems } from '../ml/spleeter/spleeter.js';
import { SPLEETER_2_STEMS_MODEL, SPLEETER_4_STEMS_MODEL } from '../ml/spleeter/spleeter-model.js';
import { modelPassOf, passOver } from './model-runs.js';
import { separationMix, voicedInNoise } from './model-signals.js';
import { TEST_RATE, type RunSettings } from './processor-run.js';

/** One pinned render: what it runs, over what, and the digest of what it makes. */
export interface MlGolden {
  /** The render's name, which the browser spec asks for it by. */
  readonly name: string;
  readonly make: (services: ModelServices) => ProcessorType;
  readonly model: ModelDefinition;
  readonly settings: RunSettings;
  /** The signal, made when the render runs, one array a channel. */
  readonly input: () => readonly Float32Array[];
  /** The samples the render makes, every channel's. */
  readonly samples: number;
  /** The SHA-256 of the samples' bytes in order, lower-case hexadecimal. */
  readonly sha256: string;
}

/** The separators' rate, so their goldens hold the separation and no resampling. */
const SEPARATION_RATE = SPLEETER_2_STEMS_MODEL.definition.sampleRate;

/** Fourteen seconds: Spleeter's first segment's 11.8 and part of the second, so the join is held too. */
const SEPARATION_FRAMES = 14 * SEPARATION_RATE;

/** The settings of a separation that chooses the stem `stem`. */
function choosing(stem: string): RunSettings {
  return { layout: StandardLayouts.stereo, sampleRate: SEPARATION_RATE, values: { stem } };
}

/** The pinned renders, one or more a pack. */
export const ML_GOLDENS: readonly MlGolden[] = [
  {
    // Twelve seconds take the model over two runs, so the golden holds the
    // join between them too.
    name: 'deepfilternet-3',
    make: deepFilterNet3,
    model: DEEPFILTERNET_3_MODEL,
    settings: { layout: StandardLayouts.mono, sampleRate: TEST_RATE },
    input: () => [voicedInNoise(12)],
    samples: 12 * 48_000,
    sha256: '81fdbd5f5d45026944f1a3205377029c0a151962b883f06e91eadad5cdcb6a7d',
  },
  {
    // Four seconds take the model over the join between its first two
    // segments, at three and a half; each segment costs about four seconds of
    // inference.
    name: 'mossformer2-se-48k',
    make: mossFormer2Se48k,
    model: MOSSFORMER2_SE_48K_MODEL,
    settings: { layout: StandardLayouts.mono, sampleRate: TEST_RATE },
    input: () => [voicedInNoise(4)],
    samples: 4 * 48_000,
    sha256: '1c5ee7d0fdf77bc6430639076ebf42c1ae89289e1f933feab22e45f342db545e',
  },
  {
    name: 'spleeter-2-stems vocals',
    make: spleeter2Stems,
    model: SPLEETER_2_STEMS_MODEL.definition,
    settings: choosing('vocals'),
    input: () => separationMix(SEPARATION_FRAMES, SEPARATION_RATE),
    samples: 2 * SEPARATION_FRAMES,
    sha256: '08287bb327c01b13c5378840c2ed54ada6a5282a08ce06615958c5fde0e65562',
  },
  {
    name: 'spleeter-4-stems drums',
    make: spleeter4Stems,
    model: SPLEETER_4_STEMS_MODEL.definition,
    settings: choosing('drums'),
    input: () => separationMix(SEPARATION_FRAMES, SEPARATION_RATE),
    samples: 2 * SEPARATION_FRAMES,
    sha256: '2dcfafa83e7fde993a6778979ead7d7027e3a52577c950956e3dcf65bdff82f2',
  },
];

/** The golden named `name`; throws where there is none. */
export function mlGolden(name: string): MlGolden {
  const golden = ML_GOLDENS.find((one) => one.name === name);
  if (golden === undefined) throw new Error(`No ML golden is named ${name}.`);
  return golden;
}

/**
 * The samples `golden`'s render makes over `services`: its pass over its
 * signal, given in chunks of 16 384 frames, as the rack gives a whole pass.
 */
export async function goldenSamples(
  golden: MlGolden,
  services: ModelServices,
): Promise<Float32Array> {
  const type = golden.make(services);
  const measured = expectSuccess(
    await passOver(modelPassOf(type, golden.settings), golden.input(), [16_384]),
  );
  if (!(measured instanceof Float32Array)) throw new Error('A model pass makes samples.');
  return measured;
}
