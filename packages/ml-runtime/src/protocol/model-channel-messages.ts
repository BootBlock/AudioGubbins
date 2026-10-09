/**
 * The messages of a model channel: the channel between the page and a thread
 * that runs models, over which the thread reaches the inference workers and
 * the files of the packs the person has installed (ADR-0062).
 *
 * The page connects a thread by sending its scope one end of the channel with
 * what the device offers the runtime (`ToModelThread`). Over the channel the
 * thread asks for a connection to the inference worker, handing over the end of
 * a channel of its own, which the page hands on; asks by call whether a pack
 * version can be read, before it opens any of the version's models, and for a
 * file of a pack; and cancels a call (`FromModelThread`). The page answers each
 * call with the version ready, the file, its bytes transferred, or why it
 * cannot be had, and says when the worker the thread is connected to has failed
 * (`ToModelChannel`). Every message is read field by field on arrival
 * (`model-channel-reading.ts`).
 */

import type { ChannelEnd } from '../channel-end.js';
import type { InferenceCapabilities } from '../inference-options.js';
import type { ModelBytes } from '../inference-port.js';
import type { InferenceFailures } from './inference-messages.js';

/** The kind of the message that connects a thread's scope to its model channel. */
export const MODEL_CHANNEL = 'model-channel';

/** What the page sends a thread's scope: its end of the model channel. */
export interface ToModelThread {
  readonly kind: typeof MODEL_CHANNEL;
  readonly port: ChannelEnd;
  /** What the device offers the runtime, as the inference workers were started with it. */
  readonly capabilities: InferenceCapabilities;
}

/** The kinds of message a thread sends over its model channel. */
export const FromModelThreadKind = {
  Inference: 'inference',
  Version: 'version',
  File: 'file',
  Cancel: 'cancel',
} as const;

/** A message a thread sends over its model channel. */
export type FromModelThread =
  | {
      /** A channel to the inference worker, to hand on. */
      readonly kind: typeof FromModelThreadKind.Inference;
      readonly port: ChannelEnd;
    }
  | {
      /** Whether version `version` of the pack `pack` can be read now. */
      readonly kind: typeof FromModelThreadKind.Version;
      readonly call: number;
      readonly pack: string;
      readonly version: string;
    }
  | {
      readonly kind: typeof FromModelThreadKind.File;
      readonly call: number;
      readonly pack: string;
      readonly version: string;
      readonly path: string;
    }
  | {
      /** The thread has answered the call as cancelled, and wants no answer. */
      readonly kind: typeof FromModelThreadKind.Cancel;
      readonly call: number;
    };

/** The kinds of message the page sends over a model channel. */
export const ToModelChannelKind = {
  VersionReady: 'version-ready',
  File: 'file',
  CallFailed: 'call-failed',
  InferenceFailed: 'inference-failed',
} as const;

/** A message the page sends over a model channel. */
export type ToModelChannel =
  | {
      /** The pack version a call asked of can be read. */
      readonly kind: typeof ToModelChannelKind.VersionReady;
      readonly call: number;
    }
  | {
      /** The file a call asked for: its bytes, and their SHA-256 taken as they were read. */
      readonly kind: typeof ToModelChannelKind.File;
      readonly call: number;
      readonly bytes: ModelBytes;
      readonly sha256: string;
    }
  | {
      /** Why what a call asked for cannot be had. */
      readonly kind: typeof ToModelChannelKind.CallFailed;
      readonly call: number;
      readonly failures: InferenceFailures;
    }
  | {
      /** The inference worker failed for `reason`. */
      readonly kind: typeof ToModelChannelKind.InferenceFailed;
      readonly reason: string;
    };
