import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { lockedPackagesOf, readLockfileDocuments } from '../tools/read-pnpm-lockfile.mjs';
import {
  ALLOWED_LICENCES,
  LICENCE_TEXTS,
  PORTED_CODE,
  type CargoMetadata,
  decideLicence,
  linkedCratesOf,
  noticeOf,
  portedNoticesOf,
  renderNotices,
  type PackageSource,
} from '../tools/sync-third-party-notices.mjs';
import { inRepository } from './repository.js';

/**
 * The generator of `THIRD-PARTY-NOTICES.md`, asked what ships and what each
 * shipped package's notice is of lockfiles, manifests and licence files
 * written here, so each case says what it asserts without the repository's
 * installed packages behind it. Whether the committed file is current is
 * `pnpm run notices:check`'s question, which the lint asks.
 */

/**
 * A lockfile as pnpm writes one: the package manager's own document first,
 * then the workspace's. The application runs with `shipped`, and with the
 * workspace package `packages/core`, which runs with `deep`. `vitest` is a
 * development dependency of both, `unlicensed` and `copyleft` are shipped
 * with a licence missing and one that is not allowed, `peer` is a peer
 * `deep` requires and `@types/deep` one it takes only if it is there.
 */
const LOCKFILE = `---
lockfileVersion: '9.0'

importers:

  .:
    packageManagerDependencies:
      pnpm:
        specifier: 12.4.2
        version: 12.4.2

packages:

  pnpm@12.4.2:
    resolution: {integrity: sha512-AAAA, tarball: https://registry.example.com/pnpm.tgz}
    engines: {node: '>=18.*'}

snapshots:

  pnpm@12.4.2: {}

---
lockfileVersion: '9.0'

settings:
  autoInstallPeers: true

importers:

  .:
    devDependencies:
      vitest:
        specifier: 5.0.1
        version: 5.0.1

  apps/web:
    dependencies:
      '@example/core':
        specifier: workspace:*
        version: link:../../packages/core
      shipped:
        specifier: 1.0.0
        version: 1.0.0
    devDependencies:
      vitest:
        specifier: 5.0.1
        version: 5.0.1

  packages/core:
    dependencies:
      copyleft:
        specifier: 3.0.0
        version: 3.0.0
      deep:
        specifier: 2.0.0
        version: 2.0.0(@types/deep@2.0.0)(peer@1.0.0)
    devDependencies:
      vitest:
        specifier: 5.0.1
        version: 5.0.1

packages:

  '@types/deep@2.0.0':
    resolution: {integrity: sha512-BBBB}

  copyleft@3.0.0:
    resolution: {integrity: sha512-CCCC}

  deep@2.0.0:
    resolution: {integrity: sha512-DDDD}
    peerDependencies:
      '@types/deep': '*'
      peer: ^1.0.0
    peerDependenciesMeta:
      '@types/deep':
        optional: true

  peer@1.0.0:
    resolution: {integrity: sha512-EEEE}

  shipped@1.0.0:
    resolution: {integrity: sha512-FFFF}

  unlicensed@1.2.0:
    resolution: {integrity: sha512-GGGG}

  vitest@5.0.1:
    resolution: {integrity: sha512-HHHH}
    hasBin: true

snapshots:

  '@types/deep@2.0.0': {}

  copyleft@3.0.0: {}

  deep@2.0.0(@types/deep@2.0.0)(peer@1.0.0):
    dependencies:
      '@types/deep': 2.0.0
      peer: 1.0.0
    optionalDependencies:
      unlicensed: 1.2.0

  peer@1.0.0: {}

  shipped@1.0.0: {}

  unlicensed@1.2.0: {}

  vitest@5.0.1:
    transitivePeerDependencies:
      - supports-color
`;

/** An MIT licence file, with its copyright line, as a package ships one. */
const MIT_FILE = [
  'MIT License',
  '',
  'Copyright (c) 2020 Example Authors',
  '',
  'Permission is hereby granted, free of charge, to any person obtaining a copy',
  'of this software, subject to the following conditions:',
  '',
  'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND. IN NO EVENT SHALL',
  'THE AUTHORS OR',
  'COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM.',
].join('\n');

