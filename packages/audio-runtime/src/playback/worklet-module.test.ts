import { describe, expect, it, vi } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';
import { createDiagnosticCentre, createLogStore, LogSeverity } from '@audiogubbins/diagnostics';

import { FakeAudioContext } from '../testing/fake-audio-context.js';
import { WorkletModule } from './worklet-module.js';

function moduleUnderTest(): WorkletModule {
  const logger = createDiagnosticCentre(
    createLogStore(),
    { now: () => 0 },
    { defaultSeverity: LogSeverity.Trace, categoryOverrides: {} },
  ).loggerFor('audio-runtime');
  return new WorkletModule('engine-processor.js', logger);
}

describe('WorkletModule', () => {
  it('adds the module to a context once', async () => {
    const context = new FakeAudioContext();
    const added = vi.spyOn(context.audioWorklet, 'addModule');
    const module = moduleUnderTest();

    expectSuccess(await module.addTo(context));
    expectSuccess(await module.addTo(context));

    expect(added).toHaveBeenCalledTimes(1);
  });

  it('answers the browser’s refusal to load the module with a failure, and tries again next time', async () => {
    const context = new FakeAudioContext();
    vi.spyOn(context.audioWorklet, 'addModule').mockRejectedValueOnce(
      new DOMException('Unable to load a worklet’s module.', 'AbortError'),
    );
    const module = moduleUnderTest();

    const refused = await module.addTo(context);

    expect(refused.ok ? undefined : refused.failures[0].code).toBe(
      'playback.processor-module-failed',
    );
    expectSuccess(await module.addTo(context));
  });

  it('lets a fault that is no refusal surface as itself', async () => {
    const context = new FakeAudioContext();
    const fault = new TypeError('Cannot read properties of undefined.');
    vi.spyOn(context.audioWorklet, 'addModule').mockRejectedValueOnce(fault);

    await expect(moduleUnderTest().addTo(context)).rejects.toBe(fault);
  });
});
