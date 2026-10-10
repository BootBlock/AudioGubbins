/**
 * The encoder that wrote an export's file, and its version, which the export's
 * record names (REQ-AUDIO-145, REQ-STOR-197): the same samples and settings
 * give the same bytes only from the same encoder at the same version, so the
 * record says which one made them.
 *
 * Each version names what it versions, since an export's record keeps one text
 * for it: a library by its own name and release, AudioGubbins' own writers and
 * the codec module's own FLAC encoder by the product's release. The codec
 * module's encoders are the crates `crates/codecs` pins exactly, and a test
 * holds these versions to the pins; the prebuilt encoders are LAME 3.100 and
 * libvorbis 1.3.7 (ADR-0091). A browser's encoder is the browser's own, named
 * by its family and major version, all a user-agent may say without identifying
 * a machine.
 */

import type { BrowserFamily } from '@audiogubbins/capabilities';
import type { CodecImplementation } from '@audiogubbins/codecs';
import { PRODUCT_VERSION } from '@audiogubbins/version';

/** The implementation that encoded an export's file, and its version, naming it. */
export interface EncoderIdentity {
  readonly implementation: CodecImplementation;
  readonly version: string;
}

/** AudioGubbins' own writers: WAV, AIFF and AIFF-C, framed by no other encoder. */
export const APPLICATION_ENCODER: EncoderIdentity = {
  implementation: 'application',
  version: `AudioGubbins ${PRODUCT_VERSION}`,
};

/** FLAC frames at the depths `flacenc` serves, 16 and 24 bits among the export's. */
export const FLACENC_ENCODER: EncoderIdentity = {
  implementation: 'codec-module',
  version: 'flacenc 0.5.1',
};

/** FLAC frames at the depths `flacenc` does not serve, 32 bits among the export's. */
export const MODULE_FLAC_ENCODER: EncoderIdentity = {
  implementation: 'codec-module',
  version: `AudioGubbins ${PRODUCT_VERSION}`,
};

/** Opus packets, encoded by the crate that decodes them. */
export const ROPUS_ENCODER: EncoderIdentity = {
  implementation: 'codec-module',
  version: 'ropus 0.12.18',
};

export const LAME_ENCODER: EncoderIdentity = {
  implementation: 'prebuilt-module',
  version: 'LAME 3.100',
};

export const LIBVORBIS_ENCODER: EncoderIdentity = {
  implementation: 'prebuilt-module',
  version: 'libvorbis 1.3.7',
};

/** The browser's own encoder, by the browser's family and major version, or stated unknown. */
export function browserEncoder(browser: BrowserFamily | undefined): EncoderIdentity {
  return {
    implementation: 'browser',
    version:
      browser === undefined
        ? 'WebCodecs, of a browser that does not say its version'
        : `WebCodecs (${browser.name}) ${browser.majorVersion}`,
  };
}
