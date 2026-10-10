import { Blob as PlatformBlob, File as PlatformFile } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { writeWav } from '@audiogubbins/codecs/testing';
import {
  StandardLayouts,
  derivedSampleCount,
  succeed,
  unsafeBrandId,
  type DomainFailure,
} from '@audiogubbins/domain';
import type { DecodedStreamMessage, StreamReceiverMessage } from '@audiogubbins/import-export';
import { SourceHandling } from '@audiogubbins/media-store';

import type { ImportReport } from '../protocol/import-operations.js';
import { projectScene, storedModel } from '../testing/project-scene.js';
import type { PageFile } from './page-ports.js';

/**
 * Importing many files through the storage worker (ADR-0090): the page lends
 * a decoder that starts a codec worker, played here by a producer posting a
 * decoded stream on a real message channel and keeping to the credit the
 * storage worker gives it.
 */

const IMPORTED_AT = 1_790_000_000_000;

function pageFileOf(bytes: Uint8Array<ArrayBuffer>, fileName: string): PageFile {
  return {
    bytes: { kind: 'file', file: new File([bytes], fileName, { lastModified: IMPORTED_AT }) },
    fileName,
    mediaType: '',
    lastModified: IMPORTED_AT,
  };
}

function wav(frames: number): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(
    writeWav({
      sampleRate: 48_000,
      encoding: { kind: 'integer', bits: 16 },
      channels: [new Float32Array(frames).fill(0.25)],
    }),
  );
}

/** The first bytes of a FLAC file, which the registry routes to a decode. */
function flac(): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(2_048);
  bytes.set([0x66, 0x4c, 0x61, 0x43, 0x00, 0x00, 0x00, 0x22]);
  return bytes;
}

/** The stream a codec worker decodes the FLAC file to: a description, blocks and the end. */
function decoded(): readonly DecodedStreamMessage[] {
  const blocks = Array.from({ length: 12 }, (_, index): DecodedStreamMessage => ({
    kind: 'block',
    channels: [new Float32Array(100).fill(index / 20), new Float32Array(100).fill(-index / 20)],
    frames: 100,
  }));
  return [
    {
      kind: 'description',
      description: {
        codec: 'flac',
        sampleRate: 44_100,
        layout: StandardLayouts.stereo,
        statedFrames: derivedSampleCount(1_200),
        bitRate: undefined,
        leadingFrames: derivedSampleCount(0),
        decoder: { implementation: 'codec-module', name: 'claxon', version: '0.4.3' },
        metadata: {},
      },
    },
    ...blocks,
    { kind: 'end', frames: derivedSampleCount(1_200) },
  ];
}

/** A codec worker's producer: it posts a message for each credit it is given, never more. */
class Producer {
  readonly credits: number[] = [];
  readonly refusals: DomainFailure[] = [];
  sent = 0;
  overrun = false;

  constructor(port: MessagePort, messages: readonly DecodedStreamMessage[]) {
    let credit = 0;
    port.start();
    port.addEventListener('message', (event: MessageEvent<StreamReceiverMessage>) => {
      const message = event.data;
      if (message.kind === 'refused') {
        this.refusals.push(message.failure);
        port.close();
        return;
      }
      this.credits.push(message.credit);
      credit += message.credit;
      while (credit > 0 && this.sent < messages.length) {
        const next = messages[this.sent];
        if (next === undefined) break;
        port.postMessage(
          next,
          next.kind === 'block' ? next.channels.map((channel) => channel.buffer) : [],
        );
        this.sent += 1;
        credit -= 1;
      }
    });
  }
}

beforeEach(() => {
  vi.stubGlobal('File', PlatformFile);
  vi.stubGlobal('Blob', PlatformBlob);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('importing many files through the storage worker (ADR-0090)', () => {
  it('imports each file in turn, decoding a compressed one through the codec worker the page joins, and reports each', async () => {
    const { storage, project, session } = await projectScene();
    const producers: Producer[] = [];
    const reports: ImportReport[] = [];
    const step = unsafeBrandId<'AssetId'>('0000aaaa-0000-4000-8000-0000000000a1');
    const rain = unsafeBrandId<'AssetId'>('0000aaaa-0000-4000-8000-0000000000a2');
    const wind = unsafeBrandId<'AssetId'>('0000aaaa-0000-4000-8000-0000000000a3');

    const ended = await storage.client.imports.importFiles(
      session,
      {
        files: [
          { file: pageFileOf(wav(480), 'Step.wav'), assetId: step },
          { file: pageFileOf(flac(), 'Rain.flac'), assetId: rain },
          { file: pageFileOf(wav(960), 'Wind.wav'), assetId: wind },
        ],
        choice: { mode: SourceHandling.Copy },
        importedAt: IMPORTED_AT,
        decoding: (file) => {
          const channel = new MessageChannel();
          producers.push(new Producer(channel.port2, file === 1 ? decoded() : []));
          return Promise.resolve(succeed(channel.port1));
        },
      },
      (report) => reports.push(report),
    );

    expect(ended.outcomes.map((outcome) => outcome.kind)).toEqual([
      'imported',
      'imported',
      'imported',
    ]);
    expect(reports.at(-1)?.job).toEqual(ended.job);
    expect(
      reports.filter((report) => report.index === 1).map((report) => report.event.kind),
    ).toEqual(
      expect.arrayContaining(['analyse', 'copy', 'decode', 'decode-progress', 'add', 'imported']),
    );
    const [producer] = producers;
    expect(producers).toHaveLength(1);
    // The description alone is asked for first, then a window of blocks at a time.
    expect(producer?.credits[0]).toBe(1);
    expect(producer?.sent).toBe(14);
    expect(producer?.refusals).toEqual([]);
    const stored = await storedModel(storage, project);
    expect([...stored.state.project.assets.values()].map((asset) => asset.displayName)).toEqual([
      'Step',
      'Rain',
      'Wind',
    ]);
    expect(stored.state.sources.get(rain)?.provenance?.rendition).toMatchObject({
      codec: 'flac',
      frames: 1_200,
    });
    expect(storage.lentPorts()).toBe(0);
  });

  it('refuses a file that needs decoding where the page has no codec worker, importing the rest', async () => {
    const { storage, session } = await projectScene();
    const ended = await storage.client.imports.importFiles(
      session,
      {
        files: [
          {
            file: pageFileOf(flac(), 'Rain.flac'),
            assetId: unsafeBrandId<'AssetId'>('0000aaaa-0000-4000-8000-0000000000b1'),
          },
          {
            file: pageFileOf(wav(480), 'Step.wav'),
            assetId: unsafeBrandId<'AssetId'>('0000aaaa-0000-4000-8000-0000000000b2'),
          },
        ],
        choice: { mode: SourceHandling.Copy },
        importedAt: IMPORTED_AT,
      },
      () => undefined,
    );

    const [refused, imported] = ended.outcomes;
    expect(refused?.kind === 'refused' ? refused.failure.code : refused?.kind).toBe(
      'import.decoding-unavailable',
    );
    expect(imported?.kind).toBe('imported');
  });
});
