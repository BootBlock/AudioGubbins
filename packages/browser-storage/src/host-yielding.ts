/**
 * Giving the page a turn during long work, such as fingerprinting a large file
 * in the background (REQ-STOR-104), so the interface stays responsive.
 *
 * The scheduler's own yield where the browser has it, which lets waiting input
 * run first and then resumes the work ahead of other tasks. Otherwise a message
 * the page posts to itself, which is taken after the events already queued: one
 * channel, made once and kept (G5), with each waiting turn resumed in order.
 * Where the browser has neither, the capabilities package says so and each turn
 * is given back at once.
 */

import type { YieldToHost } from '@audiogubbins/media-store';

/** How the page is given a turn, as the capabilities package reads it. */
export type HostYieldingMethod =
  | { readonly kind: 'scheduler'; readonly yieldNow: () => Promise<void> }
  | { readonly kind: 'macrotask'; readonly createChannel: () => MessageChannel }
  | { readonly kind: 'none' };

/** Turns taken through one channel, each resumed when its own message arrives. */
function macrotaskTurns(channel: MessageChannel): YieldToHost {
  const waiting: (() => void)[] = [];
  channel.port1.onmessage = () => {
    waiting.shift()?.();
  };
  return () =>
    new Promise<void>((resolve) => {
      waiting.push(resolve);
      channel.port2.postMessage(undefined);
    });
}

/** The yield-to-host port, by the method the browser offers. */
export function yieldToHost(method: HostYieldingMethod): YieldToHost {
  switch (method.kind) {
    case 'scheduler':
      return method.yieldNow;
    case 'macrotask':
      return macrotaskTurns(method.createChannel());
    case 'none':
      return () => Promise.resolve();
  }
}
