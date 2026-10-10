/**
 * The decoder that decodes each codec, and its version, which an asset's
 * provenance records beside its rendition (ADR-0090, REQ-STOR-166): a
 * project's sound never changes because a decoder was updated, and the record
 * says which one made it.
 *
 * The codec module's decoders are the crates `crates/codecs` pins exactly,
 * Symphonia for every codec but Opus and `ropus` for Opus (ADR-0091, amended);
 * a test holds these versions to the pins. A browser's decoder is the
 * browser's own, named by its family and major version, all a user-agent may
 * say without identifying a machine.
 */

import type { BrowserFamily } from '@audiogubbins/capabilities';
import type { CodecId, DecoderIdentity } from '@audiogubbins/codecs';

/** The codecs the codec module decodes. */
export type ModuleDecodedCodec = 'flac' | 'alac' | 'mp3' | 'vorbis' | 'opus' | 'aac-lc';

/** Symphonia, as `crates/codecs` pins it. */
const SYMPHONIA: DecoderIdentity = {
  implementation: 'codec-module',
  name: 'Symphonia',
  version: '0.6.1',
};

/** The module's decoder of each codec it decodes. */
const MODULE_DECODERS: Readonly<Record<ModuleDecodedCodec, DecoderIdentity>> = {
  flac: SYMPHONIA,
  alac: SYMPHONIA,
  mp3: SYMPHONIA,
  vorbis: SYMPHONIA,
  'aac-lc': SYMPHONIA,
  opus: { implementation: 'codec-module', name: 'ropus', version: '0.12.18' },
};

/** Whether the codec module decodes `codec`. */
export function isModuleDecoded(codec: CodecId): codec is ModuleDecodedCodec {
  return Object.hasOwn(MODULE_DECODERS, codec);
}

/** The codec module's decoder of `codec`. */
export function moduleDecoder(codec: ModuleDecodedCodec): DecoderIdentity {
  return MODULE_DECODERS[codec];
}

/**
 * The browser's own decoder, by the browser's family and major version, or
 * stated unknown where the browser names neither.
 */
export function browserDecoder(browser: BrowserFamily | undefined): DecoderIdentity {
  return {
    implementation: 'browser',
    name: browser === undefined ? 'WebCodecs' : `WebCodecs (${browser.name})`,
    version: browser?.majorVersion ?? 'unknown',
  };
}
