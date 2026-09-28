/**
 * What every settings section shares.
 *
 * One way to run a command, so that no section reaches for a store.
 * REQ-EDIT-073 makes the command layer the single route, and a settings control
 * that wrote to a store directly would work and would be the only surface that
 * could make that change.
 */

import type { CommandInvocation } from '@audiogubbins/commands';

import type { VoicedOptions } from '../../commands/voiced-execution.js';

/**
 * Runs a command, optionally naming what it should act on, and how it is
 * spoken of. Answers whether the command ran, rather than being refused, so a
 * control can keep what the reader typed when it was refused.
 */
export type RunCommand = (
  id: string,
  args?: CommandInvocation['arguments'],
  options?: VoicedOptions,
) => boolean;
