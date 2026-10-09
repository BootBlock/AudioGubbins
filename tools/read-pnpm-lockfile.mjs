/**
 * Reads pnpm's lockfile, and the packages an importer runs with from it.
 *
 * The lockfile is YAML, which no package this repository installs parses, and
 * a parser added for one tool would be a dependency the notices it writes
 * exist to account for. pnpm writes a small, fixed part of YAML, so that part
 * is read here and everything outside it is refused by line: a block mapping
 * or a sequence of scalars, scalars plain or quoted, and flow mappings and
 * sequences on one line. Every scalar is read as its text. A file that pnpm
 * one day writes in some other form fails loudly rather than being misread.
 *
 * pnpm 10 and later write the lockfile of the package manager itself as a
 * first document, before the workspace's, so a lockfile is read as the
 * documents it holds and the last is the workspace's.
 */

/**
 * A value read from the lockfile.
 *
 * @typedef {string | YamlList | YamlMap} YamlValue
 * @typedef {readonly YamlValue[]} YamlList
 * @typedef {{ readonly [key: string]: YamlValue }} YamlMap
 */

/**
 * One line of a document: its number in the file, how far it is indented and
 * its text after the indent.
 *
 * @typedef {object} Line
 * @property {number} number
 * @property {number} indent
 * @property {string} text
 */

/**
 * An error naming the line of the lockfile the reader stopped at.
 *
 * @param {number} number
 * @param {string} message
 * @returns {Error}
 */
function refusal(number, message) {
  return new Error(`pnpm-lock.yaml:${String(number)}: ${message}`);
}

/**
 * A single-quoted scalar's text from where it opens, and where it closes. Two
 * quotes together are one quote inside it.
 *
 * @param {string} text
 * @param {number} start
 * @param {number} number
 * @returns {{ readonly value: string, readonly end: number }}
 */
function singleQuoted(text, start, number) {
  let value = '';
  for (let at = start + 1; at < text.length; at += 1) {
    if (text[at] !== "'") value += text[at];
    else if (text[at + 1] === "'") {
      value += "'";
      at += 1;
    } else return { value, end: at + 1 };
  }
  throw refusal(number, 'a quoted scalar is not closed on its line');
}

/**
 * A double-quoted scalar's text from where it opens, and where it closes. Its
 * escapes are read as JSON's, which are the ones pnpm's writer uses, and any
 * other is refused.
 *
 * @param {string} text
 * @param {number} start
 * @param {number} number
 * @returns {{ readonly value: string, readonly end: number }}
 */
function doubleQuoted(text, start, number) {
  const match = /^"(?:[^"\\]|\\.)*"/u.exec(text.slice(start));
  if (match === null) throw refusal(number, 'a quoted scalar is not closed on its line');
  try {
    return { value: String(JSON.parse(match[0])), end: start + match[0].length };
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw refusal(number, `a quoted scalar has an escape outside JSON's: ${match[0]}`);
  }
}

