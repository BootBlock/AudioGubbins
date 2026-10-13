/**
 * Long files through the codec worker, never held whole (the packet's third
 * acceptance criterion, ADR-0090, ADR-0092): files made as they are read and
 * renders made as they are sent, measured at the ports the worker is given.
 *
 * - An RF64 file whose data runs past four gibibytes is recognised and analysed
 *   from its head and the chunk after its data, reading no more of it than a
 *   few small reads.
 * - FLAC files of eleven or more blocks, stereo and 5.1, are decoded in blocks
 *   within the stated caps, 65,536 frames and 1 MiB (the frame cap binds the
 *   stereo stream and the byte cap the 5.1), each read of the file small and
 *   the file read about once, the stream never past its receiver's credit,
 *   every frame decoded to the sample it was made from.
 * - A render past four gibibytes is encoded to WAV, which becomes RF64: each
 *   body the encoder sends is one rendered block's, the head and tail are a
 *   head and a tail, and the two channels' credit bounds the audio between the
 *   render and the storage to a few blocks at any moment.
 *
 * Each length is the least that crosses what it tests: four gibibytes where the
 * RF64 path matters, and otherwise enough blocks to pass every cap and the
 * credit window several times over.
 */

import { StandardLayouts, derivedSampleCount } from '@audiogubbins/domain';
import {
  readEncodedStreamMessage,
  readStreamReceiverMessage,
  type DecodedStreamMessage,
  type RenderedStreamMessage,
} from '@audiogubbins/import-export';
import { describe, expect, it, vi } from 'vitest';

import { openExportEncoder } from '../encoding/open-export-encoder.js';
import type { PortMessage } from '../streams/stream-port.js';
import { exportRequest } from '../testing/export-encoding.js';
import {
  FileReads,
  flacSample,
  flacSource,
  generatedFile,
  generatedReader,
  rf64Source,
  type FlacShape,
} from '../testing/generated-files.js';
import { decodedReceiver, messageChannel, workerHarness } from '../testing/worker-harness.js';

/** Four gibibytes, past which a WAV file's sizes no longer fit its 32-bit fields. */
const FOUR_GIB = 2 ** 32;

/** The most frames a decoded block holds (decision 8). */
const MOST_BLOCK_FRAMES = 65_536;

/** The most bytes of samples a decoded block holds, across its channels (decision 8). */
const MOST_BLOCK_BYTES = 1_048_576;

/** How long a receiver stops granting credit, in milliseconds: long enough for a sender to run ahead. */
const STALLED_MS = 250;

/** The encoded message at which the storage stops granting credit for a while. */
const STALL_AT = 64;

/** The most bytes one read of a file may take: no more than a block's. */
const MOST_READ_BYTES = MOST_BLOCK_BYTES;

