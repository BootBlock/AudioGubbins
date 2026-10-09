/**
 * How far the take being made has come (`REQ-REC-096`, `REQ-UX-005`), as the
 * status bar and the Recording panel show it: waiting for a set start or a
 * count-in, playing a punch's pre-roll, recording with what storage has kept
 * and the time it leaves, or finishing.
 */

import type { StorageTimeLeft } from '@audiogubbins/recording';
import type { LostFrames } from '@audiogubbins/storage';

/** How far the take being made has come, for the status bar and the Recording panel. */
export type TakeProgress =
  | { readonly kind: 'idle' }
  /** A controlled recording waits for its start, or its count-in. */
  | { readonly kind: 'scheduled'; readonly caution: string | undefined }
  /** A punch's audio is starting, to play its pre-roll. */
  | { readonly kind: 'pre-roll'; readonly take: string }
  | {
      readonly kind: 'recording';
      readonly take: string;
      /** The frames committed to storage, which a crash keeps. */
      readonly committed: number;
      readonly lost: LostFrames;
      readonly timeLeft: StorageTimeLeft | undefined;
      readonly rate: number;
    }
  | { readonly kind: 'finishing'; readonly take: string };

/** No take is being made. */
export const IDLE = { kind: 'idle' } as const satisfies TakeProgress;
