#!/usr/bin/env node
/**
 * Refuses a build whose output carries anything a deployment must not.
 *
 * `apps/web/dist/` is what a static host uploads verbatim. Two things must
 * never be in it. A path from the machine that produced it: REQ-PRIV-161 treats
 * a local path as personal data, because it carries an account name and often a
 * machine name, and this repository is public, so a leak there is permanent.
 * And the address of an analytics or error-reporting service: REQ-PRIV-162
 * forbids usage analytics, and a dependency can bring the code that reports to
 * one in transitively, as the service worker generator can bring an analytics
 * module.
 *
 * No other gate looks at build output: a service worker's source map naming a
 * directory under the building account is invisible to lint, typecheck, the
 * unit suite and the architecture rules alike. Nor can any engine the browser
 * suite drives see a prefixed declaration the stylesheet transformer drops,
 * so the one Safari on a phone needs is held here as well.
 *
 * Usage:
 *   node tools/check-build-output.mjs             check apps/web/dist
 *   node tools/check-build-output.mjs <directory> check somewhere else
 *
 * Run by `pnpm build`, so a leak fails the build that produced it rather than
 * being found by whoever reads the deployment afterwards.
 */

import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir, tmpdir, userInfo } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { transform } from 'lightningcss';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * What a machine's directories and account name are found by.
 *
 * @typedef {object} Roots
 * @property {readonly RegExp[]} directories
 * @property {RegExp} [account]
 */

/**
 * One thing an artefact carries that a deployment must not, where it is found:
 * a path, a host an analytics service reports to, or a reason in words.
 *
 * @typedef {ProblemSite & (PathFound | HostFound | ReasonGiven)} Problem
 */

/**
 * Where a problem is found: the artefact, and the field of it.
 *
 * @typedef {object} ProblemSite
 * @property {string} file
 * @property {string} field
 */

/**
 * A path found where no path may be.
 *
 * @typedef {object} PathFound
 * @property {string} path
 */

/**
 * A host found that an analytics or error-reporting service reports to.
 *
 * @typedef {object} HostFound
 * @property {string} host
 */

/**
 * A problem said in words.
 *
 * @typedef {object} ReasonGiven
 * @property {string} reason
 */

/**
 * A source map, as far as the gate reads it: the fields that can only be
 * paths.
 *
 * @typedef {object} SourceMap
 * @property {unknown} [file]
 * @property {unknown} [sourceRoot]
 * @property {readonly unknown[]} [sources]
 */

/** Text extensions worth reading. Anything else is a font or an image. */
const TEXT_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.css',
  '.html',
  '.json',
  '.map',
  '.txt',
  '.webmanifest',
  '.xml',
  '.svg',
]);

/**
 * A regular expression that matches its argument literally.
 *
 * @param {string} text
 * @returns {string}
 */
