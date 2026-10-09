/**
 * Named members of a gzipped tar archive, written to files in one pass over
 * the archive as it is decompressed, so a source of hundreds of megabytes is
 * never held in memory and no tar program, which differs by platform, is
 * needed.
 *
 * It reads the POSIX ustar format with the GNU long-name and pax extensions,
 * which is what the sources' archives are written in. Only a regular file is
 * taken; a member wanted twice, wanted but absent, or not a regular file is
 * refused, since each means the archive is not the one the definition was
 * written for. Every header's checksum is checked.
 */

import { open } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';

const BLOCK = 512;

/** A regular file's type flag, and the flag ustar's predecessor left empty. */
const REGULAR_FILE = new Set(['0', '\0']);
const GNU_LONG_NAME = 'L';
const PAX_HEADER = 'x';

/**
 * Writes each member of the gzipped tar archive at `archive` that `wanted`
 * names to the path it maps it to.
 *
 * @param {string} archive
 * @param {ReadonlyMap<string, string>} wanted member name to destination path
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
export async function extractMembers(archive, wanted, signal) {
  const found = new Set();
  const reader = new TarReader(async (name, type) => {
    const destination = wanted.get(name);
    if (destination === undefined) return undefined;
    if (found.has(name)) throw new Error(`${archive} holds ${name} twice.`);
    if (!REGULAR_FILE.has(type)) throw new Error(`${archive} holds ${name}, but not as a file.`);
    found.add(name);
    return open(destination, 'w');
  });
  const stream = createReadStream(archive, signal === undefined ? {} : { signal }).pipe(
    createGunzip(),
  );
  for await (const chunk of stream) {
    await reader.take(/** @type {Buffer} */ (chunk));
  }
  reader.finish(archive);
  const missing = [...wanted.keys()].filter((name) => !found.has(name));
  if (missing.length > 0) throw new Error(`${archive} holds no ${missing.join(', ')}.`);
}

/**
 * Opens the file a member is written to, or answers `undefined` to pass the
 * member over.
 *
 * @callback OpenMember
 * @param {string} name the member's path, without a leading `./`
 * @param {string} type its type flag
 * @returns {Promise<import('node:fs/promises').FileHandle | undefined>}
 */

/** The state of a pass over a tar stream, fed a chunk at a time. */
class TarReader {
  /** @type {OpenMember} */
  #openMember;
  /** Bytes of a header or an extension not yet complete. */
  #pending = Buffer.alloc(0);
  /** The data bytes of the current member still to come, and its padding. */
  #remaining = 0;
  #padding = 0;
  /** @type {import('node:fs/promises').FileHandle | undefined} */
  #output;
  /** The current member is an extension header, read whole before the next. */
  #extension = /** @type {string | undefined} */ (undefined);
  #extensionBytes = /** @type {Buffer[]} */ ([]);
  /** The name an extension gave the member that follows it. */
  #nextName = /** @type {string | undefined} */ (undefined);
  #ended = false;

  /** @param {OpenMember} openMember */
  constructor(openMember) {
    this.#openMember = openMember;
  }

