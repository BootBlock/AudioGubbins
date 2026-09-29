import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

import { previewRequestLog } from './preview-request-log.js';

/**
 * The AudioGubbins build.
 *
 * REQ-PWA-031 requires a local development server, hot reload, production
 * builds, static deployment, PWA development and GitHub Pages deployment. The
 * last of those is why the base path is configurable: a project site is served
 * from a subdirectory, and a build with an absolute base loads nothing there.
 * The browser suite builds and serves the application under a sub-path too, so
 * that claim is exercised rather than assumed.
 */

/**
 * The browsers the build is written for.
 *
 * REQ-PWA-028 names current Chrome, Edge, Firefox and Safari. These are the
 * first versions of each with everything the shell may use unconditionally,
 * Safari on an iPhone or iPad as well as on a Mac, one reason to a line:
 *
 * - `oklch()` colours;
 * - dynamic viewport units;
 * - the ES2023 array methods, which the keyboard layout (`toSorted`), the
 *   panel ordering (`toSpliced`) and the path finding (`findLastIndex`) call;
 * - lookbehind assertions, which the redaction, credential and path patterns
 *   are built from at module scope;
 * - range media queries, which the shell's narrow rule and the dialogue's
 *   short-page rule are written in.
 *
 * Stated rather than left to the bundler's default, so that syntax a
 * supported browser cannot parse is lowered, and CSS a supported browser
 * needs prefixed is prefixed, instead of either being decided by whatever the
 * tool assumed.
 *
 * Safari is named twice, as `safari` on a Mac and as `ios` on an iPhone or
 * iPad, at the one version, since each shipped every feature above in the same
 * release. The two read different prefixes, and the stylesheet transformer
 * drops a prefixed declaration that no browser named needs. Named for a Mac
 * alone, the build would drop `-webkit-text-size-adjust`, the only form of the
 * text-size rule Safari on a phone reads, because Safari on a Mac enlarges no
 * text for it to turn off.
 *
 * The compiler is given the ES2023 library, which is wider than this floor: it
 * also declares `Intl.Segmenter`, symbols as weak keys and the later
 * `Intl.NumberFormat` members, which Firefox 115 does not have, and the DOM
 * library declares every interface whatever a browser's version. The compiler
 * accepts a use of any of them. An architecture rule reads, with the compiler,
 * where the segmenter and the later number format members are used: the
 * segmenter behind its check in one module alone, and the members nowhere.
 * Symbols as weak keys, a value the later number format adds to an option it
 * had, and the DOM library are held by review, not by the rule.
 *
 * Lookbehind is the one whose loss costs most and the one a tool cannot cover:
 * neither esbuild nor Lightning CSS lowers a regular expression, and a
 * `new RegExp` a browser cannot parse throws while the module loads, so the
 * shell never starts — the same failure an unchecked `Intl.Segmenter` would
 * bring about. An architecture rule holds this list to the version each feature
 * needs, so the reasons cannot be read by nothing.
 *
 * The floor describes first-party code. The vendored docking stylesheet is
 * outside it: `workspace.css` imports the engine's own, which ships 22
 * `:has()` selectors, and Firefox did not support `:has()` until 121. Neither
 * esbuild nor Lightning CSS lowers it, so on Firefox 115 to 120 those
 * selectors are dropped whole. What they draw is the engine's own tab outline
 * and themes this build never selects; AudioGubbins' own focus ring is written
 * without `:has()` and still draws.
 */
const BROWSER_TARGETS = ['chrome111', 'edge111', 'firefox115', 'safari16.4', 'ios16.4'];

/**
 * What the page may load and where it may connect, enforced by the browser.
 *
 * AudioGubbins promises that nothing leaves the machine without the user's
 * express permission (REQ-PRIV-161) and that it reports no usage
 * (REQ-PRIV-162). The architecture tests hold the source to that; this holds
 * the running page to it, including code the source does not contain, such as a
 * compromised dependency or an injected script. `connect-src 'self'` is the
 * clause that matters: a request to any other origin is refused and reported.
 *
 * Styles allow inline text because the primitive library's scroll lock inserts
 * a style element at run time, and a static site cannot give it a per-response
 * nonce; scripts do not, and no inline script is emitted. `frame-ancestors` is
 * absent because a policy delivered in the page cannot set it.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

/** The element every policy is placed after. */
const CHARSET = '<meta charset="utf-8" />';

/**
 * Writes the policy into the built page, straight after the character set.
 *
 * The build only: the development server injects an inline script for hot
 * reload, which the policy rightly refuses, and development is not what a user
 * receives. As early as it can go, because a policy applies only to what
 * follows it, and after the character set, which has to come first.
 */
function contentSecurityPolicy(): Plugin {
  return {
    name: 'audiogubbins:content-security-policy',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: (html) => {
        if (!html.includes(CHARSET)) {
          // A page without the anchor would ship with no policy at all, and
          // nothing else would notice.
          throw new Error(`index.html has no ${CHARSET} to place the security policy after.`);
        }
        return html.replace(
          CHARSET,
          `${CHARSET}\n    <meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />`,
        );
      },
    },
  };
}

export default defineConfig(({ command }) => ({
  // A project site lives at /<repository>/, a user site and a local server at
  // /. Taking it from the environment means the same build configuration serves
  // both without a second file to keep in step.
  base: process.env['AUDIOGUBBINS_BASE'] ?? '/',

  plugins: [
    react(),

    VitePWA({
      /*
       * A service worker in development only.
       *
       * REQ-PWA-031 requires the progressive web app to be testable while it is
       * developed, which the development worker provides. The production build
       * ships none: a precaching worker is offline caching, which the Phase 01
       * packet leaves to the phase that hardens it (REQ-PWA-030), and without
       * that phase's update prompt and stale-cache recovery a precaching worker
       * would keep users on an old release.
       */
      disable: command === 'build',
      devOptions: { enabled: true, type: 'module' },

      // The development worker takes a new build as soon as it exists, which is
      // what a developer wants and what nothing has to be written to prompt
      // for.
      registerType: 'autoUpdate',

      // The manifest is a static file in `public/`, linked from the page, so
      // the production build keeps it without keeping the worker.
      manifest: false,

      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2}'],

        // No source map for the generated worker. The generator writes the
        // worker through a temporary directory, so the map's only source would
        // be an absolute path under the building machine's own account.
        sourcemap: false,
      },
    }),

    contentSecurityPolicy(),

    // The browser suite's record of what the preview server received and
    // answered, present only where the suite asks for it.
    previewRequestLog(),
  ],

  /*
   * The storage worker, built as a module of its own.
   *
   * ES modules, because the worker imports the storage packages as the page
   * does and a classic worker cannot split them into shared chunks; every
   * floor browser starts a module worker. Named after its content, as every
   * other chunk is, so a new release never meets a stale worker.
   */
  worker: {
    format: 'es' as const,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },

  build: {
    // Named after the content, so a browser can cache them indefinitely and a
    // new release is never served a stale chunk.
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },

    // Source maps in the production build. AudioGubbins is open source, the
    // sources are public anyway, and a diagnostic bundle with unreadable stack
    // frames is worth far less to whoever is investigating (REQ-PRIV-161).
    sourcemap: true,

    target: BROWSER_TARGETS,
    cssTarget: BROWSER_TARGETS,
  },

  server: {
    // Cross-origin isolation, which SharedArrayBuffer needs. Setting it in
    // development means the capability surface reports the same thing locally
    // as it will once the site is served with these headers (REQ-EXEC-216).
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
}));