describe('the codec worker with a long file', () => {
  it('analyses an RF64 file past four gibibytes from its head and the chunk after its data, reading none of the data', async () => {
    const frames = FOUR_GIB / 4 + 48_000;
    const source = rf64Source({ sampleRate: 48_000, channels: 2, frames, title: 'Long night' });
    expect(source.size).toBeGreaterThan(FOUR_GIB);
    const reads = new FileReads();
    const harness = await workerHarness({ fileReader: generatedReader(reads) });

    harness.core.receive({
      kind: 'analyse',
      request: 'a',
      file: { kind: 'file', file: generatedFile(source) },
    });

    expect(await harness.answer('a')).toMatchObject({
      kind: 'analysed',
      analysis: {
        kind: 'read-in-place',
        container: 'rf64',
        metadata: { kind: 'read', metadata: { text: { title: 'Long night' } } },
      },
    });
    // The chunk after the data was read, past four gibibytes, and the data was not.
    expect(reads.furthest).toBe(source.size);
    expect(reads.largest).toBeLessThanOrEqual(MOST_READ_BYTES);
    expect(reads.total).toBeLessThan(65_536);
  });

  it.each<FlacShape & { readonly layout: string; readonly blockFrames: number }>([
    // Stereo: 65,536 frames are 512 KiB of samples, so the frame cap binds.
    {
      sampleRate: 48_000,
      channels: 2,
      frames: 11 * 65_536 + 1_000,
      layout: 'stereo',
      blockFrames: 65_536,
    },
    // 5.1: 1 MiB holds 43,690 frames of six channels, so the byte cap binds.
    {
      sampleRate: 44_100,
      channels: 6,
      frames: 11 * 43_690 + 77,
      layout: '5.1',
      blockFrames: 43_690,
    },
  ])(
    'decodes a long $layout FLAC file in blocks within the caps, reading it about once, never past credit',
    async ({ layout: _layout, blockFrames, ...shape }) => {
      const source = flacSource(shape);
      const reads = new FileReads();
      const harness = await workerHarness({ fileReader: generatedReader(reads) });
      const window = 4;
      const receiver = decodedReceiver({ window });
      // A receiver that stops granting, as a storage slow to write does: the
      // worker sends the credit it has and then waits, however fast it decodes.
      receiver.pause();

      harness.core.receive({
        kind: 'decode',
        request: 'd',
        file: { kind: 'file', file: generatedFile(source) },
        stream: receiver.port,
      });
      await vi.waitFor(() => {
        expect(receiver.messages).toHaveLength(window);
      });
      await new Promise((resolve) => setTimeout(resolve, STALLED_MS));
      expect(receiver.messages).toHaveLength(window);
      receiver.resume();
      expect(await harness.answer('d')).toMatchObject({ kind: 'decoded', frames: shape.frames });
      await receiver.ended;
      receiver.close();

      expect(receiver.overdrawn()).toBe(0);
      expect(reads.largest).toBeLessThanOrEqual(MOST_READ_BYTES);
      expect(reads.furthest).toBe(source.size);
      // Read about once: never the whole file twice, nor a block of it many times.
      expect(reads.total).toBeLessThan(source.size + MOST_READ_BYTES);

      const blocks = receiver.messages.filter(
        (message): message is Extract<DecodedStreamMessage, { kind: 'block' }> =>
          message.kind === 'block',
      );
      const sizes = blocks.map((block) => block.frames);
      expect(sizes.slice(0, -1).every((frames) => frames === blockFrames)).toBe(true);
      expect(sizes.reduce((sum, frames) => sum + frames, 0)).toBe(shape.frames);
      for (const block of blocks) {
        expect(block.frames).toBeLessThanOrEqual(MOST_BLOCK_FRAMES);
        const bytes = block.channels.reduce((sum, plane) => sum + plane.byteLength, 0);
        expect(bytes).toBeLessThanOrEqual(MOST_BLOCK_BYTES);
      }
      expect(receiver.messages.at(-1)).toEqual({ kind: 'end', frames: shape.frames });

      // Every frame is the sample it was made from, in its channel.
      let at = 0;
      let wrong = 0;
      for (const block of blocks) {
        block.channels.forEach((plane, channel) => {
          for (let frame = 0; frame < block.frames; frame += 1) {
            if (plane[frame] !== flacSample(at + frame, channel) / 32_768) wrong += 1;
          }
        });
        at += block.frames;
      }
      expect(wrong).toBe(0);
    },
  );

  it(
    'encodes a render past four gibibytes to RF64 a block at a time, the credit of both channels bounding what is between them',
    { timeout: 300_000 },
    async () => {
      // 64-bit float stereo: a block of 65,536 frames encodes to 1 MiB, so the
      // body passes four gibibytes in the fewest samples.
      const frameBytes = 2 * 8;
      const blockBytes = MOST_BLOCK_FRAMES * frameBytes;
      const blocks = FOUR_GIB / blockBytes + 1;
      const frames = blocks * MOST_BLOCK_FRAMES;
      const harness = await workerHarness({ openExportEncoder });
      const rendered = messageChannel();
      const stored = messageChannel();

      // The render worker: a block for each credit, made as it is sent.
      let sent = 0;
      let renderCredit = 0;
      let mostRenderCredit = 0;
      const renderSide = rendered.port2;
      const sendWhileCredit = (): void => {
        while (renderCredit > 0 && sent <= blocks) {
          renderCredit -= 1;
          if (sent === blocks) {
            const end: RenderedStreamMessage = { kind: 'end', frames: derivedSampleCount(frames) };
            renderSide.postMessage(end, []);
          } else {
            const planes = [
              new Float32Array(MOST_BLOCK_FRAMES).fill((sent % 8) / 8),
              new Float32Array(MOST_BLOCK_FRAMES).fill(-(sent % 8) / 8),
            ];
            const block: RenderedStreamMessage = {
              kind: 'block',
              channels: planes,
              frames: MOST_BLOCK_FRAMES,
            };
            renderSide.postMessage(
              block,
              planes.map((plane) => plane.buffer),
            );
          }
          sent += 1;
        }
      };
      renderSide.addEventListener('message', (event: PortMessage) => {
        const read = readStreamReceiverMessage(event.data);
        if (!read.ok || read.value.kind !== 'ready') throw new Error('The render was refused.');
        renderCredit += read.value.credit;
        mostRenderCredit = Math.max(mostRenderCredit, renderCredit);
        sendWhileCredit();
      });
      renderSide.start();

      // The storage worker: a window of credit, one more for each message taken.
      const storageWindow = 8;
      let granted = storageWindow;
      let received = 0;
      let overdrawn = 0;
      let bodyBytes = 0;
      let largestBody = 0;
      let mostBetween = 0;
      let stalled = false;
      let owed = 0;
      let finished: { readonly head: Uint8Array; readonly tail: Uint8Array } | undefined;
      let ended: () => void = () => undefined;
      const storageEnded = new Promise<void>((resolve) => {
        ended = resolve;
      });
      const storageSide = stored.port2;
      storageSide.addEventListener('message', (event: PortMessage) => {
        received += 1;
        overdrawn = Math.max(overdrawn, received - granted);
        const read = readEncodedStreamMessage(event.data);
        if (!read.ok) throw new Error(read.failures[0].summary);
        const message = read.value;
        if (message.kind === 'body') {
          bodyBytes += message.bytes.length;
          largestBody = Math.max(largestBody, message.bytes.length);
          // The audio sent by the render and not yet taken by the storage.
          mostBetween = Math.max(mostBetween, Math.min(sent, blocks) * blockBytes - bodyBytes);
        } else {
          if (message.kind === 'finished') finished = message.file;
          ended();
        }
        // Once, a while into the file, the storage stops granting, as one slow
        // to write does: the encoder sends the credit it has and then waits.
        if (received === STALL_AT) {
          stalled = true;
          setTimeout(() => {
            stalled = false;
            granted += owed;
            storageSide.postMessage({ kind: 'ready', credit: owed }, []);
            owed = 0;
          }, STALLED_MS);
        }
        if (stalled) {
          owed += 1;
          return;
        }
        granted += 1;
        storageSide.postMessage({ kind: 'ready', credit: 1 }, []);
      });
      storageSide.start();
      storageSide.postMessage({ kind: 'ready', credit: storageWindow }, []);

      harness.core.receive({
        kind: 'encode',
        request: 'e',
        encode: exportRequest(
          { format: 'wav', encoding: { kind: 'float', bits: 64 } },
          48_000,
          StandardLayouts.stereo,
        ),
        rendered: rendered.port1,
        stream: stored.port1,
      });
      expect(await harness.answer('e')).toMatchObject({ kind: 'encoded', frames });
      await storageEnded;
      renderSide.close();
      storageSide.close();

      expect(bodyBytes).toBe(frames * frameBytes);
      expect(bodyBytes).toBeGreaterThan(FOUR_GIB);
      expect(largestBody).toBeLessThanOrEqual(MOST_BLOCK_BYTES);
      expect(overdrawn).toBe(0);
      // The render is never granted more than the encoder's window of blocks,
      // and what lies between the two workers is that window, the block being
      // encoded and the storage's window: never the file.
      const renderWindow = 4;
      expect(mostRenderCredit).toBeLessThanOrEqual(renderWindow);
      expect(mostBetween).toBeLessThanOrEqual((renderWindow + 1 + storageWindow) * blockBytes);

      if (finished === undefined) throw new Error('The encoder never finished the file.');
      const head = new DataView(
        finished.head.buffer,
        finished.head.byteOffset,
        finished.head.length,
      );
      expect(String.fromCharCode(...finished.head.subarray(0, 4))).toBe('RF64');
      expect(String.fromCharCode(...finished.head.subarray(12, 16))).toBe('ds64');
      expect(head.getBigUint64(28, true)).toBe(BigInt(bodyBytes));
      expect(head.getBigUint64(36, true)).toBe(BigInt(frames));
      expect(finished.head.length + finished.tail.length).toBeLessThan(MOST_READ_BYTES);
    },
  );
});
