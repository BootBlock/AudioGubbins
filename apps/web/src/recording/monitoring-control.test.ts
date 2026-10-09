import { describe, expect, it } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';
import { FromCaptureKind } from '@audiogubbins/audio-runtime';
import { unsafeBrandId, type EffectChain } from '@audiogubbins/domain';

import { buildShellContext } from '../testing/shell-context.js';
import { everythingQueued } from '../testing/waiting.js';
import { markHeadphones } from '../state/recording-settings.js';

/** A shell with its input armed, and the capture under it. */
async function armedShell() {
  const built = buildShellContext();
  const { input, monitoring } = built.context.recording;
  expectSuccess(input.arm({ purpose: { kind: 'new-stack' }, holdsWriteLease: true }));
  await everythingQueued();
  const capture = built.recording.captures.at(-1);
  if (capture === undefined) throw new Error('No input opened.');
  return { ...built, input, monitoring, capture };
}

/** Disarms and arms the input again, as the person does, and answers the new capture. */
async function armAgain(built: Awaited<ReturnType<typeof armedShell>>) {
  expectSuccess(built.input.disarm());
  expectSuccess(built.input.arm({ purpose: { kind: 'new-stack' }, holdsWriteLease: true }));
  await everythingQueued();
  const capture = built.recording.captures.at(-1);
  if (capture === undefined) throw new Error('No input opened.');
  return capture;
}

const CHAIN: EffectChain = { id: unsafeBrandId<'EffectChainId'>('chain-1'), slots: [] };

describe('monitoring', () => {
  it('is unavailable with no input open, and off once one is', async () => {
    const built = buildShellContext();
    const { monitoring } = built.context.recording;
    expect(monitoring.view.get().monitoring.kind).toBe('unavailable');
    const refused = monitoring.toggle();
    expect(refused.ok ? undefined : refused.failures[0].code).toBe('monitoring.no-input');
    const armed = await armedShell();
    expect(armed.monitoring.view.get().monitoring.kind).toBe('off');
  });

  it('warns of feedback before it starts where the output cannot be told apart from speakers', async () => {
    const { monitoring, capture } = await armedShell();
    expectSuccess(monitoring.toggle());
    expect(monitoring.view.get().monitoring.kind).toBe('confirming');
    expect(capture.monitors).toEqual([]);
    expectSuccess(monitoring.confirm());
    expect(monitoring.view.get().monitoring.kind).toBe('on');
    expect(capture.monitors).toEqual([true]);
    expectSuccess(monitoring.toggle());
    expect(monitoring.view.get().monitoring.kind).toBe('off');
    expect(capture.monitors).toEqual([true, false]);
  });

  it('starts at once, with no warning, for a profile used with headphones', async () => {
    const built = await armedShell();
    built.context.audioSettings.reviseRecording(markHeadphones('Raw/Studio', true));
    expectSuccess(built.monitoring.toggle());
    expect(built.monitoring.view.get().monitoring.kind).toBe('on');
  });

  it('starts by itself only for a headphones profile the person had it on with', async () => {
    const built = await armedShell();
    expectSuccess(built.monitoring.toggle());
    expectSuccess(built.monitoring.confirm());

    // Remembered on, but the profile is not for headphones: it stays off.
    const plain = await armAgain(built);
    expect(built.monitoring.view.get().monitoring.kind).toBe('off');
    expect(plain.monitors).toEqual([]);

    built.context.audioSettings.reviseRecording(markHeadphones('Raw/Studio', true));
    const marked = await armAgain(built);
    expect(built.monitoring.view.get().monitoring.kind).toBe('on');
    expect(marked.monitors).toEqual([true]);
  });

  it('stays off, saying why, where the device cannot route the input to the output', async () => {
    const built = await armedShell();
    built.capture.monitorRefusal = 'This device has no output to monitor through.';
    built.context.audioSettings.reviseRecording(markHeadphones('Raw/Studio', true));
    const refused = built.monitoring.toggle();
    expect(refused.ok ? undefined : refused.failures[0].summary).toBe(
      'This device has no output to monitor through.',
    );
    expect(built.monitoring.view.get().monitoring.kind).toBe('off');
  });

  it('is refused, with the reason, through a chain that cannot run live, and goes on dry', async () => {
    const built = await armedShell();
    built.context.audioSettings.reviseRecording(markHeadphones('Raw/Studio', true));
    expectSuccess(built.monitoring.toggle());
    expectSuccess(
      built.monitoring.monitorThrough({
        asset: unsafeBrandId('asset-1'),
        name: 'Vocal',
        chain: CHAIN,
      }),
    );
    expect(built.capture.chains).toEqual([CHAIN]);
    built.capture.say({
      kind: FromCaptureKind.ChainRefused,
      failures: [{ code: 'chain.not-live', summary: 'Noise reduction needs its learnt noise.' }],
    });
    const { monitoring } = built.monitoring.view.get();
    expect(monitoring.kind === 'off' && monitoring.refusal).toBe(
      'Noise reduction needs its learnt noise.',
    );
    const refused = built.monitoring.toggle();
    expect(refused.ok ? undefined : refused.failures[0].code).toBe('monitoring.chain-not-live');

    expectSuccess(built.monitoring.monitorThrough(undefined));
    expect(built.capture.chains).toEqual([CHAIN, undefined]);
    expectSuccess(built.monitoring.toggle());
    expect(built.monitoring.view.get().monitoring.kind).toBe('on');
  });

  it('adds the latency of a live chain to the monitored path', async () => {
    const built = await armedShell();
    built.context.audioSettings.reviseRecording(markHeadphones('Raw/Studio', true));
    expectSuccess(built.monitoring.toggle());
    const before = built.monitoring.view.get().monitoring;
    expectSuccess(
      built.monitoring.monitorThrough({
        asset: unsafeBrandId('asset-1'),
        name: 'Vocal',
        chain: CHAIN,
      }),
    );
    built.capture.say({
      kind: FromCaptureKind.Monitoring,
      on: true,
      chained: true,
      chainLatencyFrames: 480,
    });
    const after = built.monitoring.view.get().monitoring;
    if (before.kind !== 'on' || after.kind !== 'on') throw new Error('Monitoring is not on.');
    expect(after.latency.seconds - before.latency.seconds).toBeCloseTo(0.01, 6);
  });
});
