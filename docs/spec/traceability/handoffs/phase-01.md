# Phase Handoff Capsule — Phase 01

## Capability Delivered

AudioGubbins starts locally as a web shell over a pnpm and Cargo monorepo: a
docking workspace behind one adapter, themes and densities from perceptual
tokens with computed contrast, settings, a typed command boundary with a
palette, rebindable shortcuts and chords, capability reporting, local
structured diagnostics with redaction and no telemetry, an input model for
mouse, touch, pen and keyboard, and the architecture tests and deterministic
fixtures every later phase builds on. It edits no audio, and says so.

## Requirements Satisfied

Each owned requirement below is mapped to its implementation and its evidence
in `reviews/phase-01-evidence.md`, under "Requirement-to-evidence mapping",
with the referenced global requirements `REQ-EXEC-184` and `REQ-EXEC-216`. Two
are met with a recorded limit: `REQ-UX-057`, whose reflow below the declared
minimum width of 640 CSS pixels is owed to Phase 14 (F-574, F-689), and
`REQ-UX-067`, whose long press has no editing surface in this phase to open it
(F-188).

- `REQ-ARCH-004`
- `REQ-UX-005`
- `REQ-PROD-006`
- `REQ-PWA-031`
- `REQ-REPO-033`
- `REQ-ARCH-034`
- `REQ-PROD-056`
- `REQ-UX-057`
- `REQ-UX-058`
- `REQ-UX-059`
- `REQ-UX-060`
- `REQ-UX-066`
- `REQ-UX-067`
- `REQ-UX-068`
- `REQ-UX-069`
- `REQ-UX-070`
- `REQ-UX-071`
- `REQ-EDIT-072`
- `REQ-EDIT-073`
- `REQ-REPO-142`
- `REQ-ARCH-151`
- `REQ-ARCH-153`
- `REQ-REPO-154`
- `REQ-UX-155`
- `REQ-PRIV-161`
- `REQ-PRIV-162`
- `REQ-PRIV-164`
- `REQ-PRIV-165`
- `REQ-REPO-185`
- `REQ-REPO-186`
- `REQ-REPO-187`
- `REQ-REPO-191`

## Public Contracts Introduced or Changed

Every entry point's exported names, signatures and members are recorded in
`tests/architecture/public-contracts.txt`, which
`tests/architecture/public-contracts.test.ts` holds to the code; the evidence
lists each round's change to it.

- `@audiogubbins/commands`: command descriptor, execution result and refusal
  reason, registry, bus, transactions, shortcuts, chords, profiles, conflicts,
  palette ranking, platform reservations, and the export of a profile.
- `@audiogubbins/capabilities`: capability registry, feature requirement and
  degradation descriptor, late answers, the keyboard layout map and whether
  names can be compared.
- `@audiogubbins/design-system`: theme, density, motion and contrast preference
  schema, tokens, the theme provider and the accessible primitives.
- `@audiogubbins/workspace`: panel and layout API, six presets, the layout
  store, its reading of a stored layout and its recovery.
- `@audiogubbins/diagnostics`: diagnostic record schema, redaction contract,
  bounded log store and consented bundle.
- `@audiogubbins/input`: pointer sample, gesture, key press, and the readings of
  events they are built from.
- `@audiogubbins/text`: the rules for text a reader is shown, names and the
  identifiers they are held under (`ADR-0018`).
- `@audiogubbins/domain`: the non-authoritative domain value model
  (`ADR-0015`).
- `@audiogubbins/version`: the product and schema versions, generated from
  `version.json` (`ADR-0016`).
- `@audiogubbins/test-fixtures`: deterministic signals and projects, and the
  two measures the tests of cost share (`ADR-0019`).
- The public package dependency graph, declared in
  `tools/sync-workspace-graph.mjs` and asserted by
  `tests/architecture/dependency-rules.test.ts`.

## Persisted / Interchange Formats

- `userPreferences` 1, under `audiogubbins.preferences`.
- `workspaceLayout` 1, under `audiogubbins.workspace` and
  `audiogubbins.workspaces`, with `audiogubbins.workspace.unreadable`,
  `audiogubbins.workspaces.unreadable` and `audiogubbins.workspaces.recovered`.
- `shortcutProfile` 1, under `audiogubbins.shortcuts`, with
  `audiogubbins.shortcuts.unreadable`, and exported to a file in the same shape.
- `logVerbosity` 1, under `audiogubbins.verbosity`.
- `keyboardLayout` 1, under `audiogubbins.keyboard-layout`.
- `diagnosticBundle` 1, written to a file the user chooses and never kept.

## Invariants Downstream Agents Must Preserve

- The interface changes authoritative state only through the typed command
  boundary; the stores are partitioned and created in the composition root
  (`ADR-0011`, `ADR-0013`, `tests/architecture/command-route.test.ts`).
- Dockview is reached only through the workspace package's adapter, and Radix
  only through the design system's primitives (`ADR-0009`, `ADR-0010`).
- The docking engine's serialised form is never stored; a stored layout is
  parsed field by field before use.
