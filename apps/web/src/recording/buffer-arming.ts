/**
 * The retrospective buffer an open input is armed with (`REQ-REC-090`,
 * `ADR-0070`): as much of the session's setting as the memory the page has
 * left allows, at the rate and channels the input was opened with, and the
 * person told where it is kept shorter or not at all. The setting stays the
 * person's; only what the capture keeps is cut to fit.
 */

import type { ResourceFigures } from '@audiogubbins/capabilities';
import { succeed, type DomainResult } from '@audiogubbins/domain';
import {
  retrospectiveFit,
  type RetrospectiveFit,
  type RetrospectiveSetting,
} from '@audiogubbins/recording';

import type { OpenedCapture } from './input-opener.js';
import type { OpenedFacts } from './input-view.js';
import { bufferShortfallText } from './recording-words.js';

/** What arming reads the memory left from, and says a shortfall through. */
export interface BufferArming {
  /** What the machine has left, read afresh at each arming. */
  readonly resources: () => ResourceFigures;
  readonly announce: (text: string) => void;
}

/** The buffer the capture keeps under `setting`, or none where the setting is off. */
function armedBuffer(
  setting: RetrospectiveSetting,
  opened: Pick<OpenedFacts, 'rate' | 'channels'>,
  resources: ResourceFigures,
): RetrospectiveFit | undefined {
  return setting.on
    ? retrospectiveFit(
        setting.seconds,
        opened.rate,
        opened.channels,
        resources.availableMemoryBytes,
      )
    : undefined;
}

/**
 * Arms the capture of `opened` with as much of `setting` as the memory left
 * has room for, says why where that is less than the setting, and answers
 * what the capture keeps, or why it refused.
 */
export function armBuffer(
  opened: Pick<OpenedCapture, 'capture' | 'facts'>,
  setting: RetrospectiveSetting,
  arming: BufferArming,
): DomainResult<RetrospectiveFit | undefined> {
  const buffer = armedBuffer(setting, opened.facts, arming.resources());
  const armed = opened.capture.arm(
    buffer === undefined || buffer.kind === 'none' ? 0 : buffer.seconds,
  );
  if (!armed.ok) return armed;
  const shortfall = bufferShortfallText(buffer);
  if (shortfall !== undefined) arming.announce(shortfall);
  return succeed(buffer);
}
