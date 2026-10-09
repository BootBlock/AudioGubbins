import { describe, expect, it } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';
import { derivedSampleCount } from '@audiogubbins/domain';
import { FromCaptureKind } from '@audiogubbins/audio-runtime';
import { retrospectiveOn, type ArmedPurpose } from '@audiogubbins/recording';

import { createDiagnosticCentre, createLogStore } from '@audiogubbins/diagnostics';

import { buildShellContext } from '../testing/shell-context.js';
import {
  NOT_ALLOWED,
  fakeRecording,
  grantedSettings,
  listedInput,
} from '../testing/recording-fakes.js';
import { everythingQueued } from '../testing/waiting.js';
import { setRetrospective } from '../state/recording-settings.js';
import { inputStatus } from './input-view.js';

const NEW_STACK: ArmedPurpose = { kind: 'new-stack' };
const WITH_LEASE = { purpose: NEW_STACK, holdsWriteLease: true } as const;

/** A shell whose recording part runs over fakes, with what was said. */
function shell() {
  const built = buildShellContext();
  const said: string[] = [];
  built.context.interaction.subscribe(() => {
    const text = built.context.interaction.get().announcement?.text;
    if (text !== undefined) said.push(text);
  });
  const { input } = built.context.recording;
  return { ...built, input, fakes: built.recording, said };
}

/** Arms the input of `built` and waits for it to open. */
async function armed(built: ReturnType<typeof shell>) {
  expectSuccess(built.input.arm(WITH_LEASE));
  await everythingQueued();
  const capture = built.fakes.captures.at(-1);
  const opened = built.fakes.media.opened.at(-1);
  if (capture === undefined || opened === undefined) throw new Error('No input opened.');
  return { capture, opened };
}

describe('the input before it is armed', () => {
  it('asks the browser nothing when the application starts', () => {
    // No input is opened, and nothing is buffered, unless the person arms (ADR-0070).
    const { fakes, input } = shell();
    expect(fakes.media.requests).toEqual([]);
    expect(fakes.media.listings).toBe(0);
    expect(fakes.media.watched()).toBe(false);
    expect(fakes.captures).toEqual([]);
    expect(input.view.get().session.kind).toBe('closed');
  });

  it('lists the inputs while watched, and opens none', async () => {
    const { fakes, input } = shell();
    const stop = input.watchDevices();
    await everythingQueued();
    expect(fakes.media.listings).toBe(1);
    expect(input.view.get().devices.map((one) => one.label)).toEqual(['Studio interface']);
    expect(fakes.media.requests).toEqual([]);
    stop();
    expect(fakes.media.watched()).toBe(false);
  });

  it('is ready, with no input open, once the permission is found held', async () => {
    const { fakes, input } = shell();
    fakes.media.permissionState = 'granted';
    const stop = input.watchDevices();
    await everythingQueued();
    expect(input.view.get().session.kind).toBe('ready');
    expect(fakes.media.requests).toEqual([]);
    stop();
  });
});

