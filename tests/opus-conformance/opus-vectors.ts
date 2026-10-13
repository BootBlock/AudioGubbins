/**
 * The Opus decoder conformance vectors, fetched on demand from opus-codec.org
 * and held to the SHA-256 recorded here (REQ-REPO-191: the repository holds
 * no binary fixture, only where one comes from and its hash).
 *
 * The RFC 8251 set is the one a decoder is held to: the same twelve
 * bitstreams as RFC 6716's set, each with the output of the decoder RFC 8251
 * corrected (`testvectorNN.dec`) and of RFC 6716's (`testvectorNNm.dec`), of
 * which a conforming decoder matches either. The tarball is cached outside
 * the working tree's sources, under `node_modules/.cache`, and read whole
 * once a run.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { gunzipSync } from 'node:zlib';

import { inRepository } from '../repository.js';

/** Where the vectors come from, and the SHA-256 of what was published there. */
const OPUS_VECTORS = {
  url: 'https://opus-codec.org/static/testvectors/opus_testvectors-rfc8251.tar.gz',
  sha256: '6b26a22f9ba87b2b836906a9bb7afec5f8e54d49553b1200382520ee6fedfa55',
} as const;

/** Where the tarball is cached, named by its hash. */
const CACHED = inRepository(
  'node_modules',
  '.cache',
  'audiogubbins',
  'opus-vectors',
  `${OPUS_VECTORS.sha256}.tar.gz`,
);

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** The tarball's bytes, from the cache or fetched into it, held to its hash. */
async function tarball(): Promise<Uint8Array> {
  if (existsSync(CACHED)) {
    const cached = new Uint8Array(readFileSync(CACHED));
    if (sha256(cached) === OPUS_VECTORS.sha256) return cached;
  }
  const response = await fetch(OPUS_VECTORS.url);
  if (!response.ok) {
    throw new Error(`${OPUS_VECTORS.url} answered ${String(response.status)}.`);
  }
  const fetched = new Uint8Array(await response.arrayBuffer());
  const hash = sha256(fetched);
  if (hash !== OPUS_VECTORS.sha256) {
    throw new Error(
      `${OPUS_VECTORS.url} has SHA-256 ${hash}, not the ${OPUS_VECTORS.sha256} recorded.`,
    );
  }
  mkdirSync(dirname(CACHED), { recursive: true });
  // Written beside its name and moved into it, so a run cut short leaves no
  // partial file under the name a later run trusts.
  writeFileSync(`${CACHED}.partial`, fetched);
  renameSync(`${CACHED}.partial`, CACHED);
  return fetched;
}

/** A tar header's octal number field. */
function octal(header: Uint8Array, start: number, length: number): number {
  const text = new TextDecoder().decode(header.subarray(start, start + length));
  return Number.parseInt(text.replace(/[\0 ]+$/u, '').trim() || '0', 8);
}

/** The regular files of a ustar archive, by their names' last part. */
function untar(archive: Uint8Array): ReadonlyMap<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  for (let at = 0; at + 512 <= archive.length;) {
    const header = archive.subarray(at, at + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = new TextDecoder().decode(header.subarray(0, 100)).replace(/\0.*$/su, '');
    const size = octal(header, 124, 12);
    const type = String.fromCharCode(header[156] ?? 0);
    if (type === '0' || type === '\0') {
      files.set(name.split('/').at(-1) ?? name, archive.subarray(at + 512, at + 512 + size));
    }
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

/** The vectors' files, by name: `testvectorNN.bit`, `.dec` and `m.dec`. */
export async function opusVectors(): Promise<ReadonlyMap<string, Uint8Array>> {
  return untar(new Uint8Array(gunzipSync(await tarball())));
}