- No network call, analytics or telemetry in production source; a diagnostic
  record's strings are redacted, and a bundle is described before consent.
- Colours live in the tokens; contrast is computed, never chosen.
- An identifier read from storage is kept only where it is AudioGubbins's own
  derivation within its store's bound; anything else is set aside with a
  notice, never lost silently.
- The layering the architecture rules and dependency-cruiser enforce, the
  package graph generated from its one declaration, and every test of cost held
  to the fixtures package's measures.
- British English in prose and user-facing text.

## ADRs

- `ADR-0009` — Design-System Boundary and Trigger Composition.
- `ADR-0010` — Workspace Layout Ownership.
- `ADR-0011` — Partitioned External Stores.
- `ADR-0012` — Perceptual Colour Tokens with Computed Contrast.
- `ADR-0013` — Command-First Shell Surfaces.
- `ADR-0014` — Shell Animation Deferred Until a Consumer Exists.
- `ADR-0015` — Phase 01 Owns the Non-Authoritative Domain Value Model.
- `ADR-0016` — The Version Registry Is Its Own Leaf Package.
- `ADR-0017` — The Input Model Is One Package, With Nothing of the Browser.
- `ADR-0018` — The Rules For Text A Reader Is Shown Are One Leaf Package.
- `ADR-0019` — The Text And Diagnostics Packages' Tests May Take The Test
  Fixtures Package.

## Verification Baselines

- `reviews/phase-01-evidence.md`, the evidence package, and
  `reviews/phase-01-review.md`, twenty-one review rounds, 1097 findings, each
  with its disposition.
- `pnpm run verify:commit`: lint, the forced typecheck, the unit suite, the
  record's titles and the cruise. The unit suite gave 2369 tests in 101 files
  over the code the phase commits.
- The browser suite, `pnpm run test:e2e`, nine Playwright projects: its last
  whole run, over the twentieth round's code, gave 900 passed and 22 skipped;
  it did not run whole over the twenty-first round's code, at the owner's
  decision on the gates, and the evidence names the focused runs that did.
- `cargo test --workspace`, 5 tests.
- `packages/test-fixtures`: deterministic signals and projects with
  provenance, and `relativeCost` and `comparisonsIn`, the measures every test
  of cost reads.
- `python tools/verify_hardening.py` and `sha256sum -c CHECKSUMS.sha256`, from
  `docs/spec/`.

## Intentionally Deferred Items

Only items explicitly authorised by the specification: none. What this phase
leaves to later ones is debt its review accepted, below.

## Accepted Non-Blocking Debt

Each item is a finding the review record tracks or accepts, or a part of one
fixed in this phase that its disposition leaves to a later one, with its owner;
the resume note, now `docs/todo/done/phase-01-application-foundation.md`,
carried this list until this capsule was written. No `BLOCKER`, `CRITICAL` or
`HIGH` finding is open. At the owner's decision in the twenty-first round, the
phase closed with that round's findings fixed and no further round of the
lenses; its browser mutations were not run, and three of its unit-suite
mutations were not proven, as its record gives.

- Phase 02: an inverse for deleting a workspace (F-123); offering every text set
  aside because it could not be read as an export, an entry stored under an
  identifier out of the shape one is derived in among them (F-1038), and letting
  the user discard it: the collection's and its copy's under
  `audiogubbins.workspaces.unreadable`, the mounted layout's under
  `audiogubbins.workspace.unreadable`, and the shortcut profiles' under
  `audiogubbins.shortcuts.unreadable`; and text too large to set aside, which is
  left in place, so its store's writes are withheld until it is discarded: the
  mounted layout's under `audiogubbins.workspace`, the workspace on screen not
  kept; the collection's under `audiogubbins.workspaces`, with its copy's under
  `audiogubbins.workspaces.recovered`, the workspaces saved not kept; and the
  shortcut profiles' under `audiogubbins.shortcuts`, the profiles not kept
  (F-206, F-305, F-401, F-496, F-973, F-993, F-1021); the export and the discard
  reachable before the quota is met, and a bound on each list set aside, with a
  notice when an old text is dropped, so the room the lists take never withholds
  every write unseen (F-401, F-1022); a cause and a remedy in the
  storage-failure notice (F-209); carrying these items into its packet (F-271).
- Phase 03: wrapping the bundle fields a computed capability key would carry
  (F-138); a branded log-category type, and the loggers made from the one list,
  as the audio engine adds categories (F-249, F-330).
- Phase 04: a group's scroll position kept across a rebuild of the dock, which
  the engine keeps and the adapter would restore once the contents are drawn;
  the Diagnostics panel's filter is kept already (F-304, F-560); the first
  surface that mounts the long-press context action, and its test (F-188,
  F-281); the first caller of `sampleFromPointerEvent` (F-218);
  a split of the main area kept across a remount (F-275); focus following a
  panel an arrangement command moved (F-283).
- Phase 05: one menu-parts factory for every menu (F-255); one `RunCommand`
  type taking a `CommandId`, the dock's `Run` among the signatures (F-256,
  F-468); a marker on a command that needs arguments from a dialogue, for the
  first such commands, the gain and the fade (F-302, F-562).