function literal(text) {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/**
 * The directories this build ran in, in every form they could be written.
 *
 * Asking whether *this machine's* paths reached the output is the precise
 * question, and it has no false positives: a shape-matching rule over minified
 * third-party code would report `https://react.dev/` as a drive path and an
 * escaped `\\u00C0` as a share name. Every machine checks its own roots, so the
 * gate is as strong on a contributor's machine and on a build runner as it is
 * here.
 *
 * @returns {Roots}
 */
export function localRoots() {
  // The account name on its own, which is the part that identifies a person.
  /** @type {string | undefined} */
  let account;
  try {
    account = userInfo().username;
  } catch {
    // A container can have no passwd entry for the running user. The directory
    // roots still cover the paths that would carry the name.
    account = undefined;
  }
  return rootsOf([REPO_ROOT, process.cwd(), homedir(), tmpdir()], account);
}

/**
 * What a machine's directories and account name are found by, in every form
 * they could be written. The account is only counted when a separator
 * precedes it, so an account called `build` does not match the word.
 *
 * @param {readonly string[]} directories
 * @param {string | undefined} account
 * @returns {Roots}
 */
export function rootsOf(directories, account) {
  /** @type {Set<string>} */
  const forms = new Set();
  for (const root of directories) {
    if (root === '') continue;
    forms.add(root.replaceAll('\\', '/'));
    forms.add(root.replaceAll('/', '\\'));
  }

  return {
    // Matched case-insensitively: Windows paths are, and a bundler may
    // normalise a drive letter either way.
    directories: [...forms].map((form) => new RegExp(literal(form), 'gi')),
    ...(account === undefined || account.length < 3
      ? {}
      : { account: new RegExp(String.raw`[\\/]${literal(account)}(?=[\\/]|$|["'\s])`, 'gi') }),
  };
}

/**
 * An absolute filesystem path of any machine, for the path fields of a map.
 *
 * Applied only where a path is the only thing a value can be, so the shape
 * matching that is too loose for a minified bundle is exactly right here. A URL
 * is excluded twice over: a scheme's last letter is preceded by another letter,
 * and a scheme is followed by two separators rather than one.
 */
const ABSOLUTE_PATH_SHAPES = Object.freeze([
  /(?<![A-Za-z0-9])[A-Za-z]:[\\/](?![\\/])[^\s"'<>|*?]*/g,
  /(?<![\\/\w])\\\\[A-Za-z0-9][A-Za-z0-9._-]*\\[^\s"'<>|*?]+/g,
  /(?<![\w.])\/(?:home|Users|root)\/[^\s"'<>|*?:]+/g,
]);

/**
 * The services that collect usage or errors, by the hosts they report to.
 *
 * Matched as host names in any deployable text, because that is what reporting
 * code has to contain however it is minified. The module the service worker
 * generator can bring in writes to the first of these.
 */
const ANALYTICS_HOSTS = Object.freeze(
  /\b(?:[\w-]+\.)*(?:google-analytics\.com|analytics\.google\.com|googletagmanager\.com|doubleclick\.net|sentry\.io|bugsnag\.com|datadoghq\.(?:com|eu)|posthog\.com|hotjar\.(?:com|io)|fullstory\.com|mixpanel\.com|amplitude\.com|segment\.(?:com|io)|newrelic\.com|nr-data\.net|rollbar\.com|logrocket\.(?:com|io)|clarity\.ms|plausible\.io|statsigapi\.net|matomo\.cloud|umami\.is|heap(?:analytics)?\.com|countly\.com)\b/gi,
);

/**
 * Every analytics or error-reporting host named in a piece of text.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function analyticsHostsIn(text) {
  return [...text.matchAll(ANALYTICS_HOSTS)].map((match) => match[0]);
}

/**
 * Every trace of this machine in a piece of text.
 *
 * @param {string} text
 * @param {Roots} [roots]
 * @returns {string[]}
 */
export function localTracesIn(text, roots = localRoots()) {
  /** @type {string[]} */
  const found = [];
  for (const pattern of roots.directories) {
    for (const match of text.matchAll(pattern)) found.push(match[0]);
  }
  if (roots.account !== undefined) {
    for (const match of text.matchAll(roots.account)) found.push(match[0]);
  }
  return found;
}

/**
 * Every absolute path in a value that can only be a path.
 *
 * @param {string} value
 * @returns {string[]}
 */
export function absolutePathsIn(value) {
  return ABSOLUTE_PATH_SHAPES.flatMap((pattern) => [...value.matchAll(pattern)].map((m) => m[0]));
}

/**
 * The problems in one artefact.
 *
 * Two questions, because they have different answers. Any text may carry this
 * machine's own roots, including the `sourcesContent` of a map, which is where
 * a bundler inlines the store paths of the modules it read. Only the path
 * fields of a map are checked for an absolute path of *any* machine, because
 * that is the one place a path is the only thing a value can be.
 *
 * @param {string} name
 * @param {string} text
 * @param {Roots} [roots]
 * @returns {Problem[]}
 */
export function problemsIn(name, text, roots = localRoots()) {
  /** @type {Problem[]} */
  const problems = [
    ...localTracesIn(text, roots).map((path) => ({ file: name, field: 'contents', path })),
    ...analyticsHostsIn(text).map((host) => ({ file: name, field: 'contents', host })),
    ...(extname(name) !== '.map' && registersAWorker(text)
      ? [
          {
            file: name,
            field: 'contents',
            reason: 'registers a service worker, which this build does not ship',
          },
        ]
      : []),
  ];

  if (extname(name) !== '.map') return problems;

  /** @type {SourceMap} */
  let map;
  try {
    map = /** @type {SourceMap} */ (JSON.parse(text));
  } catch {
    return [
      ...problems,
      { file: name, field: 'contents', path: 'the file is not readable as a source map' },
    ];
  }

  /**
   * @param {string} field
   * @param {unknown} value
   */
  const check = (field, value) => {
    if (typeof value !== 'string') return;
    for (const path of absolutePathsIn(value)) problems.push({ file: name, field, path });
  };

  check('file', map.file);
  check('sourceRoot', map.sourceRoot);
  for (const [index, source] of (map.sources ?? []).entries()) {
    check(`sources[${String(index)}]`, source);
  }

  return problems;
}

/**
 * Every file under a directory, as paths relative to it.
 *
 * @param {string} root
 * @param {string} [prefix]
 * @returns {string[]}
 */
function filesUnder(root, prefix = '') {
  return readdirSync(join(root, prefix), { withFileTypes: true }).flatMap((entry) => {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    return entry.isDirectory() ? filesUnder(root, path) : [path];
  });
}

/**
 * Files no deployable build may contain.
 *
 * This phase ships no service worker: `vite-plugin-pwa` is disabled for the
 * build and a static manifest is shipped instead, because a precaching worker
 * that never activates its waiting version can serve an old application, and an
 * old application means old redaction rules (REQ-PWA-031, REQ-PRIV-161).
 * Offline hardening is Phase 12's, and when it arrives this rule is what it has
 * to change deliberately.
 */
const FORBIDDEN_FILES = /^(?:sw\.js|registerSW\.js|workbox-[\w.-]+\.js)$/;

/**
 * A call that registers a service worker, whatever the worker's file is called.
 *
 * The harm is a worker that activates, and that takes a registration in the
 * shipped script: a worker emitted as `service-worker.js`, as a hashed chunk,
 * or registered from the application's own bundle would pass a rule that read
 * file names alone. A source map is left out, because it quotes the source of
 * every module it maps, the registration helpers of a disabled plugin among
 * them.
 *
 * The spellings a script uses for the call: the container reached by a dot, by
 * optional chaining, by a quoted member or through `Reflect.get`, which is how
 * the capability probe reads it; `register` reached the same ways, or called
 * through `call`, `apply` or `bind`, or taken apart from the container; and a
 * name the container was given first, which a minifier produces. That name is
 * looked for only a little way after it is given: a minified bundle uses
 * one-letter names everywhere, and `e.register(` anywhere in it would fail
 * every build. A read of the container that is not a registration, such as
 * `"serviceWorker" in navigator`, is not one.
 *
 * A pattern can only list the spellings it knows. What is authoritative is the
 * browser suite, which asserts that a served build has no registration; this
 * gate stops a build that plainly has one before it is served.
 *
 * @param {string} text
 * @returns {boolean}
 */
function registersAWorker(text) {
  if (REGISTERED_ON_THE_CONTAINER.test(text) || REGISTER_TAKEN_APART.test(text)) return true;

  return [...text.matchAll(NAMED_CONTAINER)].some((given) => {
    // One of the two alternatives captured the name; the other is absent.
    const name = given[1] ?? given[2] ?? '';
    const after = text.slice(given.index, given.index + ALIAS_WINDOW);
    return new RegExp(`(?<![\\w$.])${escapeName(name)}${REGISTER_CALL}`).test(after);
  });
}

/** The worker container's name, written as a member, a quoted member or a string. */
const QUOTED_CONTAINER = '(?:"serviceWorker"|\'serviceWorker\'|`serviceWorker`)';

/** The worker container, however it is reached. */
const CONTAINER = `(?:\\bserviceWorker\\b|\\[\\s*${QUOTED_CONTAINER}\\s*\\]|\\bReflect\\s*\\.\\s*get\\s*\\([^()]*?${QUOTED_CONTAINER}\\s*\\))`;

/**
 * A member access naming `register`, called directly or through `call`,
 * `apply` or `bind`: `.register(`, `?.register(`, `["register"](`,
 * `.register.call(`.
 */
const REGISTER_CALL =
  '\\s*(?:(?:\\?\\.|\\.)\\s*register|(?:\\?\\.)?\\s*\\[\\s*(?:"register"|\'register\'|`register`)\\s*\\])(?:\\s*\\.\\s*(?:call|apply|bind))?\\s*(?:\\?\\.\\s*)?\\(';

/**
 * A name given the worker container: `c = navigator.serviceWorker`,
 * `c = Reflect.get(navigator, "serviceWorker")`,
 * `{ serviceWorker: c } = navigator`.
 */
const NAMED_CONTAINER = new RegExp(
  `([A-Za-z_$][\\w$]*)\\s*=\\s*(?:[A-Za-z_$][\\w$]*\\s*(?:\\?\\.|\\.)\\s*)*${CONTAINER}(?!\\s*(?:\\?\\.|\\.|\\[))|(?:\\bserviceWorker|${QUOTED_CONTAINER})\\s*:\\s*([A-Za-z_$][\\w$]*)`,
  'g',
);

/** `register` called on the container, however either is reached. */
const REGISTERED_ON_THE_CONTAINER = new RegExp(`${CONTAINER}${REGISTER_CALL}`);

/** `register` taken apart from the container: `const { register } = navigator.serviceWorker`. */
const REGISTER_TAKEN_APART = new RegExp(
  `\\{[^{}]*\\bregister\\b[^{}]*\\}\\s*=\\s*[^;]*?${CONTAINER}`,
);

/** How far after a name is given the container a registration through it is looked for. */
const ALIAS_WINDOW = 400;

/**
 * A name, safe to place inside a pattern.
 *
 * @param {string} name
 * @returns {string}
 */
function escapeName(name) {
  return name.replaceAll('$', '\\$');
}

/**
 * A name GitHub Pages would drop.
 *
 * Pages runs Jekyll unless `.nojekyll` is present, and Jekyll drops any file or
 * directory whose name begins with an underscore. Rollup names a shared helper
 * chunk that way, so one new dependency would turn the deployed site into a
 * blank page while every test here passed: the preview server the suite uses
 * serves whatever it is given.
 *
 * Deliberately redundant with the `.nojekyll` rule below: with that file in
 * place Jekyll never runs and an underscore is harmless, so this fails a build
 * only for a hazard already removed. It stays because the two failures it
 * guards against are silent, and a helper chunk renamed is cheaper than a blank
 * deployment if `.nojekyll` is ever lost.
 */
const JEKYLL_WOULD_DROP = /^_/;

/** The media types every screen is of. */
const EVERY_SCREEN = new Set(['all', 'screen']);

/**
 * Whether a stylesheet keeps the page's text at the size its rules give it on
 * Safari on an iPhone or iPad.
 *
 * Safari on a phone turned on its side enlarges text it judges too small, and
 * reads the rule that stops it only in its prefixed form,
 * `-webkit-text-size-adjust`. The design system writes that form beside the
 * unprefixed one, and the stylesheet transformer drops it from a build whose
 * floor names no engine that needs it; no engine the browser suite drives can
 * see the loss, since each reads the unprefixed form or neither. Read on
 * `html`, where the design system writes it, so it holds before a theme is
 * applied.
 *
 * The stylesheet is read by the parser of the transformer the build uses, as a
 * browser reads it, so a statement, a comment or a rule it cannot read before
 * the rule changes nothing. The declaration counts only where every screen
 * applies it: in a rule for `html` at the top of the stylesheet, in a cascade
 * layer, or in a media query every screen matches. Under any other condition
 * (print, a width, a feature or a container query), or in a rule nested in the
 * one for `html`, a phone may never apply it.
 *
 * @param {string} stylesheet
 * @returns {boolean}
 */
export function declaresTheTextSize(stylesheet) {
  return rulesOf(stylesheet).some(appliesTheTextSize);
}

/**
 * The top-level rules of a stylesheet, as the transformer's parser reads them.
 * A rule it cannot read is left out, as a browser leaves it out, rather than
 * failing the whole stylesheet.
 *
 * @param {string} stylesheet
 * @returns {readonly import('lightningcss').Rule[]}
 */
function rulesOf(stylesheet) {
  /** @type {readonly import('lightningcss').Rule[]} */
  let rules = [];
  transform({
    filename: 'stylesheet.css',
    code: Buffer.from(stylesheet),
    errorRecovery: true,
    visitor: {
      StyleSheet(parsed) {
        rules = parsed.rules;
      },
    },
  });
  return rules;
}

/**
 * Whether a rule applies the prefixed text-size declaration to `html` on every
 * screen.
 *
 * @param {import('lightningcss').Rule} rule
 * @returns {boolean}
 */
function appliesTheTextSize(rule) {
  switch (rule.type) {
    case 'style': {
      const { declarations = [], importantDeclarations = [] } = rule.value.declarations ?? {};
      return (
        rule.value.selectors.some(isHtml) &&
        [...declarations, ...importantDeclarations].some(isPrefixedTextSize)
      );
    }
    case 'media':
      return matchesEveryScreen(rule.value.query) && rule.value.rules.some(appliesTheTextSize);
    case 'layer-block':
      return rule.value.rules.some(appliesTheTextSize);
    default:
      return false;
  }
}

/**
 * Whether a selector is `html` alone.
 *
 * @param {import('lightningcss').Selector} selector
 * @returns {boolean}
 */
function isHtml(selector) {
  const [only] = selector;
  return selector.length === 1 && only?.type === 'type' && only.name === 'html';
}

/**
 * Whether a declaration is `-webkit-text-size-adjust: 100%`.
 *
 * @param {import('lightningcss').Declaration} declaration
 * @returns {boolean}
 */
function isPrefixedTextSize(declaration) {
  return (
    declaration.property === 'text-size-adjust' &&
    declaration.vendorPrefix.includes('webkit') &&
    declaration.value.type === 'percentage' &&
    declaration.value.value === 1
  );
}

/**
 * Whether every screen matches a media query list: an empty list, or one with
 * a query of every medium or of screens, with no condition and not negated.
 *
 * @param {import('lightningcss').MediaList} list
 * @returns {boolean}
 */
function matchesEveryScreen(list) {
  return (
    list.mediaQueries.length === 0 ||
    list.mediaQueries.some(
      (query) =>
        query.qualifier !== 'not' && query.condition == null && EVERY_SCREEN.has(query.mediaType),
    )
  );
}

/**
 * Checks every deployable artefact under a directory, for the roots of the
 * machine it runs on or for those it is given.
 *
 * @param {string} root
 * @param {Roots} [roots]
 * @returns {Problem[]}
 */
export function checkDirectory(root, roots = localRoots()) {
  const files = filesUnder(root);
  const texts = new Map(
    files
      .filter((name) => TEXT_EXTENSIONS.has(extname(name)))
      .map((name) => [name, readFileSync(join(root, name), 'utf8')]),
  );

  const forbidden = files
    .filter((name) => FORBIDDEN_FILES.test(name.split('/').at(-1) ?? ''))
    .map((name) => ({ file: name, field: 'name', reason: 'this build ships no service worker' }));

  const dropped = files
    .filter((name) => name.split('/').some((segment) => JEKYLL_WOULD_DROP.test(segment)))
    .map((name) => ({
      file: name,
      field: 'name',
      reason: 'a name beginning with an underscore is dropped by GitHub Pages',
    }));

  const missing = files.includes('.nojekyll')
    ? []
    : [
        {
          file: '.nojekyll',
          field: 'name',
          reason: 'is missing, so GitHub Pages would run Jekyll over this build',
        },
      ];

  const textSize = [...texts].some(
    ([name, text]) => extname(name) === '.css' && declaresTheTextSize(text),
  )
    ? []
    : [
        {
          file: '*.css',
          field: 'contents',
          reason:
            'none declares -webkit-text-size-adjust: 100% on html, the only text-size rule Safari on a phone reads',
        },
      ];

  return [
    ...forbidden,
    ...dropped,
    ...missing,
    ...textSize,
    ...[...texts].flatMap(([name, text]) => problemsIn(name, text, roots)),
  ];
}

/**
 * One line per problem, with each path reduced to its shape.
 *
 * The full path is what the gate found, and printing it puts the leak into a
 * terminal, a log and possibly a pasted transcript. The shape says which
 * artefact and which field to look at, which is what the reader needs. A host
 * is printed as it is, because it names a service rather than a person.
 *
 * @param {Problem} problem
 * @returns {string}
 */
function describe(problem) {
  if ('reason' in problem) {
    return `  ${problem.file} (${problem.field}): ${problem.reason}`;
  }
  if ('host' in problem) {
    return `  ${problem.file} (${problem.field}): reports to ${problem.host}`;
  }
  const shape = problem.path
    .replaceAll(/[A-Za-z0-9._~$%-]+/g, '<segment>')
    .replaceAll(/(?:<segment>[\\/]){2,}/g, '<segment>/…/');
  return `  ${problem.file} (${problem.field}): ${shape} [${String(problem.path.length)} characters]`;
}

/** The entry point, when this file is run rather than imported. */
function main() {
  const target = resolve(REPO_ROOT, process.argv[2] ?? 'apps/web/dist');

  try {
    statSync(target);
  } catch {
    console.error(
      `No build output at ${relative(REPO_ROOT, target).replaceAll('\\', '/')}. Run the build first.`,
    );
    process.exitCode = 1;
    return;
  }

  const problems = checkDirectory(target);
  if (problems.length === 0) {
    console.log(
      `Build output is free of local paths and analytics hosts: ${String(filesUnder(target).length)} files.`,
    );
    return;
  }

  console.error('The build output carries something a deployment must not:');
  for (const problem of problems) console.error(describe(problem));
  console.error(
    '\nA static host uploads this directory verbatim. A published path names the account that built it, and an analytics host is usage reporting, which AudioGubbins does not do.',
  );
  process.exitCode = 1;
}

// Compared as real paths: Node runs the file a link leads to but keeps the path
// it was given, so compared as written, a gate reached through a junction or a
// symbolic link would check nothing and exit zero.
if (
  process.argv[1] !== undefined &&
  realpathSync.native(process.argv[1]) === realpathSync.native(fileURLToPath(import.meta.url))
) {
  main();
}