  /** @param {Buffer} chunk */
  async take(chunk) {
    let at = 0;
    while (at < chunk.length && !this.#ended) {
      if (this.#remaining > 0) {
        const length = Math.min(this.#remaining, chunk.length - at);
        const data = chunk.subarray(at, at + length);
        if (this.#output !== undefined) await this.#output.write(data);
        if (this.#extension !== undefined) this.#extensionBytes.push(Buffer.from(data));
        this.#remaining -= length;
        at += length;
        if (this.#remaining === 0) await this.#memberEnded();
        continue;
      }
      if (this.#padding > 0) {
        const length = Math.min(this.#padding, chunk.length - at);
        this.#padding -= length;
        at += length;
        continue;
      }
      const length = Math.min(BLOCK - this.#pending.length, chunk.length - at);
      this.#pending = Buffer.concat([this.#pending, chunk.subarray(at, at + length)]);
      at += length;
      if (this.#pending.length === BLOCK) {
        const header = this.#pending;
        this.#pending = Buffer.alloc(0);
        await this.#header(header);
      }
    }
  }

  /**
   * Refuses an archive that ended part way through a member.
   *
   * @param {string} archive
   */
  finish(archive) {
    if (!this.#ended || this.#output !== undefined) {
      throw new Error(`${archive} ends part way through its last member.`);
    }
  }

  /** @param {Buffer} header */
  async #header(header) {
    if (header.every((byte) => byte === 0)) {
      this.#ended = true;
      return;
    }
    if (!checksumHolds(header)) throw new Error('A tar header fails its checksum.');
    const type = String.fromCharCode(header[156] ?? 0);
    const size = sizeOf(header);
    this.#remaining = size;
    this.#padding = (BLOCK - (size % BLOCK)) % BLOCK;

    if (type === GNU_LONG_NAME || type === PAX_HEADER) {
      this.#extension = type;
      this.#extensionBytes = [];
      if (size === 0) await this.#memberEnded();
      return;
    }
    const name = (this.#nextName ?? ustarName(header)).replace(/^\.\//u, '');
    this.#nextName = undefined;
    this.#output = await this.#openMember(name, type);
    if (size === 0) await this.#memberEnded();
  }

  async #memberEnded() {
    if (this.#output !== undefined) {
      await this.#output.close();
      this.#output = undefined;
    }
    if (this.#extension === undefined) return;
    const text = Buffer.concat(this.#extensionBytes).toString('utf8');
    this.#nextName = this.#extension === GNU_LONG_NAME ? text.replace(/\0+$/u, '') : paxPath(text);
    this.#extension = undefined;
    this.#extensionBytes = [];
  }
}

/**
 * A field of a header as text, up to its first NUL.
 *
 * @param {Buffer} header
 * @param {number} start
 * @param {number} length
 */
function field(header, start, length) {
  const bytes = header.subarray(start, start + length);
  const end = bytes.indexOf(0);
  return bytes.subarray(0, end === -1 ? length : end).toString('utf8');
}

/**
 * A ustar member's path: its prefix, where it has one, and its name.
 *
 * @param {Buffer} header
 */
function ustarName(header) {
  const name = field(header, 0, 100);
  const prefix = field(header, 257, 6) === 'ustar' ? field(header, 345, 155) : '';
  return prefix === '' ? name : `${prefix}/${name}`;
}

/**
 * A member's size: octal digits, or, past eight gigabytes, base-256 with the
 * top bit of the first byte set.
 *
 * @param {Buffer} header
 */
function sizeOf(header) {
  const first = header[124] ?? 0;
  if ((first & 0x80) !== 0) {
    let size = first & 0x7f;
    for (let index = 125; index < 136; index += 1) size = size * 256 + (header[index] ?? 0);
    return size;
  }
  const text = field(header, 124, 12).trim();
  if (!/^[0-7]+$/u.test(text)) throw new Error('A tar header states no size.');
  return Number.parseInt(text, 8);
}

/**
 * Whether a header's checksum, the sum of its bytes with the checksum field
 * read as spaces, is the one it states.
 *
 * @param {Buffer} header
 */
function checksumHolds(header) {
  const stated = Number.parseInt(field(header, 148, 8).trim(), 8);
  let sum = 0;
  for (let index = 0; index < BLOCK; index += 1) {
    sum += index >= 148 && index < 156 ? 0x20 : (header[index] ?? 0);
  }
  return sum === stated;
}

/**
 * The `path` a pax extended header gives, whose records are written
 * `<length> <key>=<value>\n`.
 *
 * @param {string} text
 * @returns {string | undefined}
 */
function paxPath(text) {
  for (const record of text.split('\n')) {
    const match = /^\d+ path=(.*)$/u.exec(record);
    if (match !== null) return match[1];
  }
  return undefined;
}
