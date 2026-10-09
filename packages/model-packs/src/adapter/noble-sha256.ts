/**
 * The integrity check's SHA-256, and the one a model hash is taken with, on
 * `@noble/hashes` (MIT, audited, with no dependencies of its own).
 *
 * Web Crypto's digest takes its input whole, and a pack's file runs to
 * hundreds of megabytes, so the check needs a hash that takes its input a
 * chunk at a time. This one is plain JavaScript and knows no global of any
 * host, so the application, its workers and the Node tests run the same code,
 * and what a test proves of it holds in the browser.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import type { TextSha256 } from '@audiogubbins/domain';

import type { Sha256 } from '../integrity.js';

/** SHA-256 over bytes handed to it in order, as the integrity check takes it. */
export const nobleSha256: Sha256 = () => {
  const hash = sha256.create();
  return {
    update: (bytes) => {
      hash.update(bytes);
      return Promise.resolve();
    },
    digest: () => Promise.resolve(hash.digest()),
  };
};

/**
 * SHA-256 over a text's UTF-8 bytes, at once: a pack's listing, whose model
 * hash availability compares, is a few lines and is never streamed.
 */
export const nobleTextSha256: TextSha256 = (text) => bytesToHex(sha256(utf8ToBytes(text)));