/** The manifest and licence files each package of the lockfile installs. */
const INSTALLED: Readonly<Record<string, Omit<PackageSource, 'name' | 'version'>>> = {
  copyleft: { licence: 'GPL-3.0-only', files: [{ name: 'LICENSE', text: 'GNU GPL' }] },
  deep: { licence: 'MIT', files: [{ name: 'LICENSE', text: MIT_FILE }] },
  peer: { licence: '(GPL-2.0-only OR ISC)', files: [{ name: 'LICENCE.md', text: 'ISC' }] },
  shipped: { licence: 'MIT', files: [{ name: 'license.txt', text: MIT_FILE }] },
  unlicensed: { licence: undefined, files: [] },
};

/** The standard text of a licence, named so a case can see which it took. */
const standardText = (licence: string): string => `The ${licence} text.\nCopyright <year> <owner>`;

/** What the fixture installs for a package, as the generator reads it. */
function sourceOf(name: string, version: string): PackageSource {
  const installed = INSTALLED[name];
  if (installed === undefined) throw new Error(`the fixture installs no ${name}`);
  return { name, version, ...installed };
}

/** The notices of the lockfile's shipped packages, or why each is refused. */
function decide(lockfile: string): readonly ReturnType<typeof noticeOf>[] {
  return lockedPackagesOf(lockfile, 'apps/web').map(({ name, version }) =>
    noticeOf(sourceOf(name, version), standardText),
  );
}

describe('which packages ship', () => {
  it('follows production dependencies through linked packages, and no development dependency or optional peer', () => {
    expect(
      lockedPackagesOf(LOCKFILE, 'apps/web')
        .map(({ name, version }) => `${name}@${version}`)
        .toSorted(),
    ).toEqual(['copyleft@3.0.0', 'deep@2.0.0', 'peer@1.0.0', 'shipped@1.0.0', 'unlicensed@1.2.0']);
  });

  it('records the folder each package is installed under by what first reached it', () => {
    const deep = lockedPackagesOf(LOCKFILE, 'apps/web').find(({ name }) => name === 'deep');

    expect(deep?.parent).toEqual({ importer: 'packages/core' });
    expect(
      lockedPackagesOf(LOCKFILE, 'apps/web').find(({ name }) => name === 'peer')?.parent,
    ).toEqual({ key: 'deep@2.0.0(@types/deep@2.0.0)(peer@1.0.0)' });
  });

  it('refuses a lockfile line outside the form pnpm writes, rather than misreading it', () => {
    expect(() => readLockfileDocuments('a:\n  b: |\n    text\n')).toThrow(/pnpm-lock.yaml:2:/u);
    expect(() => readLockfileDocuments('a:\n\tb: c\n')).toThrow(/tab/u);
    expect(() => readLockfileDocuments('a:\n  - b: c\n')).toThrow(/outside the form/u);
    expect(() => readLockfileDocuments('a: b\na: c\n')).toThrow(/written twice/u);
  });

  it('reads a flow mapping whose values hold colons, as a resolution does', () => {
    expect(
      readLockfileDocuments(
        "p:\n  resolution: {integrity: sha512-A==, tarball: https://example.com/p.tgz}\n  os: [darwin, 'linux']\n",
      ),
    ).toEqual([
      {
        p: {
          resolution: { integrity: 'sha512-A==', tarball: 'https://example.com/p.tgz' },
          os: ['darwin', 'linux'],
        },
      },
    ]);
  });

  it('follows the normal dependencies of a crate, not its development or build ones, and lists no workspace crate', () => {
    const crate = (name: string, source: string | null) => ({
      id: `${name}-id`,
      name,
      version: '1.0.0',
      source,
      license: 'MIT',
      manifest_path: `/crates/${name}/Cargo.toml`,
    });
    const registry = 'registry+https://github.com/rust-lang/crates.io-index';
    const edge = (pkg: string, kind: string | null) => ({ pkg, dep_kinds: [{ kind }] });
    const metadata: CargoMetadata = {
      packages: [
        crate('bindings', null),
        crate('core', null),
        crate('linked', registry),
        crate('transitive', registry),
        crate('tested-with', registry),
        crate('built-with', registry),
      ],
      resolve: {
        nodes: [
          { id: 'bindings-id', deps: [edge('core-id', null), edge('tested-with-id', 'dev')] },
          { id: 'core-id', deps: [edge('linked-id', null), edge('built-with-id', 'build')] },
          { id: 'linked-id', deps: [edge('transitive-id', null)] },
        ],
      },
    };

    expect(linkedCratesOf(metadata, 'bindings').map(({ name }) => name)).toEqual([
      'linked',
      'transitive',
    ]);
  });
});

