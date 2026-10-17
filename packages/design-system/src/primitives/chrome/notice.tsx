/**
 * The notice: one card of frosted glass that tells the reader something
 * happened (design language, section 10, "Notices, tooltips and hints").
 *
 * This is how a notice looks and leaves, not when one is raised: the
 * announcement's channel (`announcement.tsx`) decides which sentence is shown
 * and for how long, and draws it with this.
 */

import type { CSSProperties, ReactNode, Ref } from 'react';

import { Icon } from '../../icons/icon.js';
import type { IconName } from '../../icons/vocabulary.js';
import { Button, ButtonTone } from '../button.js';

/** What a notice is about, which sets its glyph's colour and its edge bar. */
export const NoticeTone = {
  /** Something the reader may like to know: the accent's glyph, no bar. */
  Information: 'information',

  Success: 'success',

  /** A refusal, or something that still works but needs a look. */
  Warning: 'warning',

  /** Something went wrong, or the notice is urgent. */
  Error: 'error',
} as const;

/** What a notice is about. */
export type NoticeTone = (typeof NoticeTone)[keyof typeof NoticeTone];

/** The glyph each tone takes where its caller names none. */
const TONE_GLYPH: Readonly<Record<NoticeTone, IconName>> = {
  information: 'information',
  success: 'success',
  warning: 'warning',
  error: 'error',
};

/** What a notice takes. */
export interface NoticeProps {
  readonly tone: NoticeTone;

  /**
   * Whether it interrupts: drawn with the edge bar along its leading side
   * whatever its tone, as an error and a warning are.
   */
  readonly urgent?: boolean;

  /** What happened, a sentence, drawn at 600. */
  readonly title: string;

  /** A second sentence under the title, at label size. */
  readonly text?: string;

  /** The glyph at its leading edge. Defaults to the tone's own. */
  readonly icon?: IconName;

  /** Buttons for what the reader can do about it, under the text. */
  readonly actions?: ReactNode;

  /**
   * Takes the notice away now. Shown as a close button when given, named by
   * `dismissLabel`.
   */
  readonly onDismiss?: () => void;

  /** The close button's accessible name. */
  readonly dismissLabel?: string;

  /**
   * How long the notice stays, in milliseconds, which its time bar runs down
   * over. No time bar without it.
   */
  readonly durationMs?: number;

  /**
   * Whether it is leaving: drawn sliding out, for as long as its leaving
   * animation runs before its owner takes it away.
   */
  readonly leaving?: boolean;

  /**
   * Hides the card from assistive technology, where a live region already says
   * the same sentence. Its close button then takes no keyboard focus, since a
   * focusable control may not sit inside a hidden subtree; the notice leaves on
   * its own time, and the reader loses nothing.
   */
  readonly hidden?: boolean;

  /**
   * The card's element, for an owner that waits for its leaving animation.
   */
  readonly ref?: Ref<HTMLDivElement>;
}

/** The time bar's custom properties, read by the stylesheet. */
interface TimeBarStyle extends CSSProperties {
  readonly '--ag-notice-duration': string;
  readonly '--ag-notice-seconds': string;
}

/** A notice: frosted glass, a glyph, what happened, and a time bar. */
export function Notice({
  tone,
  urgent = false,
  title,
  text,
  icon,
  actions,
  onDismiss,
  dismissLabel = 'Dismiss',
  durationMs,
  leaving = false,
  hidden = false,
  ref,
}: NoticeProps): ReactNode {
  const timeBar: TimeBarStyle | undefined =
    durationMs === undefined
      ? undefined
      : {
          '--ag-notice-duration': `${String(durationMs)}ms`,
          // At the Minimal motion level the bar steps once a second rather
          // than running down, so it is told how many seconds it has.
          '--ag-notice-seconds': String(Math.max(1, Math.ceil(durationMs / 1_000))),
        };

  return (
    <div
      ref={ref}
      className="ag-notice"
      data-ag-tone={tone}
      data-ag-notice={urgent ? 'urgent' : 'ordinary'}
      data-state={leaving ? 'closed' : 'open'}
      aria-hidden={hidden ? true : undefined}
    >
      <Icon name={icon ?? TONE_GLYPH[tone]} className="ag-notice-glyph" />
      <div className="ag-notice-body">
        <span className="ag-notice-title">{title}</span>
        {text !== undefined && <span className="ag-notice-text">{text}</span>}
        {actions !== undefined && <div className="ag-notice-actions">{actions}</div>}
      </div>
      {onDismiss !== undefined && (
        <span className="ag-notice-close">
          <Button
            tone={ButtonTone.Quiet}
            iconOnly
            compact
            label={dismissLabel}
            tabIndex={hidden ? -1 : undefined}
            onClick={onDismiss}
          >
            <Icon name="close" />
          </Button>
        </span>
      )}
      <span className="ag-notice-edges">
        {timeBar !== undefined && <span className="ag-notice-time" style={timeBar} />}
      </span>
    </div>
  );
}
