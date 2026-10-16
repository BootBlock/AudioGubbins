import { describe, expect, it } from 'vitest';

import {
  MAXIMUM_QUALITY,
  StandardLayouts,
  derivedSampleCount,
  namedQualityMode,
  QualityLevel,
  sampleRate,
  silencePlan,
  succeed,
  type DomainResult,
  type SampleCount,
} from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { BuiltInNodeType, PcmDescriptionKind, toneRecipe } from '@audiogubbins/audio-engine';
import { graphOf, named, nodeOf, wire } from '@audiogubbins/audio-engine/testing';

import type { SourceDescription } from '../protocol/source-descriptions.js';
import { continueRequest } from './continued-request.js';
import type { PlaybackRequest } from './playback-preparation.js';
import type { Continuation, RequestSources } from './request-sources.js';

const MONO = StandardLayouts.mono;
const RATE = expectSuccess(sampleRate(48_000));
const FROM = derivedSampleCount(9_600);

/** Two graph inputs mixed into the output. */
const GRAPH = graphOf(
  [
    nodeOf('a', BuiltInNodeType.GraphInput, MONO, { outputs: ['out'] }),
    nodeOf('b', BuiltInNodeType.GraphInput, MONO, { outputs: ['out'] }),
    nodeOf('out', BuiltInNodeType.Output, MONO, { inputs: ['a', 'b'] }),
  ],
  [wire('a.out', 'out.a'), wire('b.out', 'out.b')],
);

function edited(frames: number): SourceDescription {
  return {
    node: named('a'),
    kind: PcmDescriptionKind.Edited,
    sampleRate: RATE,
    plan: silencePlan(RATE, MONO, derivedSampleCount(frames)),
    media: [],
  };
}

function tone(frequency: number): SourceDescription {
  return {
    node: named('b'),
    kind: PcmDescriptionKind.Signal,
    sampleRate: RATE,
    recipe: expectSuccess(toneRecipe(1, 48_000, frequency, 0.25)),
  };
}

function request(sources: readonly SourceDescription[]): PlaybackRequest {
  return { graph: GRAPH, quality: MAXIMUM_QUALITY, sources };
}

const LOADED = request([edited(100), tone(440)]);

/** The feeder's sources, as a continuation reaches them: each asked continuation noted, each taken. */
function feederSources() {
  const asked: { readonly sources: readonly SourceDescription[]; readonly from: SampleCount }[] =
    [];
  const sources: Pick<RequestSources, 'continueWith'> = {
    continueWith: (_request, described, from): Promise<DomainResult<Continuation>> => {
      asked.push({ sources: described, from });
      return Promise.resolve(succeed({ kind: 'continued', frame: derivedSampleCount(9_000) }));
    },
  };
  return { asked, sources };
}

/** Why `next` cannot go on from `loaded`, having asked the feeder nothing. */
async function refusal(loaded: PlaybackRequest, next: PlaybackRequest): Promise<string> {
  const feeder = feederSources();
  const code = expectFailureCode(await continueRequest(loaded, next, feeder.sources, FROM));
  expect(feeder.asked).toEqual([]);
  return code;
}

describe('a request that continues the loaded one', () => {
  it('sends the feeder its edited sounds alone, every other source being as loaded', async () => {
    const feeder = feederSources();
    const next = edited(200);

    const continued = await continueRequest(
      LOADED,
      request([tone(440), next]),
      feeder.sources,
      FROM,
    );

    expect(expectSuccess(continued)).toEqual({ kind: 'continued', frame: 9_000 });
    expect(feeder.asked).toEqual([{ sources: [next], from: FROM }]);
  });

  it('goes on at once, asking the feeder nothing, where it plays no edited sound', async () => {
    const feeder = feederSources();
    const tones = request([tone(440)]);

    const continued = await continueRequest(tones, tones, feeder.sources, FROM);

    expect(expectSuccess(continued)).toEqual({ kind: 'continued', frame: FROM });
    expect(feeder.asked).toEqual([]);
  });

  it('is refused where a tone changed, recorded audio plays, or the graph inputs it feeds differ', async () => {
    const recorded: SourceDescription = {
      node: named('b'),
      kind: PcmDescriptionKind.Pcm,
      sampleRate: RATE,
      channels: [new Float32Array(4)],
    };
    const withRecording = request([edited(100), recorded]);

    for (const next of [
      request([edited(200), tone(880)]),
      request([edited(200)]),
      request([edited(200), edited(300)]),
      request([edited(200), { ...tone(440), node: named('c') }]),
    ]) {
      expect(await refusal(LOADED, next)).toBe('playback.continuation-unmatched');
    }
    expect(await refusal(withRecording, withRecording)).toBe('playback.continuation-unmatched');
  });

  it('is refused where the graph or the preview quality changed, or nothing is loaded', async () => {
    const otherGraph = graphOf(
      [
        nodeOf('a', BuiltInNodeType.GraphInput, MONO, { outputs: ['out'] }),
        nodeOf('b', BuiltInNodeType.GraphInput, MONO, { outputs: ['out'] }),
        nodeOf('out', BuiltInNodeType.Output, MONO, { inputs: ['b', 'a'] }),
      ],
      [wire('a.out', 'out.a'), wire('b.out', 'out.b')],
    );
    const draft = { ...LOADED, quality: namedQualityMode(QualityLevel.Draft) };
    const feeder = feederSources();

    expect(await refusal(LOADED, { ...LOADED, graph: otherGraph })).toBe(
      'playback.continuation-unmatched',
    );
    expect(await refusal(LOADED, draft)).toBe('playback.continuation-unmatched');
    expect(expectFailureCode(await continueRequest(undefined, LOADED, feeder.sources, FROM))).toBe(
      'playback.continuation-unloaded',
    );
  });
});