describe('what the licence of a shipped package permits', () => {
  it('refuses, by name, the shipped package with no licence and the one with a licence not allowed', () => {
    expect(decide(LOCKFILE).flatMap((one) => ('refused' in one ? [one.refused] : []))).toEqual([
      'copyleft 3.0.0 is licensed GPL-3.0-only: GPL-3.0-only is not allowed',
      'unlicensed 1.2.0 declares no SPDX licence expression',
    ]);
  });

  it('takes the allowed alternative of an OR, every operand of an AND, and only an allowed exception', () => {
    expect(decideLicence('(GPL-2.0-only OR ISC)')).toEqual({ allowed: true, licences: ['ISC'] });
    expect(decideLicence('MIT AND Zlib')).toEqual({ allowed: true, licences: ['MIT', 'Zlib'] });
    expect(decideLicence('MIT AND (LGPL-2.1-only OR GPL-3.0-only)')).toEqual({
      allowed: false,
      reason: 'LGPL-2.1-only is not allowed',
    });
    expect(decideLicence('Apache-2.0 WITH LLVM-exception')).toEqual({
      allowed: true,
      licences: ['Apache-2.0 WITH LLVM-exception'],
    });
    expect(decideLicence('MIT WITH Classpath-exception-2.0')).toMatchObject({ allowed: false });
    expect(decideLicence('MIT OR')).toMatchObject({ allowed: false });
    expect(decideLicence('SEE LICENSE IN LICENSE.txt')).toMatchObject({ allowed: false });
  });

  it('states the copyright a licence file states, and none of its prose about copyright', () => {
    expect(noticeOf(sourceOf('shipped', '1.0.0'), standardText)).toMatchObject({
      notice: { copyright: ['Copyright (c) 2020 Example Authors'], standard: false },
    });
  });

  it('quotes the standard text of a package that ships no licence file, without its template copyright', () => {
    expect(
      noticeOf({ name: 'bare', version: '1.0.0', licence: 'ISC', files: [] }, standardText),
    ).toEqual({
      notice: {
        name: 'bare',
        version: '1.0.0',
        licence: 'ISC',
        copyright: [],
        texts: ['The ISC text.'],
        standard: true,
      },
    });
  });

  it('holds the standard text of every allowed licence, and of no other', () => {
    expect(
      readdirSync(LICENCE_TEXTS)
        .map((name) => name.replace(/\.txt$/u, ''))
        .toSorted(),
    ).toEqual([...ALLOWED_LICENCES].toSorted());
  });
});

describe('the notices file', () => {
  /** The notices of the fixture's packages a licence allows. */
  const allowed = () => decide(LOCKFILE).flatMap((one) => ('notice' in one ? [one.notice] : []));

  it('writes a text two packages share once, naming both', () => {
    const rendered = renderNotices(allowed());

    expect(rendered.match(/Permission is hereby granted/gu)).toHaveLength(1);
    expect(rendered).toContain('Shipped by deep 2.0.0, shipped 1.0.0.');
    expect(rendered).toContain('| peer | 1.0.0 | (GPL-2.0-only OR ISC) | — | [2](#text-2) |');
  });

  it('writes the same file whatever order the packages are given in', () => {
    const notices = allowed();

    expect(renderNotices(notices.toReversed())).toBe(renderNotices(notices));
  });
});

