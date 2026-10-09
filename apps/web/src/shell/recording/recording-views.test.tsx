import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { commandId, type CommandInvocation } from '@audiogubbins/commands';
import { FromCaptureKind } from '@audiogubbins/audio-runtime';
import { derivedSampleCount, sampleRate } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { UNKNOWN_OUTPUT, manualCalibration, retrospectiveOn } from '@audiogubbins/recording';

import type { ShellContext } from '../../commands/shell-context.js';
import { busOfShellCommands, reasonsIn } from '../../testing/command-availability.js';
import { grantedSettings } from '../../testing/recording-fakes.js';
import { buildShellContext } from '../../testing/shell-context.js';
import { everythingQueued } from '../../testing/waiting.js';
import {
  keepCalibration,
  markHeadphones,
  rememberInput,
  setRetrospective,
} from '../../state/recording-settings.js';
import { InspectorPanel } from '../inspector/inspector-panel.js';
import { InputStatus } from './input-status.js';
import { RecordingPanel } from './recording-panel.js';

/** Arms the input of `context` and waits for it to open. */
async function arm(context: ShellContext): Promise<void> {
  expectSuccess(
    context.recording.input.arm({ purpose: { kind: 'new-stack' }, holdsWriteLease: () => true }),
  );
  await act(async () => {
    await everythingQueued();
  });
}

/** How a view runs the shell's commands over `context`, and every command it ran. */
function commandsOver(context: ShellContext) {
  const bus = busOfShellCommands();
  const ran: string[] = [];
  return {
    ran,
    run: (id: string, args?: CommandInvocation['arguments']) => {
      ran.push(id);
      bus.execute(context, {
        commandId: commandId(id),
        ...(args === undefined ? {} : { arguments: args }),
      });
    },
    unavailableReason: reasonsIn(context),
  };
}

describe("the status bar's input state", () => {
  function statusOver() {
    const built = buildShellContext();
    const said: string[] = [];
    render(
      <InputStatus recording={built.context.recording} announce={(text) => said.push(text)} />,
    );
    return { ...built, said };
  }

  it('shows nothing while no input is armed or open', async () => {
    const { context } = statusOver();
    const stop = context.recording.watch();
    await act(async () => {
      await everythingQueued();
    });
    expect(screen.queryByRole('group', { name: 'Input' })).toBeNull();
    stop();
  });

  it('shows and says the device, armed, and monitoring as distinct states', async () => {
    const { context, said } = statusOver();
    await arm(context);
    const input = screen.getByRole('group', { name: 'Input' });
    expect(within(input).getByText('Studio interface: armed')).toBeInTheDocument();
    expect(within(input).getByText('Not monitoring')).toBeInTheDocument();
    expect(said).toEqual(['Studio interface: armed. Monitoring is off.']);

    context.audioSettings.reviseRecording(markHeadphones('Raw/Studio', true));
    act(() => {
      expectSuccess(context.recording.monitoring.toggle());
    });
    expect(within(input).getByText('Monitoring')).toBeInTheDocument();
    expect(said.at(-1)).toMatch(/^Studio interface: armed\. Monitoring is on/u);
  });

  it('shows the seconds buffered as they grow, and says buffering once, not each second', async () => {
    const { context, said, recording } = statusOver();
    context.audioSettings.reviseRecording(setRetrospective(expectSuccess(retrospectiveOn(10))));
    await arm(context);
    for (const seconds of [1, 2, 3]) {
      act(() => {
        recording.captures[0]?.say({
          kind: FromCaptureKind.Report,
          contextFrame: seconds * 48_000,
          meter: undefined,
          bufferedFrames: seconds * 48_000,
          lostFrames: 0,
          absentFrames: 0,
        });
      });
    }
    expect(screen.getByText('Studio interface: armed, buffering 3 s')).toBeInTheDocument();
    expect(said).toEqual(['Studio interface: armed, buffering 0 s. Monitoring is off.']);
  });

  it('shows recording apart from armed, and nothing once the input closes', async () => {
    const { context, said } = statusOver();
    await arm(context);
    act(() => {
      expectSuccess(context.recording.input.takes.record(derivedSampleCount(48_000), true));
    });
    expect(screen.getByText('Studio interface: recording')).toBeInTheDocument();
    act(() => {
      expectSuccess(context.recording.input.takes.stop(derivedSampleCount(96_000), 'person'));
      expectSuccess(context.recording.input.stopped());
      expectSuccess(context.recording.input.disarm());
    });
    expect(screen.queryByRole('group', { name: 'Input' })).toBeNull();
    expect(said.at(-1)).toBe('The input is closed.');
  });
});

