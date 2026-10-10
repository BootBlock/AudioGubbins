import { Blob as PlatformBlob, File as PlatformFile } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { writeWav } from '@audiogubbins/codecs/testing';
import {
  StandardLayouts,
  derivedSampleCount,
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
        sampleRate: 44_100,
        layout: StandardLayouts.stereo,
        statedFrames: derivedSampleCount(1_200),
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

/**
 * A codec worker on the other end of the port the page joins the storage
 * worker by: it answers every analysis as a FLAC stream to decode, and decodes
 * each file through a producer on the stream's port, recording each.
 */
class FakeCodecWorker {
  readonly producers: Producer[] = [];
  readonly requests: string[] = [];

  constructor(port: MessagePort, failsDecoding = false) {
    port.start();
    port.addEventListener('message', (event: MessageEvent<Record<string, unknown>>) => {
      const message = event.data;
      const request = String(message['request']);
      this.requests.push(`${String(message['kind'])} ${request}`);
      if (message['kind'] === 'analyse') {
        port.postMessage({
          kind: 'analysed',
          request,
          analysis: {
            kind: 'decode',
            stream: {
              codec: 'flac',
              container: 'flac',
              sampleRate: 44_100,
              layout: StandardLayouts.stereo,
              statedFrames: 1_200,
              leadingFrames: 0,
              bitRate: undefined,
              bitsPerSample: 16,
            },
            decoder: { implementation: 'codec-module', name: 'Symphonia', version: '0.6.1' },
            metadata: { kind: 'none' },
          },
        });
      }
      const stream = message['stream'];
      if (message['kind'] === 'decode' && failsDecoding) {
        // A file the worker cannot open fails on the link alone, its stream never begun.
        port.postMessage({
          kind: 'failed',
          request,
          failure: { code: 'codec-runtime.unreadable', kind: 'retryable', summary: 'Unreadable.' },
        });
      } else if (message['kind'] === 'decode' && stream instanceof MessagePort) {
        this.producers.push(new Producer(stream, decoded()));
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
    const reports: ImportReport[] = [];
    const joined = new MessageChannel();
    const codecWorker = new FakeCodecWorker(joined.port2);
    await storage.client.imports.connectCodecWorker(joined.port1);
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
      },
      (report) => reports.push(report),
    );

    expect(ended.outcomes.map((outcome) => outcome.kind)).toEqual([
      'imported',
      'imported',
      'imported',
    ]);
    expect(reports.at(-1)?.job).toEqual(ended.job);
    // A container that maps no metadata leaves the audio's import whole.
    const decodedFile = ended.outcomes[1];
    expect(decodedFile?.kind === 'imported' ? decodedFile.imported.metadataRefused : 'none').toBe(
      undefined,
    );
    expect(
      reports.filter((report) => report.index === 1).map((report) => report.event.kind),
    ).toEqual(
      expect.arrayContaining(['analyse', 'copy', 'decode', 'decode-progress', 'add', 'imported']),
    );
    // The compressed file alone is analysed and decoded there, as one request each.
    expect(codecWorker.requests).toEqual(['analyse storage-1', 'decode storage-2']);
    const [producer] = codecWorker.producers;
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

  it('refuses a file that needs decoding where the page joined no codec worker, importing the rest', async () => {
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

  it('refuses a file whose decoding the codec worker ends on the link alone, keeping nothing', async () => {
    const { storage, session } = await projectScene();
    const joined = new MessageChannel();
    new FakeCodecWorker(joined.port2, true);
    await storage.client.imports.connectCodecWorker(joined.port1);
    const ended = await storage.client.imports.importFiles(
      session,
      {
        files: [
          {
            file: pageFileOf(flac(), 'Rain.flac'),
            assetId: unsafeBrandId<'AssetId'>('0000aaaa-0000-4000-8000-0000000000c1'),
          },
        ],
        choice: { mode: SourceHandling.Copy },
        importedAt: IMPORTED_AT,
      },
      () => undefined,
    );
    const [refused] = ended.outcomes;
    expect(refused?.kind === 'refused' ? refused.failure.code : refused?.kind).toBe(
      'codec-runtime.unreadable',
    );
    expect(session.getSnapshot().model.state.project.assets.size).toBe(0);
  });
});
