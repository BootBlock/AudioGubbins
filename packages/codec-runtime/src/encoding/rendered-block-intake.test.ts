/**
 * The codec worker's end of a rendered-block channel, with the render side
 * played by the test over a real message channel: blocks written in order as
 * credit allows, the file the same as one written directly, and every way the
 * channel ends.
 */

import {
  BlockReplyKind,
  RenderedBlockKind,
  readRenderedBlockReply,
  type RenderedBlockMessage,
  type RenderedBlockReply,
} from '@audiogubbins/audio-engine';
import { FailureKind, failure, sampleCount, succeed } from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { describe, expect, it } from 'vitest';

import {
  encodeWhole,
  exportRequest,
  testServices,
  testSignal,
} from '../testing/export-encoding.js';
import { openExportEncoder } from './open-export-encoder.js';
import { encodeRenderedBlocks } from './rendered-block-intake.js';

const WAV16 = { format: 'wav', encoding: { kind: 'integer', bits: 16 } } as const;
const RATE = 48_000;

/** The render's end of a channel: sends what it is given as its credit allows. */
class RenderSide {
  readonly port: MessagePort;
  readonly replies: RenderedBlockReply[] = [];
  #credit = 0;
  /** The most blocks sent past the credit granted; the consumer must never be given any. */
  overdrawn = 0;
  readonly #outbox: RenderedBlockMessage[] = [];

  constructor(port: MessagePort) {
    this.port = port;
    port.addEventListener('message', (event: MessageEvent) => {
      const reply = expectSuccess(readRenderedBlockReply(event.data));
      this.replies.push(reply);
      if (reply.kind === BlockReplyKind.Credit) this.#credit += reply.blocks;
      this.#flush();
    });
    port.start();
  }

  /** Queues blocks, sent as credit comes. */
  send(...messages: RenderedBlockMessage[]): void {
    this.#outbox.push(...messages);
    this.#flush();
  }

  #flush(): void {
    while (this.#outbox.length > 0) {
      const next = this.#outbox[0];
      if (next?.kind === RenderedBlockKind.Block && this.#credit === 0) return;
      this.#outbox.shift();
      if (next?.kind === RenderedBlockKind.Block) this.#credit -= 1;
      this.overdrawn = Math.max(this.overdrawn, -this.#credit);
      if (next !== undefined) this.port.postMessage(next);
    }
  }
}

/** The blocks of `planes` in pieces of `frames` frames. */
function blocksOf(planes: readonly Float32Array[], frames: number): RenderedBlockMessage[] {
  const total = planes[0]?.length ?? 0;
  const blocks: RenderedBlockMessage[] = [];
  for (let at = 0; at < total; at += frames) {
    blocks.push({
      kind: RenderedBlockKind.Block,
      channels: planes.map((plane) => plane.slice(at, at + frames)),
    });
  }
  return blocks;
}

const handOnTo =
  (into: Uint8Array[]) =>
  (body: readonly Uint8Array[]): Promise<ReturnType<typeof succeed<undefined>>> => {
    into.push(...body);
    return Promise.resolve(succeed(undefined));
  };

describe('the codec worker’s end of a rendered-block channel', () => {
  it('writes every block as its credit allows, making the file a direct write makes', async () => {
    const source = testSignal(2, 10_000, RATE);
    const writer = expectSuccess(
      await openExportEncoder(exportRequest(WAV16, RATE), testServices()),
    );
    const channel = new MessageChannel();
    const render = new RenderSide(channel.port1);
    const bodies: Uint8Array[] = [];
    const encoding = encodeRenderedBlocks(channel.port2, writer, handOnTo(bodies));
    render.send(...blocksOf(source, 1_500), {
      kind: RenderedBlockKind.End,
      frames: expectSuccess(sampleCount(10_000)),
    });
    const encoded = expectSuccess(await encoding);
    const parts = [encoded.file.head, ...bodies, encoded.file.tail];
    const file = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
    parts.reduce((at, part) => {
      file.set(part, at);
      return at + part.length;
    }, 0);
    expect(encoded.frames).toBe(10_000);
    expect(file).toEqual(await encodeWhole(exportRequest(WAV16, RATE), source));
    expect(render.overdrawn).toBe(0);
    expect(render.replies[0]).toEqual({ kind: BlockReplyKind.Credit, blocks: 2 });
  });

  it('ends with the render’s failures, and refuses a length other than the frames written', async () => {
    const failed = new MessageChannel();
    const stopped = failure('render.cancelled', FailureKind.Rejected, 'The render was cancelled.');
    new RenderSide(failed.port1).send({ kind: RenderedBlockKind.Failed, failures: [stopped] });
    const writer = expectSuccess(
      await openExportEncoder(exportRequest(WAV16, RATE), testServices()),
    );
    expect(expectFailureCode(await encodeRenderedBlocks(failed.port2, writer, handOnTo([])))).toBe(
      'render.cancelled',
    );

    const short = new MessageChannel();
    new RenderSide(short.port1).send(...blocksOf(testSignal(2, 1_000, RATE), 500), {
      kind: RenderedBlockKind.End,
      frames: expectSuccess(sampleCount(1_001)),
    });
    const other = expectSuccess(
      await openExportEncoder(exportRequest(WAV16, RATE), testServices()),
    );
    expect(expectFailureCode(await encodeRenderedBlocks(short.port2, other, handOnTo([])))).toBe(
      'codec-runtime.render-length-differs',
    );
  });

  it('refuses the channel when the encoder or the hand-off fails, which stops the render', async () => {
    const channel = new MessageChannel();
    const render = new RenderSide(channel.port1);
    const writer = expectSuccess(
      await openExportEncoder(exportRequest(WAV16, RATE), testServices()),
    );
    render.send(...blocksOf(testSignal(1, 1_000, RATE), 500));
    expect(expectFailureCode(await encodeRenderedBlocks(channel.port2, writer, handOnTo([])))).toBe(
      'codecs.write-invalid',
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(render.replies.at(-1)).toMatchObject({
      kind: BlockReplyKind.Refused,
      failures: [{ code: 'codecs.write-invalid' }],
    });

    const full = new MessageChannel();
    new RenderSide(full.port1).send(...blocksOf(testSignal(2, 1_000, RATE), 500));
    const quota = failure('storage.quota-exceeded', FailureKind.Rejected, 'The store is full.');
    const another = expectSuccess(
      await openExportEncoder(exportRequest(WAV16, RATE), testServices()),
    );
    expect(
      expectFailureCode(
        await encodeRenderedBlocks(full.port2, another, () =>
          Promise.resolve({ ok: false, failures: [quota] }),
        ),
      ),
    ).toBe('storage.quota-exceeded');
  });

  it('refuses the channel and rejects with the reason when cancelled', async () => {
    const channel = new MessageChannel();
    const render = new RenderSide(channel.port1);
    const writer = expectSuccess(
      await openExportEncoder(exportRequest(WAV16, RATE), testServices()),
    );
    const controller = new AbortController();
    const reason = new Error('The export was cancelled.');
    const encoding = encodeRenderedBlocks(channel.port2, writer, handOnTo([]), controller.signal);
    controller.abort(reason);
    await expect(encoding).rejects.toBe(reason);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(render.replies.at(-1)).toMatchObject({
      kind: BlockReplyKind.Refused,
      failures: [{ code: 'codec-runtime.encoding-cancelled' }],
    });
  });
});