describe('the Recording panel', () => {
  function panelOver(context: ShellContext) {
    const commands = commandsOver(context);
    render(
      <RecordingPanel
        title="Recording"
        parts={{
          recording: context.recording,
          audioSettings: context.audioSettings,
          projects: undefined,
        }}
        commands={commands}
      />,
    );
    return commands;
  }

  it('lists the inputs when it opens, and opens none', async () => {
    const { context, recording } = buildShellContext();
    panelOver(context);
    await act(async () => {
      await everythingQueued();
    });
    expect(recording.media.listings).toBeGreaterThan(0);
    expect(recording.media.requests).toEqual([]);
    expect(recording.captures).toEqual([]);
    expect(
      screen.getByText('The input is closed: nothing is captured or kept.'),
    ).toBeInTheDocument();
  });

  it('arms only by its command, and shows what the browser granted against what was asked', async () => {
    const { context, recording } = buildShellContext();
    recording.media.granted = grantedSettings({ autoGainControl: true });
    const commands = panelOver(context);
    // No project is open, so its Arm says why rather than arming.
    await userEvent.click(screen.getByRole('button', { name: 'Arm' }));
    expect(commands.ran).toEqual([]);
    expect(screen.getByRole('button', { name: 'Arm' })).toHaveAttribute('aria-disabled', 'true');

    await arm(context);
    expect(
      screen.getByText('The input is armed. Nothing is recorded until you record.'),
    ).toBeInTheDocument();
    const summary = screen.getByText('The browser granted 2 things other than asked');
    await userEvent.click(summary);
    const disclosure = summary.closest('details');
    if (disclosure === null) throw new Error('The grant is not disclosed.');
    expect(
      within(disclosure).getByText(
        /^Automatic gain control is on although it was asked to be off/u,
      ),
    ).toBeInTheDocument();
  });

  it('shows monitoring apart from the input, off until its own control turns it on', async () => {
    const { context } = buildShellContext();
    const commands = panelOver(context);
    await arm(context);
    expect(screen.getByText('Monitoring is off.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Turn monitoring on' }));
    expect(commands.ran).toEqual(['recording.toggle-monitoring']);
    expect(screen.getByRole('button', { name: 'Monitor anyway' })).toBeInTheDocument();
  });

  it("offers the input's own rate where the browser resamples it, and restarts only when asked", async () => {
    const { context, recording } = buildShellContext();
    recording.media.granted = grantedSettings({ sampleRate: 44_100 });
    const commands = panelOver(context);
    await arm(context);
    const restart = screen.getByRole('button', {
      name: 'Restart the audio engine at 44,100 Hz',
    });
    // Offered, never taken unasked.
    expect(recording.contexts).toHaveLength(1);
    expect(recording.contexts[0]?.closes).toBe(0);

    await userEvent.click(restart);
    await act(async () => {
      await everythingQueued();
    });
    expect(commands.ran).toEqual(['recording.restart-at-input-rate']);
    const { session, problem } = context.recording.input.view.get();
    expect(session.kind).toBe('ready');
    expect(problem).toBe(
      'The audio engine was restarted at 44,100 Hz, so the input closed. Arm it again to record at that rate.',
    );
    expect(recording.contexts[0]?.closes).toBe(1);

    await arm(context);
    expect(recording.contexts[1]?.sampleRate).toBe(44_100);
    expect(screen.queryByRole('button', { name: /^Restart the audio engine/u })).toBeNull();
  });

  it('names a changed sample rate as such where a calibration no longer applies', async () => {
    const { context } = buildShellContext();
    const elsewhere = expectSuccess(
      manualCalibration(
        {
          input: { id: 'interface', group: 'interface-group', label: 'Studio interface' },
          output: UNKNOWN_OUTPUT,
          rate: expectSuccess(sampleRate(44_100)),
        },
        12,
      ),
    );
    context.audioSettings.reviseRecording(keepCalibration(elsewhere));
    panelOver(context);
    await arm(context);
    expect(
      screen.getByText(
        'The calibration was taken with another sample rate. Calibrate again for this path.',
      ),
    ).toBeInTheDocument();
  });

  it('says at once when the chosen input is no longer connected (REQ-REC-094)', async () => {
    const { context, recording } = buildShellContext();
    recording.media.permissionState = 'granted';
    context.audioSettings.reviseRecording(rememberInput({ id: 'desk', label: 'Desk microphone' }));
    panelOver(context);
    await act(async () => {
      await everythingQueued();
    });
    expect(
      screen.getByText('The input chosen for recording is no longer connected.'),
    ).toBeInTheDocument();
    // No context has reported yet, so the rest is still to come.
    expect(
      screen.getByText(/checked once an input is armed or something plays/u),
    ).toBeInTheDocument();
  });

  it('lists the recording diagnostics once the context has reported its latency', async () => {
    const { context } = buildShellContext();
    panelOver(context);
    expect(
      screen.getByText(/checked once an input is armed or something plays/u),
    ).toBeInTheDocument();
    await arm(context);
    expect(
      screen.getByText('This input, output and sample rate have not been calibrated.'),
    ).toBeInTheDocument();
  });
});

describe("the Inspector's recording configuration", () => {
  it('shows how the input is set up once recording is the subject, as arming makes it', async () => {
    const { context } = buildShellContext();
    render(
      <InspectorPanel
        title="Inspector"
        projects={undefined}
        parts={{
          editorViews: context.editorViews,
          selections: context.selections,
          assets: context.assets,
          labelFor: (id) => id,
          recording: context.recording,
          audioSettings: context.audioSettings,
        }}
        commands={commandsOver(context)}
      />,
    );
    expect(
      screen.getByText('Open audio in an editor to see its properties here.'),
    ).toBeInTheDocument();
    await arm(context);
    expect(screen.getByText('Raw/Studio, built in, for fidelity')).toBeInTheDocument();
    expect(screen.getByText('Studio interface')).toBeInTheDocument();
    expect(screen.getByText(/^Echo cancellation off; Noise suppression off/u)).toBeInTheDocument();
  });
});