- Phase 09: a path rule that stops before a date or "and/or" (F-192);
  decoding a run of percent-encoded characters before the path rules read it,
  and a `data:` written with a space after its scheme (F-618).
- Phases 11 and 13: a seed is named in `ORDINARY_NAMES`, and logged as a
  field written out in place so the logged-field rule holds the name to it,
  since every other name that ends in `seed` is redacted and a generation
  seed is what reproduces a fault (F-883, F-928).
- Phase 12: an unregistering service worker for any browser an earlier
  deployment reached (F-139); the manifest's icons (F-133); gating the sub-path
  build in `pnpm build` (F-222); a worker gate that parses the bundle (F-367);
  asking the browser to keep the site's storage, telling a Safari user who has
  not put the application on the Home Screen that what it holds is removed after
  seven days of browsing without it, and offering the export before it is
  (F-1025).
- Phase 14: the repeated refusal's text asserted in the browser (F-107); stacked
  switches' touch targets in compact density (F-120); guarding the tab while the
  shortcut recorder listens, and the recorder's platform wiring (F-253, F-265);
  the Firefox skip premises held by a test, and reservation reasons that name
  their browser (F-276, F-277); the keyboard platform as one fact (F-317); what
  remains of the chord notice and reset (F-332); the redaction test's wall-clock
  limit (F-334); ChromeOS's own shortcuts, in the compatibility matrix of
  WU-14.A (F-412, F-459); a press checked with NVDA and JAWS in browse mode, and
  a Command press on macOS "Dvorak – QWERTY ⌘" on each engine (F-545, F-522);
  disabling a binding by the browser in force rather than by the union of the
  supported engines, with the reservation table split into what never arrives
  and what may not, a convention of its own for Android, which takes the Linux
  rows today and has no window manager to take them, and a case of its own for
  an installed window, which keeps nothing from the page in Chromium and has no
  address bar there or in a web app Safari installs on macOS, iOS or iPadOS,
  where what WebKit keeps has not been run (F-579, F-641, F-684, F-930, F-937);
  what Safari's own menus take before WebKit gives the page a press, which no
  Apple row stands on now (F-818, F-866); a refusal in a dialogue read with an
  on-screen keyboard up, on a phone and a tablet, where the footer that holds it
  is what the keyboard covers first, and placing the dialogue against the visual
  viewport if it is covered (F-867, F-898); a dialogue taller than the page,
  which scrolls as a whole, on a phone and a tablet: a finger's scroll of it on
  WebKit, which the tablet project cannot drive, and `85dvh` while a phone's
  browser toolbars show and hide (F-962); each text field focused on a real
  iPhone in Safari, and on iPadOS, in both densities, the palette's, the export
  dialogue's and the name field of Rename and Duplicate among them, to confirm
  the page does not zoom into it, which no engine the suite drives does (F-975),
  and the same iPhone turned on its side, in Safari, with a dialogue and the
  dock open, to confirm the text is drawn at the size the stylesheets give it
  and not enlarged, which the document asks for, in the prefixed form Safari on
  an iPhone reads, `-webkit-text-size-adjust: 100%`, which the build keeps and
  its gate holds, and which no engine the suite drives can show (F-1026,
  F-1034), and an iPad's reading of its own touch points, which the suite gives
  the tablet since Playwright's WebKit reports none (F-1093); the rule for names
  on Safari, on a Mac, an iPhone and an iPad, whose collation is Apple's and no
  engine the suite drives on Windows gives (F-1090); what Safari on an iPhone
  keeps of the site's storage after a week unused, installed on the Home Screen
  and not (F-1025); the WebKit hang, a test timed out loading the page or in its
  script in three of eight whole runs of the eighteenth round's code, its cause
  not found, with the browser matrix under load, and until then a run that meets
  it has its `test-results` copied aside and is diagnosed from the preview
  servers' request logs, which answer a client error as Node does and write the
  whole user agent and the header naming each request's project and test
  (F-1002, F-1035, F-1063); dropping a stored keyboard layout that was learned
  on another keyboard, on Firefox and Safari, which offer no layout map to tell
  one from another (F-622); whether WebKit suppresses the click it synthesises
  from a pencil tap as it does from a finger tap, which a pen driven through the
  Chrome DevTools Protocol cannot show (F-699); reading the layout map once for
  a return that fires two events, which the guard covers only while the read is
  in flight (F-645); a workspace that adapts to a narrow viewport rather than
  declining to draw one, which is `REQ-UX-029` and is the accepted half of F-574
  (F-689). Phase 14's packet does not carry these; this list does, and the
  handoff after it.
- The first pressure-sensitive tool: the gesture preference (F-65) and tilt in
  the pointer sample (F-130).
- Every phase after Phase 02: carrying the items above into its own packet as
  it starts (F-271).

## Downstream Readiness

- Phase 02 — Project and Storage System is `READY`.
- Phase 03 — Audio Engine Foundation is `READY`.
