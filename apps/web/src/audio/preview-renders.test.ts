/**
 * The renders a preview's members are heard from (`preview-renders.ts`): asked
 * for only where a member's chain cannot run as it is heard, counted made once
 * each render is whole, declined ones said, kept while the same scenario asks
 * for them and let go for another.
 */

import { describe, expect, it } from 'vitest';

import {
  QualityLevel,
  StandardLayouts,
  derivedSampleCount,
  instantiateProcessor,
  namedQualityMode,
  sampleRate,
  succeed,
  unsafeBrandId,
  type DomainResult,
  type EditPlan,
  type ProcessorDescriptor,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { failure, fail, FailureKind } from '@audiogubbins/domain';
import type { CachedStream, CachedStreamRequest, CachedStreams } from '@audiogubbins/audio-engine';
import { PROCESSOR_CATALOGUE } from '@audiogubbins/processors';

import {
  HeldRenders,
  RenderPreparation,
  renderRequests,
  type RenderProgress,
} from './preview-renders.js';

const RATE = expectSuccess(sampleRate(48_000));
const QUALITY = namedQualityMode(QualityLevel.Draft).settings;

function descriptor(typeKey: string): ProcessorDescriptor {
  const found = PROCESSOR_CATALOGUE.get(typeKey);
  if (found === undefined) throw new Error(`The catalogue has ${typeKey}.`);
  return found;
}

/** A member's sound: its file, and a second stream running `typeKey`'s chain over it. */
function memberProcessedBy(typeKey: string): EditPlan {
  const processor = instantiateProcessor(
    unsafeBrandId<'ProcessorId'>('7e000000-0001'),
    descriptor(typeKey),
  );
  return {
    streams: [
      {
        sampleRate: RATE,
        layout: StandardLayouts.stereo,
        segments: [
          {
            source: { kind: 'stream', stream: 1 },
            start: derivedSampleCount(0),
            length: derivedSampleCount(4_800),
            reversed: false,
            stages: [],
          },
        ],
      },
      {
        sampleRate: RATE,
        layout: StandardLayouts.stereo,
        processing: {
          kind: 'chain',
          chain: { id: unsafeBrandId<'EffectChainId'>('c4000000-0001'), slots: [processor] },
          input: StandardLayouts.stereo,
        },
        segments: [
          {
            source: { kind: 'media', asset: unsafeBrandId<'AssetId'>('0000beef-0001') },
            start: derivedSampleCount(0),
            length: derivedSampleCount(4_800),
            reversed: false,
            stages: [],
          },
        ],
      },
    ],
  };
}

/** A render the test finishes by hand. */
interface Pending {
  readonly request: CachedStreamRequest;
  finish: () => void;
  released: boolean;
  readFrom: number | undefined;
}

/** Renders opened and read as a test says: ready at once, or declined; made when finished. */
class FakeRenders implements CachedStreams {
  readonly opened: Pending[] = [];
  readonly #ready: DomainResult<void>;

  constructor(ready: DomainResult<void> = succeed(undefined)) {
    this.#ready = ready;
  }

  open(request: CachedStreamRequest): CachedStream {
    const pending: Pending = {
      request,
      finish: () => undefined,
      released: false,
      readFrom: undefined,
    };
    this.opened.push(pending);
    return {
      ready: Promise.resolve(this.#ready),
      read: (start) => {
        pending.readFrom = start;
        return new Promise<void>((resolve) => {
          pending.finish = resolve;
        });
      },
      release: () => {
        pending.released = true;
      },
    };
  }
}

/** Lets every promise settled so far run on. */
async function settled(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
}

describe('the renders a member is heard from', () => {
  it('are asked for where its chain measures its whole input first, and not where it runs live', () => {
    const normalised = memberProcessedBy('loudness-normalisation');
    const gained = memberProcessedBy('gain');

    const requests = renderRequests([normalised, gained], PROCESSOR_CATALOGUE, QUALITY);

    expect(requests.map((one) => [one.plan, one.place])).toEqual([[normalised, 1]]);
    expect(requests[0]?.reason).toMatch(/measures the whole of its input/u);
  });
});

describe('a preparation of renders', () => {
  it('counts each render made only once it is whole, read to its last frame', async () => {
    const renders = new FakeRenders();
    const progress: RenderProgress[] = [];
    const requests = renderRequests(
      [memberProcessedBy('loudness-normalisation')],
      PROCESSOR_CATALOGUE,
      QUALITY,
    );

    const preparing = new RenderPreparation(
      renders,
      { requests, media: [], quality: QUALITY },
      (one) => progress.push(one),
    );
    await settled();

    expect(preparing.progress).toEqual({ needed: 1, made: 0, declined: [] });
    expect(renders.opened[0]?.request).toMatchObject({ place: 1, quality: QUALITY });
    expect(renders.opened[0]?.readFrom).toBe(4_799);

    renders.opened[0]?.finish();
    await settled();
    expect(progress.at(-1)).toEqual({ needed: 1, made: 1, declined: [] });
  });

  it('says why a render the cache declined is not kept, and does not wait for it', async () => {
    const renders = new FakeRenders(
      fail(failure('preview.too-large', FailureKind.Rejected, 'It is too large to keep.')),
    );
    const progress: RenderProgress[] = [];
    const requests = renderRequests(
      [memberProcessedBy('loudness-normalisation')],
      PROCESSOR_CATALOGUE,
      QUALITY,
    );

    new RenderPreparation(renders, { requests, media: [], quality: QUALITY }, (one) =>
      progress.push(one),
    );
    await settled();

    expect(progress.at(-1)).toEqual({ needed: 1, made: 1, declined: ['It is too large to keep.'] });
  });
});

describe('the renders held for the scenario set up', () => {
  it('keeps them while the same renders are asked for, and lets them go for others', async () => {
    const renders = new FakeRenders();
    const progress: RenderProgress[] = [];
    const held = new HeldRenders(
      () => renders,
      (one) => progress.push(one),
    );
    const first = renderRequests(
      [memberProcessedBy('loudness-normalisation')],
      PROCESSOR_CATALOGUE,
      QUALITY,
    );

    held.hold(first, [], QUALITY);
    held.hold(first, [], QUALITY);
    expect(renders.opened).toHaveLength(1);

    held.hold(
      renderRequests([memberProcessedBy('loudness-normalisation')], PROCESSOR_CATALOGUE, QUALITY),
      [],
      QUALITY,
    );
    expect(renders.opened).toHaveLength(2);
    expect(renders.opened[0]?.released).toBe(true);

    held.release();
    renders.opened[1]?.finish();
    await settled();
    expect(renders.opened[1]?.released).toBe(true);
    // Let go, its render's progress is said no more.
    expect(progress.at(-1)).toEqual({ needed: 0, made: 0, declined: [] });
  });
});
