/**
 * One question put to a WebCodecs class: whether it supports a configuration,
 * as `isConfigSupported` answers it. Shared by the probes of which codecs a
 * browser has and of the bit rates its encoder takes, so both read an answer
 * alike.
 */

/** An audio codec's configuration, as WebCodecs takes one to decode or encode. */
export interface WebCodecsAudioConfig {
  /** The codec string of the WebCodecs codec registry, such as `mp4a.40.5`. */
  readonly codec: string;
  readonly sampleRate: number;
  readonly numberOfChannels: number;
  /** The codec's own configuration, such as an AAC `AudioSpecificConfig`. */
  readonly description?: Uint8Array;
  /** The encoder's target, in bits a second. */
  readonly bitrate?: number;
}

/** What `isConfigSupported` answers. */
export interface ConfigSupport {
  readonly supported?: boolean;
}

/** A class's `isConfigSupported`, as read from it. */
export type AskSupport = (config: WebCodecsAudioConfig) => unknown;

/** Whether the browser supports one configuration. */
export async function supports(ask: AskSupport, config: WebCodecsAudioConfig): Promise<boolean> {
  try {
    const answer: unknown = await ask(config);
    return (
      typeof answer === 'object' && answer !== null && Reflect.get(answer, 'supported') === true
    );
  } catch (error) {
    // A configuration the browser holds invalid rejects with a `TypeError`,
    // and one it refuses to consider with a `DOMException`: either way, not
    // supported. Anything else is a fault.
    if (error instanceof TypeError || error instanceof DOMException) return false;
    throw error;
  }
}
