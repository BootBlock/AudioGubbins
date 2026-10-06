import { describe, expect, it } from 'vitest';

import {
  FailureKind,
  MAXIMUM_QUALITY,
  createCancellationSource,
  failure,
  fail,
  sampleRate,
  succeed,
  unsafeBrandId,
  type DomainResult,
  type EffectChain,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import type { CachedStream, CachedStreams } from '../pcm/cached-streams.js';
import { rackedMedia, rackedPlan } from '../testing/racked-plan.js';
import { PreviewClient } from './preview-client.js';
import type { FromPreview, ToPreview } from './preview-messages.js';
import type { PreviewPort } from './preview-port.js';
import { PreviewService } from './preview-service.js';

const RATE = expectSuccess(sampleRate(48_000));
const LENGTH = 1_000;
const CHAIN: EffectChain = { id: unsafeBrandId<'EffectChainId'>('00000000-c4a1'), slots: [] };
const SAMPLES = [Float32Array.from({ length: LENGTH }, (_, frame) => frame + 1)];

/**
 * `message` as a structured clone makes it, but for the files an open names,
 * which a browser clones as files and the test's stand-ins cannot be.
 */
function cloned(message: ToPreview | FromPreview, transfer: readonly ArrayBuffer[]): unknown {
  if (message.kind !== 'open') return structuredClone(message, { transfer: [...transfer] });
  const files = message.media.map((entry) => entry.file);
  const copy = structuredClone({
    ...message,
    media: message.media.map((entry) => ({ ...entry, file: undefined })),
  });
  return { ...copy, media: copy.media.map((entry, index) => ({ ...entry, file: files[index] })) };
}

interface Channel {
  readonly reader: PreviewPort<ToPreview>;
  readonly worker: PreviewPort<FromPreview>;
  readonly closed: () => boolean;
  /** Hands the reader a message as if the worker had sent it. */
  readonly inject: (data: unknown) => void;
}

/** Two ends of a channel, each message cloned and delivered on a later task, as a port does. */
function channel(): Channel {
  const listeners: { reader?: (data: unknown) => void; worker?: (data: unknown) => void } = {};
  let closed = false;
  const deliver = (
    to: 'reader' | 'worker',
    message: ToPreview | FromPreview,
    transfer: readonly ArrayBuffer[],
  ) => {
    const copy = cloned(message, transfer);
    setTimeout(() => listeners[to]?.(copy), 0);
  };
  return {
    reader: {
      post: (message, transfer) => {
        deliver('worker', message, transfer);
      },
      listen: (onMessage) => {
        listeners.reader = onMessage;
      },
      close: () => undefined,
    },
    worker: {
      post: (message, transfer) => {
        deliver('reader', message, transfer);
      },
      listen: (onMessage) => {
        listeners.worker = onMessage;
      },
      close: () => {
        closed = true;
      },
    },
    closed: () => closed,
    inject: (data) => {
      listeners.reader?.(data);
    },
  };
}

/** Renders whose frames are made only once `make` is called, each frame its index plus one. */
function heldRenders(ready: DomainResult<void> = succeed(undefined)) {
  let make: () => void = () => undefined;
  const made = new Promise<void>((resolve) => {
    make = resolve;
  });
  const released: number[] = [];
  let opened = 0;
  const renders: CachedStreams = {
    open: (): CachedStream => {
      opened += 1;
      const id = opened;
      return {
        ready: Promise.resolve(ready),
        read: async (start, frames, into) => {
          await made;
          into[0]?.set(SAMPLES[0]?.subarray(start, start + frames) ?? []);
        },
        release: () => {
          released.push(id);
        },
      };
    },
  };
  return { renders, make, released };
}

function request() {
  return {
    plan: rackedPlan(CHAIN, LENGTH, RATE),
    place: 1,
    media: [rackedMedia(SAMPLES, RATE)],
    quality: MAXIMUM_QUALITY.settings,
  };
}

describe('the renders read from another worker', () => {
  it('answers a read once the render has made its frames, and lets the render go when closed', async () => {
    const { reader, worker } = channel();
    const { renders, make, released } = heldRenders();
    new PreviewService(worker, renders);
    const client = new PreviewClient(reader);
    const stream = client.open(request());
    expect(await stream.ready).toEqual(succeed(undefined));

    const into = [new Float32Array(100)];
    let answered = false;
    const reading = stream.read(500, 100, into).then(() => {
      answered = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(answered).toBe(false);
    make();
    await reading;
    expect(into[0]).toEqual(SAMPLES[0]?.subarray(500, 600));

    stream.release();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(released).toEqual([1]);
  });

  it('says the cache declined a render, so the reader runs the chain itself', async () => {
    const { reader, worker } = channel();
    const declined = fail(
      failure('preview.render-too-long', FailureKind.Rejected, 'Its render is too long.'),
    );
    new PreviewService(worker, heldRenders(declined).renders);
    const ready = await new PreviewClient(reader).open(request()).ready;
    expect(ready.ok).toBe(false);
    if (!ready.ok) expect(ready.failures[0].code).toBe('preview.render-too-long');
  });

  it('stops waiting for a cancelled read, and fails every read waiting on a reply it cannot read', async () => {
    const { reader, worker, inject } = channel();
    new PreviewService(worker, heldRenders().renders);
    const client = new PreviewClient(reader);
    const stream = client.open(request());
    const cancel = createCancellationSource();
    const cancelled = stream.read(0, 10, [new Float32Array(10)], cancel.signal);
    cancel.cancel();
    await expect(cancelled).rejects.toThrow();

    const waiting = stream.read(0, 10, [new Float32Array(10)]);
    inject({ kind: 'samples', read: 'two' });
    await expect(waiting).rejects.toThrow(/could not be read/u);
    await expect(stream.read(0, 10, [new Float32Array(10)])).rejects.toThrow(/could not be read/u);
  });

  it('lets go of everything a reader held when its port is closed', async () => {
    const { reader, worker, closed } = channel();
    const { renders, released } = heldRenders();
    const service = new PreviewService(worker, renders);
    const client = new PreviewClient(reader);
    client.open(request());
    client.open(request());
    await new Promise((resolve) => setTimeout(resolve, 10));
    service.close();
    expect(released).toEqual([1, 2]);
    expect(closed()).toBe(true);
  });
});
