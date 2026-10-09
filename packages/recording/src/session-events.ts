/**
 * What happens to a recording session: the events its transitions take
 * (`session-transition.ts`), each a fact the application states once it has
 * done the work, with the facts the rules need carried on the event.
 */

import type { DomainFailure, SampleCount, SampleRate } from '@audiogubbins/domain';

import type { GrantedCapture } from './capture-comparison.js';
import type { CaptureProfile } from './capture-profile.js';
import type { DeviceIdentity } from './device-identity.js';
import type { RetrospectiveSetting } from './retrospective-buffer.js';
import type { ArmedPurpose, SessionSetup, StopReason } from './session-state.js';

/**
 * What happens to a session.
 *
 * - `permission-asked`: the browser's prompt is shown.
 * - `permission-granted`: the permission is held, found so or just given, with
 *   the person's remembered input, profile and buffer setting.
 * - `permission-denied`, `permission-revoked`: the person refused it, or took
 *   it back.
 * - `device-chosen`, `profile-chosen`, `retrospective-set`: the person changed
 *   the setup; an armed input opens again with it.
 * - `arm`: the person armed the input for `purpose`.
 * - `retarget`: an armed input is given another purpose.
 * - `device-opened`: the browser opened the armed input.
 * - `device-lost`: the chosen input disappeared, or its track ended.
 * - `disarm`: the person closed the input.
 * - `count-in-started`: a count-in began, to end at the clock frame `recordAt`.
 * - `count-in-elapsed`: it ended; `held` frames were buffered.
 * - `record`: Record at clock frame `at`, with `held` frames buffered.
 * - `stop`: the person, the timed end, the page's suspension or a write refused
 *   for quota ended the recording.
 * - `failed`: something failed that recording cannot go on through.
 * - `stopped`: what was captured is finished.
 * - `close`: the person closed recording.
 */
export type SessionEvent =
  | { readonly kind: 'permission-asked' }
  | { readonly kind: 'permission-granted'; readonly setup: SessionSetup }
  | { readonly kind: 'permission-denied' }
  | { readonly kind: 'permission-revoked' }
  | { readonly kind: 'device-chosen'; readonly device: DeviceIdentity }
  | { readonly kind: 'profile-chosen'; readonly profile: CaptureProfile }
  | { readonly kind: 'retrospective-set'; readonly setting: RetrospectiveSetting }
  | { readonly kind: 'arm'; readonly purpose: ArmedPurpose; readonly holdsWriteLease: boolean }
  | { readonly kind: 'retarget'; readonly purpose: ArmedPurpose }
  | {
      readonly kind: 'device-opened';
      readonly granted: GrantedCapture;
      readonly rate: SampleRate;
      readonly channels: number;
    }
  | { readonly kind: 'device-lost' }
  | { readonly kind: 'disarm' }
  | {
      readonly kind: 'count-in-started';
      readonly recordAt: SampleCount;
      readonly holdsWriteLease: boolean;
    }
  | { readonly kind: 'count-in-elapsed'; readonly held: SampleCount }
  | {
      readonly kind: 'record';
      readonly at: SampleCount;
      readonly held: SampleCount;
      readonly holdsWriteLease: boolean;
    }
  | {
      readonly kind: 'stop';
      readonly reason: Extract<
        StopReason['kind'],
        'person' | 'timed' | 'background-suspended' | 'quota'
      >;
    }
  | { readonly kind: 'failed'; readonly failure: DomainFailure }
  | { readonly kind: 'stopped' }
  | { readonly kind: 'close' };