describe('arming the input', () => {
  it('asks for the microphone, and is armed once the browser opens the input', async () => {
    const built = shell();
    built.fakes.media.holdOpenings = true;
    expectSuccess(built.input.arm(WITH_LEASE));
    expect(built.input.view.get().session.kind).toBe('asking');
    expect(inputStatus(built.input.view.get(), undefined)).toBeUndefined();

    built.fakes.media.answer();
    await everythingQueued();
    const { session } = built.input.view.get();
    expect(session.kind === 'armed' && session.input.kind).toBe('open');
    expect(built.fakes.captures[0]?.arms).toEqual([0]);
    expect(built.fakes.captures[0]?.sources[0]?.layout.roles).toHaveLength(2);
    expect(inputStatus(built.input.view.get(), undefined)?.kind).toBe('armed');
  });

  it('never turns monitoring on by arming', async () => {
    const built = shell();
    const { capture } = await armed(built);
    expect(capture.monitors).toEqual([]);
    expect(built.context.recording.monitoring.view.get().monitoring.kind).toBe('off');
  });

  it('keeps the retrospective buffer the settings ask for, and shows it buffering', async () => {
    const built = shell();
    built.context.audioSettings.reviseRecording(
      setRetrospective(expectSuccess(retrospectiveOn(10))),
    );
    const { capture } = await armed(built);
    expect(capture.arms).toEqual([10]);
    capture.say({
      kind: FromCaptureKind.Report,
      contextFrame: 96_000,
      meter: undefined,
      bufferedFrames: 3 * 48_000,
      lostFrames: 0,
      absentFrames: 0,
    });
    expect(inputStatus(built.input.view.get(), undefined)).toMatchObject({
      kind: 'buffering',
      seconds: 3,
    });
  });

  it('tells a tab without the write lease why, before the browser is asked anything', () => {
    const built = shell();
    const refused = built.input.arm({ purpose: NEW_STACK, holdsWriteLease: false });
    expect(refused.ok ? undefined : refused.failures[0].code).toBe('recording.no-write-lease');
    expect(built.fakes.media.requests).toEqual([]);
    expect(built.input.view.get().session.kind).toBe('closed');
  });

  it('fails with the reason when the person refuses the microphone, and opens nothing', async () => {
    const built = shell();
    built.fakes.media.refusal = NOT_ALLOWED;
    expectSuccess(built.input.arm(WITH_LEASE));
    await everythingQueued();
    const { session } = built.input.view.get();
    expect(session.kind === 'failed' && session.failure.code).toBe('recording.permission-denied');
    expect(built.fakes.captures).toEqual([]);
    expect(built.said.at(-1)).toBe(NOT_ALLOWED.summary);
  });

  it('asks for the input the person chose, and the processing the profile asks for', async () => {
    const built = shell();
    built.fakes.media.devices = [
      listedInput('interface', 'Studio interface'),
      listedInput('usb', 'USB microphone'),
    ];
    const stop = built.input.watchDevices();
    await everythingQueued();
    expectSuccess(built.input.chooseDevice({ id: 'usb', label: 'USB microphone' }));
    await armed(built);
    expect(built.fakes.media.requests[0]).toMatchObject({
      deviceId: 'usb',
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      sampleRate: 48_000,
    });
    stop();
  });

  it('compares what the browser granted with what the profile asked for', async () => {
    const built = shell();
    built.fakes.media.granted = grantedSettings({ echoCancellation: true });
    await armed(built);
    const differences = built.input.view.get().opened?.comparison.differences ?? [];
    expect(differences.map((one) => one.kind === 'processing' && one.control)).toEqual([
      'echoCancellation',
    ]);
  });
});

describe('closing the input', () => {
  it('closes the input, its capture and the context it held on disarming', async () => {
    const built = shell();
    const { capture, opened } = await armed(built);
    expectSuccess(built.input.disarm());
    expect(opened.stopped).toBe(true);
    expect(capture.disposed).toBe(true);
    expect(built.input.view.get().session.kind).toBe('ready');
    expect(built.fakes.host.current()).toBeUndefined();
    expect(inputStatus(built.input.view.get(), undefined)).toBeUndefined();
  });

  it('closes the input and forgets the device when it is unplugged', async () => {
    const built = shell();
    const { opened } = await armed(built);
    opened.end();
    const { session } = built.input.view.get();
    expect(session.kind).toBe('ready');
    expect(session.kind === 'ready' && session.device).toBeUndefined();
    expect(opened.stopped).toBe(true);
    expect(built.said.at(-1)).toBe('The input was disconnected, so it closed.');
  });

  it('closes the input when its device leaves the list of inputs, and not while it is listed', async () => {
    const built = shell();
    const { opened } = await armed(built);
    built.fakes.media.setDevices([
      listedInput('interface', 'Studio interface'),
      listedInput('usb', 'USB microphone'),
    ]);
    expect(opened.stopped).toBe(false);
    built.fakes.media.setDevices([listedInput('usb', 'USB microphone')]);
    expect(opened.stopped).toBe(true);
    expect(built.said.at(-1)).toBe('The chosen input is no longer connected.');
  });

  it("keeps arming the browser's default input whatever the list of inputs says meanwhile", async () => {
    const built = shell();
    built.fakes.media.permissionState = 'granted';
    built.fakes.media.holdOpenings = true;
    const stop = built.input.watchDevices();
    await everythingQueued();
    expectSuccess(built.input.arm(WITH_LEASE));
    // The default is now the USB microphone, which the browser opens.
    built.fakes.media.setDevices([listedInput('usb', 'USB microphone')]);
    built.fakes.media.granted = grantedSettings({ deviceId: 'usb', groupId: 'usb-group' });
    expect(built.input.view.get().session.kind).toBe('armed');
    built.fakes.media.answer();
    await everythingQueued();
    const { session } = built.input.view.get();
    expect(session.kind === 'armed' && session.input.kind).toBe('open');
    stop();
  });

  it('closes the input when the permission is taken back', async () => {
    const built = shell();
    const { opened } = await armed(built);
    built.fakes.media.setPermission('denied');
    const { session } = built.input.view.get();
    expect(session.kind === 'failed' && session.failure.code).toBe('recording.permission-revoked');
    expect(opened.stopped).toBe(true);
  });

  it('closes the input, saying why, when playback makes the context again', async () => {
    const built = shell();
    const { opened } = await armed(built);
    built.fakes.host.own('playback', 96_000);
    expect(opened.stopped).toBe(true);
    expect(built.input.view.get().session.kind).toBe('ready');
    expect(built.said.at(-1)).toContain('playback needed the audio context made again');
  });

  it('gives up an opening the person disarmed before the browser answered', async () => {
    const built = shell();
    built.fakes.media.holdOpenings = true;
    built.fakes.media.permissionState = 'granted';
    const stop = built.input.watchDevices();
    await everythingQueued();
    expectSuccess(built.input.arm(WITH_LEASE));
    expectSuccess(built.input.disarm());
    built.fakes.media.answer();
    await everythingQueued();
    expect(built.fakes.media.opened[0]?.stopped).toBe(true);
    expect(built.input.view.get().session.kind).toBe('ready');
    stop();
  });
});