/** The first characters of a plain scalar that would mean something else. */
const RESERVED_START = /^[&*!|>%@`#]/u;

/**
 * A plain scalar's text, refused where YAML would read it as something other
 * than text, such as a tag, an anchor, a block scalar or a comment, or where
 * it holds a mapping's colon, as an item of a sequence that is a mapping does.
 *
 * @param {string} value
 * @param {number} number
 * @returns {string}
 */
function plain(value, number) {
  if (RESERVED_START.test(value) || value.includes(' #') || /: |:$/u.test(value)) {
    throw refusal(number, `a scalar is outside the form pnpm writes: ${value}`);
  }
  return value;
}

/**
 * A flow collection, `{ a: b, c: [d] }`, or a scalar inside one, from where it
 * starts, and where it ends.
 *
 * @param {string} text
 * @param {number} start
 * @param {number} number
 * @returns {{ readonly value: YamlValue, readonly end: number }}
 */
function flowValue(text, start, number) {
  let at = start;
  const skip = () => {
    while (text[at] === ' ') at += 1;
  };
  skip();
  const open = text[at];
  if (open === "'") return singleQuoted(text, at, number);
  if (open === '"') return doubleQuoted(text, at, number);
  if (open !== '{' && open !== '[') {
    const run = /^[^,{}[\]]*/u.exec(text.slice(at))?.[0] ?? '';
    const separator = /: |:$/u.exec(run);
    const scalar = separator === null ? run : run.slice(0, separator.index);
    return { value: plain(scalar.trim(), number), end: at + scalar.length };
  }
  const close = open === '{' ? '}' : ']';
  /** @type {Record<string, YamlValue>} */
  const map = Object.create(null);
  /** @type {YamlValue[]} */
  const list = [];
  at += 1;
  skip();
  while (text[at] !== close) {
    const item = flowValue(text, at, number);
    at = item.end;
    skip();
    if (open === '{') {
      if (typeof item.value !== 'string' || text[at] !== ':') {
        throw refusal(number, 'a flow mapping has an entry with no key');
      }
      if (Object.hasOwn(map, item.value)) {
        throw refusal(number, `the key ${item.value} is written twice`);
      }
      const entry = flowValue(text, at + 1, number);
      map[item.value] = entry.value;
      at = entry.end;
    } else list.push(item.value);
    skip();
    if (text[at] === ',') at += 1;
    else if (text[at] !== close) throw refusal(number, 'a flow collection is not closed');
    skip();
  }
  return { value: open === '{' ? map : list, end: at + 1 };
}

/**
 * A value written after a key or a sequence's dash, which is the whole of the
 * rest of its line.
 *
 * @param {string} text
 * @param {number} number
 * @returns {YamlValue}
 */
function inlineValue(text, number) {
  const first = text[0];
  if (first !== '{' && first !== '[' && first !== "'" && first !== '"') return plain(text, number);
  const read = flowValue(text, 0, number);
  if (read.end !== text.length) throw refusal(number, 'a value is followed by more on its line');
  return read.value;
}

/**
 * A mapping's key and what follows it on its line.
 *
 * @param {Line} line
 * @returns {{ readonly key: string, readonly rest: string }}
 */
function keyOf({ text, number }) {
  if (text.startsWith("'")) {
    const { value, end } = singleQuoted(text, 0, number);
    if (text[end] !== ':') throw refusal(number, 'a quoted key is not followed by a colon');
    return { key: value, rest: text.slice(end + 1).trim() };
  }
  const separator = /: |:$/u.exec(text);
  if (separator === null) throw refusal(number, 'a line is neither a key nor an item');
  return {
    key: plain(text.slice(0, separator.index), number),
    rest: text.slice(separator.index + 1).trim(),
  };
}

/**
 * The block collection whose lines start at `start`, all at one indent, and
 * the index of the first line after it.
 *
 * @param {readonly Line[]} lines
 * @param {number} start
 * @returns {{ readonly value: YamlValue, readonly next: number }}
 */
function block(lines, start) {
  const indent = lines[start]?.indent ?? 0;
  const isList = lines[start]?.text.startsWith('- ') ?? false;
  /** @type {Record<string, YamlValue>} */
  const map = Object.create(null);
  /** @type {YamlValue[]} */
  const list = [];
  let at = start;
  for (let line = lines[at]; line !== undefined && line.indent >= indent; line = lines[at]) {
    if (line.indent > indent) throw refusal(line.number, 'a line is indented past its collection');
    if (line.text.startsWith('- ') !== isList) {
      throw refusal(line.number, 'a collection mixes items and keys');
    }
    at += 1;
    if (isList) {
      list.push(inlineValue(line.text.slice(2).trim(), line.number));
      continue;
    }
    const { key, rest } = keyOf(line);
    if (Object.hasOwn(map, key)) throw refusal(line.number, `the key ${key} is written twice`);
    if (rest !== '') {
      map[key] = inlineValue(rest, line.number);
      continue;
    }
    const child = lines[at];
    if (child === undefined || child.indent <= indent) {
      throw refusal(line.number, `the key ${key} has no value`);
    }
    const nested = block(lines, at);
    map[key] = nested.value;
    at = nested.next;
  }
  return { value: isList ? list : map, next: at };
}

/**
 * Every document in a lockfile's text, each read as a mapping.
 *
 * @param {string} text
 * @returns {readonly YamlMap[]}
 */
export function readLockfileDocuments(text) {
  /** @type {Line[][]} */
  const documents = [[]];
  const lines = text.replace(/^\uFEFF/u, '').split('\n');
  for (const [index, raw] of lines.entries()) {
    const line = raw.replace(/\r$/u, '');
    if (line === '---') {
      documents.push([]);
      continue;
    }
    const content = line.trimStart();
    if (content === '' || content.startsWith('#')) continue;
    if (line.startsWith('\t')) throw refusal(index + 1, 'a line is indented with a tab');
    documents.at(-1)?.push({
      number: index + 1,
      indent: line.length - content.length,
      text: content.trimEnd(),
    });
  }
  return documents
    .filter((lines) => lines.length > 0)
    .map((lines) => {
      const { value, next } = block(lines, 0);
      const after = lines[next];
      if (after !== undefined) throw refusal(after.number, 'a line is outdented past its document');
      if (typeof value === 'string' || Array.isArray(value)) {
        throw refusal(lines[0]?.number ?? 1, 'a document is not a mapping');
      }
      return /** @type {YamlMap} */ (value);
    });
}

/**
 * A mapping in the lockfile, or an empty one where the key is absent.
 *
 * @param {YamlMap} map
 * @param {string} key
 * @param {string} where
 * @returns {YamlMap}
 */
function mapAt(map, key, where) {
  const value = map[key];
  if (value === undefined) return {};
  if (typeof value === 'string' || Array.isArray(value)) {
    throw new Error(`pnpm-lock.yaml: ${where}.${key} is not a mapping`);
  }
  return /** @type {YamlMap} */ (value);
}

/**
 * A package the shipped importer runs with: its name and version, the
 * lockfile key it was resolved under, and what it was first reached from,
 * which is how its installed copy is found.
 *
 * @typedef {object} LockedPackage
 * @property {string} name
 * @property {string} version
 * @property {string} key the snapshot key, with any peers it was resolved with
 * @property {string} folder the name its dependent installed it under
 * @property {{ readonly importer: string } | { readonly key: string }} parent
 */

/**
 * The snapshot key a dependency's reference names. A reference is a version,
 * with any peers in brackets after it, or `name@version` where the dependency
 * is an alias for another package.
 *
 * @param {string} name
 * @param {string} reference
 * @returns {string}
 */
function snapshotKey(name, reference) {
  const base = reference.split('(')[0] ?? '';
  if (base.includes(':')) {
    throw new Error(`pnpm-lock.yaml: ${name} is resolved from ${reference}, not the registry`);
  }
  return base.includes('@') ? reference : `${name}@${reference}`;
}

/**
 * A snapshot key's package name and version, without its peers.
 *
 * @param {string} key
 * @returns {{ readonly name: string, readonly version: string }}
 */
function nameAndVersion(key) {
  const base = key.split('(')[0] ?? '';
  const at = base.lastIndexOf('@');
  if (at <= 0) throw new Error(`pnpm-lock.yaml: ${key} is not a package key`);
  return { name: base.slice(0, at), version: base.slice(at + 1) };
}

/**
 * The references a dependent names: its dependencies and its optional ones,
 * sorted so a walk over them reaches each package by the same path every
 * time. A development dependency is never read.
 *
 * @param {YamlMap} entry
 * @param {string} where
 * @returns {readonly (readonly [string, string])[]}
 */
function referencesOf(entry, where) {
  return ['dependencies', 'optionalDependencies']
    .flatMap((field) =>
      Object.entries(mapAt(entry, field, where)).map(([name, value]) => {
        // An importer writes `{ specifier, version }`, a snapshot the version.
        const reference =
          typeof value === 'string' || Array.isArray(value)
            ? value
            : /** @type {YamlMap} */ (value)['version'];
        if (typeof reference !== 'string') {
          throw new Error(`pnpm-lock.yaml: ${where} names ${name} with no version`);
        }
        return /** @type {const} */ ([name, reference]);
      }),
    )
    .toSorted(([one], [other]) => (one < other ? -1 : one > other ? 1 : 0));
}

/**
 * The peers a package declares optional. pnpm resolves one to whatever the
 * workspace happens to install, a development dependency included, so it is
 * the dependent's to provide: one the application runs with is reached as its
 * own dependency.
 *
 * @param {YamlMap} packages
 * @param {string} key
 * @returns {ReadonlySet<string>}
 */
function optionalPeersOf(packages, key) {
  const { name, version } = nameAndVersion(key);
  const where = `packages.${name}@${version}`;
  const meta = mapAt(
    mapAt(packages, `${name}@${version}`, 'packages'),
    'peerDependenciesMeta',
    where,
  );
  return new Set(
    Object.entries(meta)
      .filter(([peer]) => mapAt(meta, peer, where)['optional'] === 'true')
      .map(([peer]) => peer),
  );
}

/**
 * A dependent the walk has yet to read: its entry in the lockfile, where that
 * is, the importer or package it is, and the dependencies it names that are
 * not followed.
 *
 * @typedef {object} Pending
 * @property {YamlMap} entry
 * @property {string} where
 * @property {LockedPackage['parent']} parent
 * @property {ReadonlySet<string>} skipped
 */

/**
 * Every third-party package an importer runs with, from the lockfile: its
 * dependencies and their dependencies, optional ones and the peers they
 * require included, through each workspace package it links, transitively.
 * Development dependencies and optional peers are never followed, so a test
 * runner, linter, bundler or type package is reached only where something the
 * importer runs with depends on it.
 *
 * @param {string} text the lockfile's text
 * @param {string} importer the importer's folder, as the lockfile names it
 * @returns {readonly LockedPackage[]} in the order the walk reached them
 */
export function lockedPackagesOf(text, importer) {
  // The last document: the package manager's own, where there is one, comes
  // first, and has importers and snapshots of its own.
  const workspace = readLockfileDocuments(text).at(-1);
  if (workspace === undefined || !('importers' in workspace)) {
    throw new Error('pnpm-lock.yaml has no workspace document');
  }
  const importers = mapAt(workspace, 'importers', 'the lockfile');
  const packages = mapAt(workspace, 'packages', 'the lockfile');
  const snapshots = mapAt(workspace, 'snapshots', 'the lockfile');
  if (!(importer in importers)) throw new Error(`pnpm-lock.yaml has no importer ${importer}`);

  /** @type {Map<string, LockedPackage>} */
  const reached = new Map();
  const visitedImporters = new Set([importer]);
  /** @type {Pending[]} */
  const queue = [
    {
      entry: mapAt(importers, importer, 'importers'),
      where: importer,
      parent: { importer },
      skipped: new Set(),
    },
  ];

  for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
    for (const [name, reference] of referencesOf(item.entry, item.where)) {
      if (item.skipped.has(name)) continue;
      if (reference.startsWith('link:')) {
        if (!('importer' in item.parent)) {
          throw new Error(`pnpm-lock.yaml: ${item.where} links ${name}, which is no package`);
        }
        const linked = joinPosix(item.parent.importer, reference.slice('link:'.length));
        if (visitedImporters.has(linked)) continue;
        visitedImporters.add(linked);
        if (!(linked in importers)) throw new Error(`pnpm-lock.yaml has no importer ${linked}`);
        queue.push({
          entry: mapAt(importers, linked, 'importers'),
          where: linked,
          parent: { importer: linked },
          skipped: new Set(),
        });
        continue;
      }
      const key = snapshotKey(name, reference);
      if (reached.has(key)) continue;
      if (!(key in snapshots)) throw new Error(`pnpm-lock.yaml has no snapshot ${key}`);
      reached.set(key, { ...nameAndVersion(key), key, folder: name, parent: item.parent });
      queue.push({
        entry: mapAt(snapshots, key, 'snapshots'),
        where: key,
        parent: { key },
        skipped: optionalPeersOf(packages, key),
      });
    }
  }
  return [...reached.values()];
}

/**
 * A folder relative to another, both written as the lockfile writes them.
 *
 * @param {string} from
 * @param {string} relative
 * @returns {string}
 */
function joinPosix(from, relative) {
  /** @type {string[]} */
  const parts = from === '.' ? [] : from.split('/');
  for (const part of relative.split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.' && part !== '') parts.push(part);
  }
  return parts.length === 0 ? '.' : parts.join('/');
}