describe('the notices of ported code', () => {
  /** A port as the list writes one, which every case changes one field of. */
  const PORT = {
    project: 'Example',
    url: 'https://example.com/example',
    commit: '0123456789abcdef0123456789abcdef01234567',
    licence: 'MIT',
    copyright: ['Copyright (c) 2020 Example Authors'],
    ported: 'Its transform.',
    into: ['packages/core/src/transform.ts'],
  };

  /** The paths the fixture's repository holds. */
  const exists = (path: string) => path === 'packages/core/src/transform.ts';

  it('gives a port its notice, with the standard text of the licence it is taken under', () => {
    expect(portedNoticesOf({ ported: [PORT] }, exists, standardText)).toEqual({
      notices: [{ ...PORT, texts: ['The MIT text.'] }],
    });
  });

  it('refuses a port whose path is gone or climbs out of the repository, by name', () => {
    expect(
      portedNoticesOf(
        { ported: [{ ...PORT, into: ['packages/core/src/gone.ts', '../outside.ts'] }] },
        exists,
        standardText,
      ),
    ).toEqual({
      refused: [
        'ported code from Example names packages/core/src/gone.ts, which does not exist',
        'ported code from Example names ../outside.ts, which is not a path in the repository',
      ],
    });
  });

  it('refuses a port whose licence is off the allow-list, as a shipped package is refused', () => {
    expect(
      portedNoticesOf({ ported: [{ ...PORT, licence: 'GPL-3.0-only' }] }, exists, standardText),
    ).toEqual({
      refused: ['ported code from Example is licensed GPL-3.0-only: GPL-3.0-only is not allowed'],
    });
  });

  it('refuses a port that names no full commit, a moving branch, or no copyright lines', () => {
    expect(
      portedNoticesOf(
        { ported: [{ ...PORT, commit: 'main', copyright: ['Example Authors'] }, PORT, PORT] },
        exists,
        standardText,
      ),
    ).toEqual({
      refused: [
        'ported code from Example names no full commit hash',
        'ported code from Example lists its copyright as anything but lines stating one',
        'ported code from Example is listed twice',
        'ported code from Example is listed twice',
      ],
    });
  });

  it('writes the ports after the packages, sharing a licence text with a package that ships it', () => {
    const decided = portedNoticesOf({ ported: [PORT] }, exists, () => MIT_FILE);
    const [notice] = 'notices' in decided ? decided.notices : [];
    if (notice === undefined) throw new Error('The port was refused.');
    const rendered = renderNotices(
      [
        {
          name: 'shipped',
          version: '1.0.0',
          licence: 'MIT',
          copyright: [],
          texts: [notice.texts[0] ?? ''],
          standard: false,
        },
      ],
      [notice],
    );

    expect(rendered).toContain(
      '| [Example](https://example.com/example) | `0123456789abcdef0123456789abcdef01234567` | MIT | Copyright (c) 2020 Example Authors | Its transform. | `packages/core/src/transform.ts` | [1](#text-1) |',
    );
    expect(rendered).toContain('Shipped by shipped 1.0.0, the code ported from Example.');
    expect(rendered.match(/Permission is hereby granted/gu)).toHaveLength(1);
  });

  it('gives every port the committed list names its notice: each path exists and each licence is allowed', () => {
    const list: unknown = JSON.parse(readFileSync(PORTED_CODE, 'utf8'));
    const decided = portedNoticesOf(
      list,
      (path) => existsSync(inRepository(path)),
      (licence) => readFileSync(join(LICENCE_TEXTS, `${licence}.txt`), 'utf8'),
    );

    expect('refused' in decided ? decided.refused : []).toEqual([]);
  });
});