describe('recording from the input', () => {
  it('records onto a capture channel from a context frame, and stays armed once finished', async () => {
    const built = shell();
    const { capture } = await armed(built);
    const at = derivedSampleCount(96_000);
    expectSuccess(built.input.takes.record(at, true));
    expect(capture.records).toEqual([96_000]);
    expect(built.input.view.get().session.kind).toBe('recording');
    expectSuccess(built.input.takes.stop(derivedSampleCount(144_000), 'person'));
    expect(capture.stops).toEqual([144_000]);
    expect(built.input.view.get().session.kind).toBe('stopping');
    expectSuccess(built.input.stopped());
    expect(built.input.view.get().session.kind).toBe('armed');
  });

  it('stops a recording the browser silenced, keeping what it has', async () => {
    const built = shell();
    const { capture, opened } = await armed(built);
    expectSuccess(built.input.takes.record(derivedSampleCount(96_000), true));
    opened.mute(true);
    const { session } = built.input.view.get();
    expect(session.kind === 'stopping' && session.reason.kind).toBe('background-suspended');
    expect(capture.stops).toHaveLength(1);
  });

  it('stops a recording when the page goes into the background where capture may be suspended', async () => {
    const { context } = buildShellContext();
    const { parts, fakes } = fakeRecording({
      settings: context.audioSettings,
      playback: context.playback,
      audio: context.audio,
      workspace: context.workspace,
      announce: () => undefined,
      logger: createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('recording'),
      suspensionRisk: true,
    });
    expectSuccess(parts.input.arm(WITH_LEASE));
    await everythingQueued();
    expectSuccess(parts.input.takes.record(derivedSampleCount(96_000), true));
    fakes.page.set('hidden');
    const { session } = parts.input.view.get();
    expect(session.kind === 'stopping' && session.reason.kind).toBe('background-suspended');
  });

  it('keeps recording in the background where the platform does not suspend capture', async () => {
    const built = shell();
    await armed(built);
    expectSuccess(built.input.takes.record(derivedSampleCount(96_000), true));
    built.fakes.page.set('hidden');
    expect(built.input.view.get().session.kind).toBe('recording');
  });

  it('refuses to record into a project another tab holds', async () => {
    const built = shell();
    await armed(built);
    const refused = built.input.takes.record(derivedSampleCount(96_000), false);
    expect(refused.ok ? undefined : refused.failures[0].code).toBe('recording.no-write-lease');
  });
});
