/**
 * Running a command from the interface, and saying why when it refuses.
 *
 * A command returns its refusal rather than saying it (see `report`), so the
 * refusal has to be said by whoever ran the command. Every interface route to
 * the bus, the shell and the shortcut listener among them, goes through this,
 * so the rule is written once: a caller with a copy of its own could read only
 * the first of a refusal's failures and lose the rest, and a caller that ran
 * the bus directly would be silent when a command refuses.
 */

import {
  UNAVAILABLE_FAILURE_CODE,
  type CommandBus,
  type CommandInvocation,
  type ExecutionResult,
} from '@audiogubbins/commands';
import { cutAtAWord } from '@audiogubbins/text';

import type { AnnouncementOptions } from '../state/interaction-store.js';

/** Says a sentence: urgently or politely, and how it is shown. */
export type Announce = (text: string, urgent: boolean, options?: AnnouncementOptions) => void;

/** How a command run from the interface is spoken of. */
export interface VoicedOptions {
  /**
   * Whether a command that found nothing to do says so, politely.
   *
   * Asked for by a control the user commits with, a Save or a Rename, which
   * shows nothing if the command does nothing: without it, recording a
   * command's own shortcut and saving it would close the recorder in silence.
   * Not by a slider, a list or the dock, which show the value already, where a
   * sentence after each drag or click that changed nothing would be noise.
   */
  readonly sayWhenUnchanged?: boolean;
}

/**
 * Runs a command, and announces every reason it gives when it refuses, and
 * what it found when it found nothing to do and was asked to say so. The bus
 * records every outcome in the log.
 */
export function executeVoiced<TContext>(
  bus: CommandBus<TContext>,
  context: TContext,
  invocation: CommandInvocation,
  announce: Announce,
  options: VoicedOptions = {},
): ExecutionResult<TContext> {
  const result = bus.execute(context, invocation);

  if (result.kind === 'unchanged' && options.sayWhenUnchanged === true) {
    announce(result.reason, false);
  }

  // Urgent when the user asked for something and it failed, and a shortcut that
  // seems to do nothing is how a user decides the application is unreliable.
  // Polite when the only reason is that the command is unavailable, because
  // what it would bring about holds already or cannot hold yet: said urgently,
  // a chord pressed on a workspace with nothing to reset would interrupt
  // whatever a screen reader is saying to tell the user so.
  if (result.kind === 'refused') {
    const urgent = result.failures.some((one) => one.code !== UNAVAILABLE_FAILURE_CODE);
    announce(summarise(result.failures), urgent, { refusal: true });
  }

  return result;
}

/**
 * How many reasons a refusal says before it says how many more there are.
 *
 * A refusal is spoken into a live region and shown as a notice. An imported
 * profile reports every malformed binding at once rather than the first, which
 * is right for the reader of a file and wrong for a sentence: unbounded, a file
 * of two hundred thousand bad entries would be two hundred thousand sentences
 * in one announcement, with no way to interrupt it.
 */
const REASONS_SAID = 3;

/**
 * The longest one reason is said at.
 *
 * Long enough for every refusal AudioGubbins writes, which are one sentence
 * each, and short enough that a reason quoting a value from a file cannot
 * become a sentence nobody can interrupt. Counting the reasons bounds how many
 * are said and not how long one is: unbounded, an imported profile's version
 * field of a quarter of a megabyte would be interpolated whole into the first.
 */
const LONGEST_REASON = 200;

/** What a refusal says: its reasons, or the first few and how many more there are. */
function summarise(failures: readonly { readonly summary: string }[]): string {
  const said = failures
    .slice(0, REASONS_SAID)
    .map((one) => cutAtAWord(one.summary, LONGEST_REASON));
  const more = failures.length - said.length;
  return more > 0
    ? `${said.join(' ')} There ${more === 1 ? 'is 1 more reason' : `are ${String(more)} more reasons`}.`
    : said.join(' ');
}
