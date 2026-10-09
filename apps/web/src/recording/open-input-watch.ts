/**
 * What an open input says while it is open, read into what the input control
 * acts on (`ADR-0070`, `REQ-REC-097`): its track ending or the browser
 * silencing it, the page going into the background, the capture processor's
 * reports, faults and replies, the context going away or reporting another
 * device, and the levels after a passage, in words.
 *
 * It decides nothing about the session: it says what happened, and the input
 * control moves the session for it.
 */

import { FailureKind, failure, type DomainFailure } from '@audiogubbins/domain';
import type { Logger } from '@audiogubbins/diagnostics';
import {
  FromCaptureKind,
  LifecycleEventKind,
  type CaptureSessionEvent,
  type DeviceReport,
  type FromCapture,
} from '@audiogubbins/audio-runtime';
import type { PageVisibility } from '@audiogubbins/capabilities';

import type { OpenedCapture } from './input-opener.js';
import { LevelSummary } from './level-summary.js';

/** Whether the page can be seen, and its changes, read from the page's document. */
export interface PageWatch {
  readonly visibility: () => PageVisibility | undefined;
  readonly watch: (changed: (visibility: PageVisibility) => void) => () => void;
}

/** What an open input's watch tells the input control. */
export interface OpenInputHearing {
  /** Every event of the capture session, for the control's own listeners. */
  readonly event: (event: CaptureSessionEvent) => void;
  /** The device went: unplugged, or its track ended. */
  readonly deviceLost: () => void;
  /** Capture failed, or its context went, for the reason given. */
  readonly failed: (failure: DomainFailure, problem: string) => void;
  /** The browser may have suspended capture, for the reason given. */
  readonly suspended: (why: string) => void;
  readonly muted: (muted: boolean) => void;
  /** Whole seconds the retrospective buffer holds now. */
  readonly buffered: (seconds: number) => void;
  /** A reply about monitoring, for the monitoring control. */
  readonly monitoring: (reply: FromCapture) => void;
  readonly context: (report: DeviceReport) => void;
  /** Something to say: the levels after a passage. */
  readonly say: (text: string) => void;
}

/** Watching an open input, and its levels. */
export interface OpenInputWatch {
  readonly levels: LevelSummary;
  readonly stop: () => void;
}

const SILENCED = 'The browser silenced the input, so the recording stopped and keeps what it has.';
const BACKGROUND =
  'The page went into the background, where this browser may pause capture, so the recording stopped and keeps what it has.';

/** Hears what the capture processor says of `opened`. */
function captureHearing(
  opened: OpenedCapture,
  levels: LevelSummary,
  hearing: OpenInputHearing,
  logger: Logger,
): (event: CaptureSessionEvent) => void {
  const { rate } = opened.facts;
  return (event) => {
    hearing.event(event);
    switch (event.kind) {
      case FromCaptureKind.Report: {
        hearing.buffered(Math.floor(event.bufferedFrames / rate));
        const said =
          event.meter === undefined
            ? undefined
            : levels.heard(event.meter, event.contextFrame, rate);
        if (said !== undefined) hearing.say(said);
        return;
      }
      case FromCaptureKind.Monitoring:
      case FromCaptureKind.ChainRefused:
        hearing.monitoring(event);
        return;
      case FromCaptureKind.Fault:
        hearing.failed(
          failure('recording.capture-fault', FailureKind.Unrecoverable, event.message),
          `The audio thread stopped capturing: ${event.message}`,
        );
        return;
      case FromCaptureKind.Refused:
        logger.warning('The capture processor refused a command.', {
          event: event.command,
          reason: event.reason,
        });
        return;
      case 'lost':
        hearing.failed(
          failure('recording.context-lost', FailureKind.Retryable, event.problem),
          event.problem,
        );
        return;
      default:
        return;
    }
  };
}

/**
 * Watches `opened` until the answer's `stop` is called. The page's going into
 * the background is a suspension only where `suspensionRisk` says the
 * platform suspends capture there.
 */
export function watchOpenInput(
  opened: OpenedCapture,
  page: PageWatch,
  suspensionRisk: boolean,
  hearing: OpenInputHearing,
  logger: Logger,
): OpenInputWatch {
  const levels = new LevelSummary();
  const stops = [
    opened.capture.subscribe(captureHearing(opened, levels, hearing, logger)),
    opened.input.watchEnded(hearing.deviceLost),
    opened.input.watchMuted((muted) => {
      hearing.muted(muted);
      // A muted track is a browser giving silence, as a lock screen makes it.
      if (muted) hearing.suspended(SILENCED);
    }),
    page.watch((visibility) => {
      if (visibility === 'hidden' && suspensionRisk) hearing.suspended(BACKGROUND);
    }),
    opened.lifecycle.subscribe((event) => {
      if (event.kind === LifecycleEventKind.DeviceChanged) hearing.context(event.report);
    }),
  ];
  return {
    levels,
    stop: () => {
      for (const stop of stops) stop();
    },
  };
}
