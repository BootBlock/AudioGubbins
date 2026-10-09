import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { derivedSampleCount, unsafeBrandId } from '@audiogubbins/domain';
import { RecordingEnding } from '@audiogubbins/project-format';
import type { InterruptedRecording } from '@audiogubbins/storage';

import { RECOVER_INTERRUPTED } from '../commands/interrupted-recording-commands.js';
import { observable } from '../state/observable.js';
import { InterruptedRecordingsOffer } from './interrupted-recordings-offer.js';

/**
 * A recording a reload cut short, whose take was named and placed as no
 * recovery would name and place it afresh: the third take of its stack, placed
 * later than recorded.
 */
const INTERRUPTED: InterruptedRecording = {
  session: unsafeBrandId<'RecordingSessionId'>('5e5510a0-0000-4000-8000-000000000001'),
  frames: derivedSampleCount(96_000),
  recordedAt: 1_790_000_000_000,
  sampleRate: 48_000,
  channels: 2,
  device: { label: 'USB Audio Interface (2-ch)', channelCount: 2 },
  purpose: {
    kind: 'take',
    stack: unsafeBrandId<'TakeStackId'>('57ac0000-0000-4000-8000-0000000000aa'),
  },
  take: { name: 'Take 3', compensation: -1_200 },
  ending: RecordingEnding.Interrupted,
  missing: 0,
};

describe('the offer of a recording cut short', () => {
  it('names the take it becomes and says how that take is placed, and recovers it as such', async () => {
    const run = vi.fn((_id: string, _args?: unknown) => true);
    const offers = observable({
      recordings: [INTERRUPTED],
      confirming: undefined,
      busy: new Set<InterruptedRecording['session']>(),
    });
    render(<InterruptedRecordingsOffer offers={offers} run={run} />);

    const offer = screen.getByRole('group', { name: 'Recordings cut short' });
    const item = within(offer).getByRole('listitem');
    expect(item).toHaveTextContent(/^“Take 3”, the recording of 2\.0 s started /u);
    expect(item).toHaveTextContent('placed 25.0 ms later (1,200 frames).');
    await userEvent.click(within(item).getByRole('button', { name: 'Recover' }));
    expect(run).toHaveBeenCalledWith(RECOVER_INTERRUPTED, { session: INTERRUPTED.session });
  });
});
