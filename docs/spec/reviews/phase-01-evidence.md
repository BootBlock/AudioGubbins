# Phase 01 — Application Foundation — Evidence Package

Written to satisfy `REQ-EXEC-183`. It is an index to evidence a reviewer must
verify, not a substitute for inspecting the implementation.

Rewritten after the ninth review round and the remediation it caused. Every
number here was read from a run made against the tree this package describes:
the unit counts from a Vitest JSON report through `tools/count-tests.mjs`, the
browser counts from `playwright test --list` and a full run, the requirement
table's included. The reviews' own findings against earlier versions of this
file are named where they changed what it says.

## Phase identifier and objective

- **Phase:** 01 — Application Foundation.
- **Objective:** the production monorepo foundation, the web shell, the design
  system, the workspace infrastructure, the typed command boundary, the
  state-ownership model, the settings and diagnostics foundations, and the
  development and build tooling every later phase depends on.
- **User-visible outcome:** AudioGubbins starts locally as a shell with docking,
  themes, settings, command discovery, rebindable shortcuts and capability
  reporting. It does not edit audio, and it does not pretend to.

## Checklist

Every box in the phase packet's **In Scope** list is complete:

- pnpm and Cargo monorepo skeleton — `pnpm-workspace.yaml`, `Cargo.toml`,
  `crates/audiogubbins-version`.
- React, TypeScript and Vite shell — `apps/web`.
- Design-token and theme system — `packages/design-system/src/tokens`.
- Dockview behind a workspace abstraction — `packages/workspace`.
- Typed command bus and application boundary — `packages/commands`.
- Partitioned state model and lifecycle state machines — `apps/web/src/state`
  for the partitions; the chord tracker's discriminated outcome and the layout
  source resolution for the state machines. The packet's box names both halves
  and an earlier version of this line quoted only the first (F-85).
- Shortcut and command-palette infrastructure — `packages/commands`,
  `apps/web/src/input`, `apps/web/src/shell/command-palette.tsx`.
- Local structured diagnostics with no telemetry — `packages/diagnostics`.
- Input abstraction for mouse, touch, pen and keyboard — `packages/input`
  (`ADR-0017`), `tests/e2e/input.spec.ts`, `tests/e2e/touch.spec.ts`.
- Architecture tests and deterministic fixtures — `tests/architecture`,
  `packages/test-fixtures`.

Work units: WU-01.A through WU-01.E as the packet defines them, plus WU-01.F
(browser suites and the defects they found) and WU-01.G (the architecture
decision records).

## Files and packages materially changed

Ten TypeScript packages, one Rust crate, one application, the test suites and
the repository tooling:

| Package | What it owns |
| --- | --- |
| `packages/version` | The product version and the schema versions, generated from `version.json` (`ADR-0016`). A leaf with no dependencies. |
| `packages/domain` | Result and failure model, branded identifiers, sample time, channel layout, project, timeline, routing, parameters, effect chain, selection. No dependencies at all. |
| `packages/input` | Pointer samples, gestures, tool strength, key presses, and the reading of a pointer or key event into them (`ADR-0017`). Depends on `packages/text` alone, for the characters a reader sees (`ADR-0018`), and has no browser types. |
| `packages/text` | The rules a sentence shown to a reader, or read to one, is held to: the characters a reader sees and how many a text holds, the quoting of a stored or imported value, where a reason or a notice is cut, a reader's own text kept to a size, the shape of a name, when two names are one and whether the runtime can compare them by that rule, which entry of a list holds a name and the index of the names a list holds, the first free name, the identifier derived from a name, which leaves out the code points a reader sees nothing of, reads the Hangul fillers as a gap and numbers a stem Windows reserves for a device (F-1089), the shape an identifier read from storage is held to, the rule that holds identifiers within the bound in bytes each caller gives, and the count of the bytes a text takes in UTF-8 (F-1074), and the identifiers a list holds (`ADR-0018`). A leaf with no runtime dependency, held to it and to rendering nothing by the architecture rules; its tests take the fixtures package (`ADR-0019`). |
| `packages/diagnostics` | Log record, bounded store, diagnostic centre, redaction, consented bundle. Depends on `packages/version` and `packages/text`; its tests take the fixtures package (`ADR-0019`). |
| `packages/commands` | Command descriptor, registry, bus, transactions, shortcuts, chords, profiles, conflicts, palette ranking, the name of an exported profile's file and its ending, its identifiers held within 255 bytes less that ending (F-1074), and the code of a refusal of naming (F-1078). Its tests take the fixtures package, for the count of the comparisons of names (`ADR-0019`, F-1061). |
| `packages/capabilities` | Twenty capabilities, thirteen features, injected environment, browser probes including late answers, the keyboard layout map and whether names can be compared, degradation reporting. Depends on `packages/text`, whose check of the name rule it probes (F-1041). |
| `packages/design-system` | OKLCH tokens, contrast solver, theme provider, primitives, menu bar, control bar, overlays, stylesheets. |
| `packages/workspace` | Panel and layout contracts, six presets, layout store and recovery, its identifiers held to 227 bytes, a bound of storage (F-1074), and one route to each change it makes (F-1077), the single Dockview adapter. Its tests take the fixtures package, for the count of the comparisons of names (`ADR-0019`, F-1061). |
| `packages/test-fixtures` | Deterministic synthetic signals and projects, with provenance, and the two measures the tests of cost share, `relativeCost`, of processor time, and `comparisonsIn`, of the comparisons of names a piece of work makes, with the time a test of cost is allowed, `LONGEST_COST_TEST_MS`, 520 seconds, derived from the longest reading the measure allows, 12 seconds, and the ceiling of a count, `N_LOG_N_FOURFOLD`, 5.5 (`ADR-0019`, F-1033, F-1054, F-1061, F-1083, F-1097). |
| `apps/web` | Composition root, partitioned stores, shell commands, default shortcut profile, panels, palette, settings, status bar, Vite build. Its tests take the fixtures package, for the measure of processor time (`ADR-0019`, F-1033, F-1054). |
| `crates/audiogubbins-version` | The Rust half of the single version source. |

Repository tooling: `tools/sync-version.mjs`, `tools/sync-workspace-graph.mjs`,
`tools/count-tests.mjs`, `tools/check-record-titles.mjs`,
`.dependency-cruiser.cjs`, `eslint.config.js`, `vitest.config.ts`,
`playwright.config.ts`, and `apps/web/preview-request-log.ts`, the log of each
preview server's connections and requests a browser run asks for.

## New or changed public contracts

- Command descriptor, execution result and refusal reason
  (`@audiogubbins/commands`).
- Capability registry, feature requirement and degradation descriptor, with late
  answers for a probe that can only be asked asynchronously
  (`@audiogubbins/capabilities`).
- Theme, density, motion and contrast preference schema
  (`@audiogubbins/design-system`).
- Workspace panel and layout API, including floating placement, the one rule
  that keeps a docked group under the floating ones, a panel's title, and the
  reasons a layout operation is refused, asked apart from the operation
  (`@audiogubbins/workspace`).
- Diagnostic record schema and redaction contract (`@audiogubbins/diagnostics`).
- Pointer sample, gesture, key press and the event readings they are built from,
  including the keyboard platform that says whether AltGr is typing and whether
  Option types in a field, and the one rule for a press made in a field
  (`@audiogubbins/input`).
- Platform reservations, per keyboard convention and each with what takes the
  press, and a command that a gesture runs and the palette does not offer
  (`@audiogubbins/commands`).
- A menu group's label (`@audiogubbins/design-system`), and a log category as a
  checked identifier (`@audiogubbins/diagnostics`).
- What the user's keyboard layout types, where a shortcut written as a
  character goes on it and which press it is waiting for where it goes nowhere
  (`@audiogubbins/input`); the browser's layout map, and following one media
  query (`@audiogubbins/capabilities`); a chord still being pressed, written
  out (`@audiogubbins/commands`).
- A value quoted back in a sentence a reader is shown, cut to a length they can
  read, the cuts of a reason and a notice, the characters a reader sees and how
  many a text holds, a reader's own text kept to a size, the shape of a name a
  reader gives, which entry holds a name as a reader hears it and the index of
  the names a list holds, whether the runtime compares names by the rule, the
  name of a copy or of a workspace nobody named, and the identifier each
  workspace and profile is held under and whether a stored one is one the
  package gives (`@audiogubbins/text`); the measures the tests of cost share, of
  processor time and of the comparisons of names
  (`@audiogubbins/test-fixtures`); the longest reproduction note a report
  carries (`@audiogubbins/diagnostics`).
- Whether two arrangements hold the same panels in the same places, a
  workspace's name rule and the sentence for an identifier no workspace has
  (`@audiogubbins/workspace`).
- Product version and schema versions (`@audiogubbins/version`).
- Changed in the seventh round: `@audiogubbins/commands` gained `readProfile`,
  which reads a profile as it was written, and `unchanged`, a body's answer
  that it found nothing to do; `@audiogubbins/diagnostics` lost
  `DEFAULT_LOG_STORE_LIMITS` and `redactionRemovedSomething` from its index;
  `@audiogubbins/workspace` gained `NOTHING_DOCKED` and lost
  `leavesNothingDocked` (F-516).
- Changed in the eighth round: `@audiogubbins/commands` lost `importProfile` and
  gained `shortcutOffered`, what a menu or the palette may offer as a shortcut
  to press; `@audiogubbins/input` gained `characterName`, `couldBeTyped`,
  `withLearned` and the `TypedKey` type; `@audiogubbins/workspace` lost
  `NOTHING_DOCKED` and gained `layoutProblem`, its `LayoutProblem` type, whose
  kind a caller branches on, and `BUILT_IN_IS_NOT_DELETABLE`;
  `@audiogubbins/design-system` gained `accentLabel`; and
  `@audiogubbins/capabilities` gained the `keyboard-layout-map` capability key.
  `readProfile` refuses with `shortcut-profile` codes, which were
  `shortcut-import` codes. Three required members were added to exported
  contracts, which a caller or an implementer outside the package has to supply:
  `unchanged` takes a code before its reason and `UnchangedOutcome` carries it
  (`@audiogubbins/commands`), `KeyEventReading` carries `capsLock`
  (`@audiogubbins/input`), and `CapabilityEnvironment` carries
  `hasKeyboardLayoutMap` (`@audiogubbins/capabilities`). This line named none of
  them (F-528).
- Changed in the ninth round: `@audiogubbins/input` lost `browserKeyOf` and
  gained `browserPressOf`, a press read as the browser reads it, which can add
  Shift; `commandLayerOf`, what a Command press shows of the layout; and the
  `PressedWith` type, which `keyForCharacter` now takes where it took a
  boolean. `KeyboardLayout` gained the required `commandByPosition`,
  `keyboardLayout` takes it as a second argument, and `keyNameOn` takes a
  press, where it took a code. `@audiogubbins/commands` gained
  `usableProfile`, a profile with what the platform takes left out.
  `@audiogubbins/capabilities`' `askLateQuestions` takes the layout map as it
  was read.
- Changed in the tenth round: `@audiogubbins/input` gained `commandLayerUnread`,
  whether a character pressed with Command has no place while neither reading of
  the layout is settled, and `KeyboardLayout`'s `commandByPosition` became
  `boolean \| undefined`, where unread is its own answer and no longer `false`.
  `@audiogubbins/capabilities` gained the `LayoutMapPairs` type, which
  `askLateQuestions` already required and did not publish.
  `@audiogubbins/commands` lost `usableProfile` and gained `bindingsFor`, what
  the profile binds a command to, which the browser suite presses.
  `@audiogubbins/workspace` gained `sameLayout`, `nudgingProblem`,
  `withGroupNudged`, `reorderingProblem` and `withPanelReordered`, the two drags
  that had no keyboard alternative and the refusals asked apart from them.
  `@audiogubbins/diagnostics` gained `previewRedaction`, what a piece of free
  text will carry once it is redacted, and `RedactionReason` gained
  `NetworkAddress`, which every consumer of a redaction summary now sees.
  `@audiogubbins/domain` offers a second entry point, `./testing`, carrying the
  result helpers another package's tests take; the generator writes it wherever
  `src/testing/index.ts` exists.
- Changed in the eleventh round: `@audiogubbins/input` lost `commandLayerUnread`
  and `keyForCharacter` and gained `placeFor` and the `Placement` type, which
  says which wait a default is in where it has no key;
  `@audiogubbins/capabilities` gained `watchMediaQuery`;
  `@audiogubbins/diagnostics` gained `asQuoted` and `LONGEST_NOTE`;
  `@audiogubbins/design-system`'s `TextFieldProps` gained the optional
  `describedBy` and `maxLength`, which this line named neither of until the
  fifteenth round (F-860). The workspace package's six panel operations moved to
  modules of their own behind the same names.
- Changed in the twelfth round: `@audiogubbins/input` gained
  `settlesCommandLayer`, and a capability summary in a diagnostic bundle
  gained the optional `checking` flag (`@audiogubbins/diagnostics`).
  `@audiogubbins/diagnostics`' `previewRedaction` returns the text with how
  many values it removed, where it returned the text alone, and
  `@audiogubbins/design-system`'s `NoticeSurfaceProps` gained the optional
  `overDialogue`. This line named neither until the fifteenth round, when
  the rule below found the first and the lens the second (F-860).
- Changed in the thirteenth round: a new package, `@audiogubbins/text`, offering
  `oneCharacter`, `cutAtAWord`, `sentencesWithin`, `asQuoted` and the
  `SentencesTaken` type; `@audiogubbins/diagnostics` lost `asQuoted` to it;
  `@audiogubbins/input` lost `settlesCommandLayer`, gained `commandLayerKeys`,
  and offers a second entry point, `./testing`, with `keyEventOf`;
  `@audiogubbins/design-system` gained `usePublishedBlockSize`.
- Changed in the fourteenth round: `@audiogubbins/text` gained `longerThan` and
  `wholeCharactersWithin`, and `@audiogubbins/diagnostics` depends on it;
  `@audiogubbins/commands` gained `commandPressMayBeTaken`;
  `usePublishedBlockSize` lost its optional third argument
  (`@audiogubbins/design-system`). These lines were written for the tenth round
  and none after it until this one (F-812).
- Changed in the fifteenth round: `@audiogubbins/commands` gained
  `commandLayerKeyAsked`, the key the Command note asks a reader to press;
  `@audiogubbins/design-system` gained `NoticeProvider` and
  `NoticeProviderProps`, whose `notice` is required, and `NoticeSurfaceProps`
  lost `notice` and `overDialogue`. `NoticeProviderProps`' `children` is
  required too, and `NoticeSurface` and `ModalDialog` read their notice from
  an enclosing `NoticeProvider`, which this line named neither of until the
  sixteenth round (F-904).
- Changed in the sixteenth round: `@audiogubbins/commands` gained
  `profileNameProblem`, the one rule for a profile's name;
  `@audiogubbins/workspace` gained `LONGEST_WORKSPACE_NAME`; and
  `@audiogubbins/design-system` no longer offers `LiveRegion`, which
  `NoticeProvider` renders itself, and `NoticeSurface` and `ModalDialog` fail
  outside a provider. The record now writes a type alias's own parameters
  and each parameter's constraint and default, and the four types a
  published contract names that no entry point publishes: `ControlBarProps`,
  `DropdownMenuProps`, `FloatingPlacement` and `IconOnlyRequiresLabel`
  (F-908).
- Changed in the seventeenth round: the record writes every union, a nested one
  too, with its members in code-unit order, where it wrote them in the order the
  whole-program check first met them, so the line of every union not already in
  that order was written again, and no contract changed with it (F-935).
  `@audiogubbins/commands` no longer offers `profileNameProblem`, and
  `duplicateProfile` returns a `DomainResult<ShortcutProfile>`, refused by that
  rule, where it returned the copy under any name (F-942).
  `@audiogubbins/workspace` no longer offers `workspaceNameProblem`, and gained
  `nameOfACopy`, the name of a copy nobody named (F-936); `LayoutStore.save` and
  `LayoutStore.duplicate` refuse a name by that rule, and `duplicate` returns
  the reason it refused, where it returned `undefined` for a workspace it did
  not have (F-942).
- Changed in the eighteenth round: `@audiogubbins/text` gained `asName` and
  `NameProblem`, the shape of a name, which answers a name given without the
  space around it (F-978, F-971), `asWrittenName`, the same shape of a name in
  stored text, answered as it was written (F-971), `sameName` and
  `firstFreeName`, when two names are one and the first free name, and
  `firstFreeCopyName`, the first free name of a copy, a copy of a copy named in
  the series of the name before its word copy (F-971), and `freeIdentifier`, the
  identifier derived from a name (F-970), and no longer offers `longerThan`
  (F-978, F-982). `@audiogubbins/commands` no longer offers `readProfile`, and
  gained `importProfile`, which answers an `ImportedProfile`, the profile and
  the one whose name it was numbered apart from, and `restoreProfile`, a stored
  profile read under its identifier or beside the one that holds it (F-970,
  F-971); `duplicateProfile` takes the profiles held and a name or none, where
  it took an identifier and a name (F-970, F-971). `@audiogubbins/workspace`'s
  `LayoutStore.save` answers a `SavingProblem`, a refusal of its own kind, where
  it answered a sentence (F-981); `LayoutStore` gained `saveAs`, and its
  `duplicate` takes no identifier and a name or none, the store allocating the
  identifier of every layout it adds (F-970, F-971); the package gained
  `listedName`, the name the menu and the settings list a workspace under
  (F-971), and `placedLayouts`, with `PlacedLayouts`, the workspace on screen
  placed among the stored layouts, the stored one it is the same as where
  several share its identifier, or its own under a free one (F-970), and no
  longer offers `nameOfACopy`; and `ResolvedLayout` is a union whose recovered
  branch carries its reason, required, and the text that could not be used,
  where the reason was optional, which the record writes with `RecoveredLayout`,
  a type it names and no entry point publishes (F-968, F-983).
- Changed in the nineteenth round: `@audiogubbins/text` no longer offers
  `sameName` and `freeIdentifier`, and gained `holderOf`, the entry of a list,
  other than the one a name is being given to, whose name a reader hears as the
  name, and `identifiersHeldBy`, which answers `Identifiers`, the identifier for
  an entry added and for one read from storage, with the `Named` type they read
  (F-1012, F-1023); and `firstFreeCopyName` takes the word a copy adds from its
  caller, where it wrote an English word itself (F-1004).
  `@audiogubbins/commands` gained `profilesHeld`, the identifiers the profiles
  held hold, gathered once for a whole restore, and `restoreProfile` takes them
  where it took the profiles held (F-1023). `@audiogubbins/workspace` no longer
  offers `layoutProblem` and `isWorkspaceLayout`, and gained `readLayout`, which
  answers a `LayoutReading`, the layout built from the fields it checks or the
  problem that refuses it, so no caller asks twice (F-1010); `LayoutStore.save`
  takes an identifier and an arrangement, where it took a layout and with it a
  name (F-997); and `LayoutStore` no longer offers `renamingProblem`,
  `removalProblem` and `resetProblem`, and gained `renamable`, `removable` and
  `resettable`, each the layout an operation would act on or why it would be
  refused, while `rename`, `remove` and `reset` answer what they acted on, a
  rename the layout as it was and as it is, where they answered a refusal or
  nothing (F-1010). The record writes `RecoveredLayout` from
  `layout-reading.ts`, the module the reading of a stored layout moved to from
  `layout-store.ts` (F-1010).
- Changed in the twentieth round: `@audiogubbins/text` gained `isIdentifier`,
  whether a text is an identifier the package gives, within its bound, and
  `Identifiers.forStored` answers `string \| undefined`, none for a stored
  identifier it refuses, where it answered one for any (F-1038);
  `namesCanBeCompared`, whether the runtime compares names by the rule (F-1041);
  and `namesHeldBy`, which answers `NamesHeld`, the names a list holds, asked
  which entry holds a name and whether one is taken (F-1061).
  `@audiogubbins/commands` no longer offers `profilesHeld` and `restoreProfile`,
  which the line above gives, and gained `restoreProfiles`, which restores a
  stored list whole and answers each entry beside its result, with the
  `StoredProfileEntry` and `RestoredEntry` types (F-1045).
  `@audiogubbins/capabilities` gained the `name-comparison` capability key and
  its place in `LateAnswers`, the `NAMING` feature, and
  `CapabilityEnvironment.comparesNames`, a required member an implementer
  outside the package has to supply (F-1041). `@audiogubbins/workspace` gained
  `LayoutChange`, a change bound to the layout it acts on, which
  `LayoutStore.removable` and `resettable` answer where they answered the layout
  (F-1048). `@audiogubbins/test-fixtures` gained `relativeCost` (F-1033, F-1054)
  and `comparisonsIn` (F-1061).
- Changed in the twenty-first round: `@audiogubbins/text` no longer offers
  `identifiersHeldBy` and `isIdentifier`, and gained `identifierRule`, which
  takes the bound in bytes from its caller and answers an `IdentifierRule`, the
  two held to that bound, and `utf8Bytes`, the bytes a text takes in UTF-8
  (F-1074). `@audiogubbins/commands` gained `exportFileName`, the name of an
  exported profile's file, its ending included (F-1074), and
  `NAMES_CANNOT_BE_COMPARED`, the code of a refusal of naming (F-1078).
  `@audiogubbins/workspace`'s `LayoutChange`, which the line above gives, is
  `LayoutRemoval`, a removal alone, which `LayoutStore.removable` answers;
  `resettable` answers the layout as it ships, and `LayoutStore` no longer
  offers `remove` and `reset` (F-1077, F-1080). `@audiogubbins/test-fixtures`
  gained `LONGEST_COST_TEST_MS` and `N_LOG_N_FOURFOLD`, and `comparisonsIn`
  takes an optional ceiling (F-1083, F-1097).
- From the fifteenth round these lines are written from a rule, not from
  reading: `tests/architecture/public-contracts.test.ts` reads every entry point
  a manifest publishes with the compiler, and holds each exported name,
  signature, constant's type and interface member to
  `tests/architecture/public-contracts.txt`, so a change fails until the record
  is written again, and its diff is the round's line. Run over the commits that
  ended rounds ten to fourteen, it gives the eleventh to fourteenth rounds'
  lines (F-860, F-931).
- The public package dependency graph, declared in
  `tools/sync-workspace-graph.mjs` and asserted by
  `tests/architecture/dependency-rules.test.ts`. The Vitest project list is
  generated from the same declaration into `vitest.projects.json`, and
  `pnpm run graph:check` fails when it is stale.

Every package manifest and `tsconfig.json` is generated from that one
declaration; `pnpm run graph:check` fails if any is edited by hand.

## ADRs created and changed

- `ADR-0009` — design-system boundary and trigger composition.
- `ADR-0010` — workspace layout ownership.
- `ADR-0011` — partitioned external stores.
- `ADR-0012` — perceptual colour tokens with computed contrast.
- `ADR-0013` — command-first shell surfaces.
- `ADR-0014` — shell animation deferred until a consumer exists.
- `ADR-0015` — Phase 01 owns the non-authoritative domain value model.
- `ADR-0016` — the version registry is its own leaf package.
- `ADR-0017` — the input model is one package, with nothing of the browser.
- `ADR-0018` — the rules for text a reader is shown are one leaf package, which
  amends ADR-0017's clause that the input package depends on no other.
- `ADR-0019` — the tests of the text and diagnostics packages, and of every
  package no rule of its own governs, may take the test fixtures package, and
  those of the input and version packages may not, the domain package's cannot
  (F-1076); the two measures the tests of cost share live there, of processor
  time and of the comparisons of names, with the time a test of cost is allowed,
  520 seconds, derived from the longest reading the measure allows, 12 seconds,
  and the ceiling of a count, 5.5 (F-1033, F-1054, F-1061, F-1083, F-1097).

Changed after they were written, each in its own text:

- `ADR-0001` records that `ADR-0014` supersedes its animation clause (F-80).
- `ADR-0017` records that `GestureSettings` has no owner in the preference
  contract until a pressure-sensitive tool exists (F-65), and carries its
  amendment by `ADR-0018` in the clause it changes, where it had been a
  separate row (F-822).
- `ADR-0018` gained two rules and a consumer in the fourteenth round (F-813),
  and a count of a workspace's name in the fifteenth (F-864). Its Decision and
  Constraints clauses say so where they stand, which until the fifteenth round
  only a separate row did, and its Constraints clause states the criterion the
  package meets, the shape of text a reader is shown, where it said the package
  holds only what more than one reader needs (F-855). In the sixteenth round its
  fourteenth-round row says that a character longer than any real one counts
  once for each allowance it fills, and its Change record names the stored names
  its count now refuses, where it said the compatibility impact was none
  (F-902). In the seventeenth round its Decision says the workspace package cuts
  the name of a copy nobody named at a word with it, and its amendment row that
  the ellipsis a cut adds is counted inside the cut's bound, and that the cut at
  a word keeps a word the bound ends exactly at (F-936). In the eighteenth round
  its Decision says the package holds the cut at a word in characters, the shape
  of a name, when two names are one, the first free name, the first free name of
  a copy and the identifier derived from a name, and which of them the command
  layer and the workspace package read; its Constraints clause that the entry
  point offers eleven rules, and why an identifier is text a reader is shown;
  its Change record that a stored profile it refuses is set aside with a notice;
  and its Amended clause that the cut at a word keeps a word the cut ends
  exactly at, where it said the bound, and what the entry point offers since
  this round: a name given read without the space around it, a name in stored
  text read as it was written, and a copy of a copy named in the series of the
  name it copies (F-970, F-971, F-973, F-978, F-982, F-984). In the nineteenth
  round its Decision says the package holds which entry of a list holds a name
  and the identifier each entry is held under beside the others, which the
  command layer and the workspace package read in place of comparing names and
  numbering identifiers themselves (F-1012, F-1023); its Constraints clause
  records the package's review against the description test of G1, one
  responsibility, the rules for text a reader is shown, of which each of its
  eleven rules is one (F-1006); its Change record says that names cut by these
  rules and identifiers derived by them are stored, which it said no persisted
  format does, so a change to either changes what a later save writes and what a
  stored identifier or the name of the workspace on screen is read under where
  it clashes with one held, and its fourteenth-round clause that the command
  layer reads `longerThan` is marked superseded in the eighteenth (F-970,
  F-1006); and its Amended clause says that two names are compared by English
  collation with every option that decides whether two names are one stated,
  punctuation and digits compared as they are written, on every machine (F-999),
  that an identifier keeps the letters, marks and digits of every script
  (F-1001), and that the package that names a copy gives the word a copy adds
  (F-1004). In the twentieth round its Decision says the package holds the shape
  and bound an identifier read from storage is held to (F-1038), the names a
  list holds, asked as numbering asks, and whether the runtime compares names by
  the rule (F-1061, F-1041), that the capabilities package depends on the
  package to probe that check (F-1041), that the application reads it to quote
  the name of an exported profile's file and to ask whether names can be
  compared (F-1038, F-1041), and that its leaf clause is narrowed by `ADR-0019`
  for its tests alone (F-1033, F-1054); its Constraints clause that the entry
  point offers fourteen rules, ten of them built on its reading of the
  characters a reader sees (F-1038, F-1041, F-1061); its Change record that a
  profile or a workspace stored under an identifier out of that shape is left
  out with a notice (F-1038); and its Amended clause what `isIdentifier` holds,
  that the collation is checked at the first comparison and never as the package
  loads, what a runtime that fails it stops and what it does not, and how the
  names a list holds are sorted and asked (F-1038, F-1041, F-1061). In the
  twenty-first round its Decision says the package holds the shape of a stored
  identifier within the bound in bytes each caller gives, and the bytes a text
  takes, the command layer deriving its bound from the ending it writes after a
  profile's identifier and the workspace package holding 227 bytes, a bound of
  storage (F-1074), and that the application no longer quotes an exported file's
  name through the package, which cut it, nor asks it whether names can be
  compared (F-1069, F-1078); its Constraints clause that the entry point offers
  `identifierRule` and `utf8Bytes` where it offered `identifiersHeldBy` and
  `isIdentifier` (F-1074); and its Amended clause what an identifier leaves out,
  the code points a reader sees nothing of, how it reads the Hangul fillers, as
  a gap, and the stems Windows reserves for a device, numbered (F-1089), and
  that the collation is checked once, at the capability probe at the start or at
  the first comparison, whichever comes first, where it said the first
  comparison alone (F-1091). `ADR-0019` is retitled and narrowed to what the
  rules allow, the tests of the text and diagnostics packages taking the
  fixtures package and those of the input and version packages not, and names
  the standing rules that hold the edge (F-1070, F-1076); and it states the time
  a test of cost is allowed, derived from the measure's cap and the longest
  reading it allows, which the measure enforces, and the count's ceiling
  (F-1083, F-1097).

This section was headed "ADRs created" and listed none changed (F-871).

`ADR-0014` supersedes the animation clause of `ADR-0001`, which named Motion for
React. Motion is not installed, because nothing in this phase animates beyond a
CSS transition, and a dependency nothing imports is an install and a
supply-chain surface for no return. `ADR-0001` records the supersession in its
own text, which it did not when a reviewer found this package claiming that no
ADR was superseded two sentences after describing the change (F-80).
`ADR-0009` and `ADR-0010` state how the remaining libraries are contained, which
`ADR-0001` required but did not describe.

## Tests

2369 tests in 101 files across thirteen Vitest projects, and 5 Rust tests; the
browser suite last ran whole over the twentieth round's code, 922 tests in 9
Playwright projects, and not over this round's, at the owner's decision on the
gates. The launcher's own test, `tests/launcher.test.ts`, came with the launcher
added on this branch (`9e0fa4c` to `06f2b53`), and runs in the `repository`
project. Eleven of the thirteen projects are one per workspace package,
generated from the package declaration into `vitest.projects.json`; the other
two are `architecture` and `repository`, which are about no one package. A
version before the ninth round said twelve where the configuration defined
eleven (F-529); the list was written out by hand beside the declaration that
owns it, and `packages/version` belonged to no project at all (F-583).

| File | Tests |
| --- | --- |
| `apps/web/src/app.test.tsx` | 4 |
| `apps/web/src/commands/diagnostic-commands.test.ts` | 22 |
| `apps/web/src/commands/shell-commands.test.ts` | 156 |
| `apps/web/src/commands/shortcut-commands.test.ts` | 32 |
| `apps/web/src/commands/voiced-execution.test.ts` | 9 |
| `apps/web/src/commands/workspace-commands.test.ts` | 55 |
| `apps/web/src/composition-wiring.test.ts` | 4 |
| `apps/web/src/dock-rearrangement.test.ts` | 2 |
| `apps/web/src/dock-wiring.test.tsx` | 3 |
| `apps/web/src/input/use-shortcuts.test.ts` | 14 |
| `apps/web/src/keyboard-wiring.test.tsx` | 11 |
| `apps/web/src/main.test.tsx` | 3 |
| `apps/web/src/shell/command-palette.test.tsx` | 3 |
| `apps/web/src/shell/failure-boundary.test.tsx` | 5 |
| `apps/web/src/shell/menus.test.ts` | 6 |
| `apps/web/src/shell/palette-navigation.test.ts` | 4 |
| `apps/web/src/shell/panels.test.tsx` | 19 |
| `apps/web/src/shell/pre-paint.test.ts` | 4 |
| `apps/web/src/shell/settings/shortcut-recorder.test.tsx` | 3 |
| `apps/web/src/shell/settings/shortcuts.test.tsx` | 26 |
| `apps/web/src/shell/settings/workspaces.test.tsx` | 14 |
| `apps/web/src/shell/status-bar.test.tsx` | 11 |
| `apps/web/src/shell/use-contrast-warning.test.ts` | 2 |
| `apps/web/src/shell/use-recovery-announcement.test.tsx` | 12 |
| `apps/web/src/shell/use-workspace-width.test.ts` | 9 |
| `apps/web/src/state/interaction-store.test.ts` | 2 |
| `apps/web/src/state/keyboard-convention.test.ts` | 8 |
| `apps/web/src/state/keyboard-layout-store.test.ts` | 23 |
| `apps/web/src/state/layout-map-watch.test.ts` | 5 |
| `apps/web/src/state/shortcut-store.test.ts` | 19 |
| `apps/web/src/state/state-storage.test.ts` | 15 |
| `apps/web/src/state/stored-value.test.ts` | 2 |
| `apps/web/src/state/workspace-store.test.ts` | 54 |
| `packages/capabilities/src/browser-environment.test.ts` | 41 |
| `packages/capabilities/src/keyboard-layout-map.test.ts` | 3 |
| `packages/capabilities/src/registry.test.ts` | 36 |
| `packages/commands/src/chord-tracker.test.ts` | 13 |
| `packages/commands/src/held-profiles.test.ts` | 27 |
| `packages/commands/src/palette.test.ts` | 21 |
| `packages/commands/src/platform-reservations.test.ts` | 147 |
| `packages/commands/src/profile-editing.test.ts` | 8 |
| `packages/commands/src/registry.test.ts` | 36 |
| `packages/commands/src/shortcut-transfer.test.ts` | 35 |
| `packages/commands/src/shortcut.test.ts` | 27 |
| `packages/design-system/src/primitives/announcements.test.tsx` | 28 |
| `packages/design-system/src/primitives/context-actions.test.tsx` | 1 |
| `packages/design-system/src/primitives/primitives.test.tsx` | 41 |
| `packages/design-system/src/theme/theme-provider.test.tsx` | 7 |
| `packages/design-system/src/tokens/colour.test.ts` | 44 |
| `packages/design-system/src/tokens/theme.test.ts` | 54 |
| `packages/diagnostics/src/bundle.test.ts` | 21 |
| `packages/diagnostics/src/log-store.test.ts` | 18 |
| `packages/diagnostics/src/logger.test.ts` | 27 |
| `packages/diagnostics/src/redaction.test.ts` | 139 |
| `packages/domain/src/audio/channel-layout.test.ts` | 18 |
| `packages/domain/src/identity/id-generator.test.ts` | 13 |
| `packages/domain/src/processing/effect-chain.test.ts` | 17 |
| `packages/domain/src/processing/parameter.test.ts` | 16 |
| `packages/domain/src/project/project.test.ts` | 15 |
| `packages/domain/src/project/routing.test.ts` | 11 |
| `packages/domain/src/project/timeline.test.ts` | 15 |
| `packages/domain/src/result.test.ts` | 16 |
| `packages/domain/src/selection/selection.test.ts` | 12 |
| `packages/domain/src/time/sample-time.test.ts` | 26 |
| `packages/input/src/keyboard-layout.test.ts` | 31 |
| `packages/input/src/keyboard.test.ts` | 20 |
| `packages/input/src/pointer.test.ts` | 25 |
| `packages/test-fixtures/src/comparisons.test.ts` | 6 |
| `packages/test-fixtures/src/processor-cost.test.ts` | 7 |
| `packages/test-fixtures/src/projects.test.ts` | 15 |
| `packages/test-fixtures/src/signals.test.ts` | 82 |
| `packages/text/src/cutting.test.ts` | 27 |
| `packages/text/src/graphemes.test.ts` | 13 |
| `packages/text/src/holders.test.ts` | 13 |
| `packages/text/src/identifiers.test.ts` | 26 |
| `packages/text/src/names.test.ts` | 28 |
| `packages/text/src/quoting.test.ts` | 6 |
| `packages/workspace/src/adapter/baseline.test.ts` | 2 |
| `packages/workspace/src/adapter/coalescer.test.ts` | 8 |
| `packages/workspace/src/adapter/dockview-adapter.test.tsx` | 8 |
| `packages/workspace/src/adapter/geometry.test.ts` | 37 |
| `packages/workspace/src/layout-store.test.ts` | 114 |
| `packages/workspace/src/panel.test.ts` | 42 |
| `packages/workspace/src/same-arrangement.test.ts` | 5 |
| `tests/agent-guide-budget.test.ts` | 3 |
| `tests/architecture/browser-floor.test.ts` | 16 |
| `tests/architecture/browser-suite.test.ts` | 9 |
| `tests/architecture/command-route.test.ts` | 6 |
| `tests/architecture/dependency-rules.test.ts` | 182 |
| `tests/architecture/module-exports.test.ts` | 6 |
| `tests/architecture/package-exports.test.ts` | 16 |
| `tests/architecture/public-contracts.test.ts` | 3 |
| `tests/browser-suite-servers.test.ts` | 2 |
| `tests/build-output.test.ts` | 47 |
| `tests/comment-width.test.ts` | 10 |
| `tests/document-width.test.ts` | 3 |
| `tests/evidence-commands.test.ts` | 3 |
| `tests/launcher.test.ts` | 9 |
| `tests/preview-request-log.test.ts` | 17 |
| `tests/record-titles.test.ts` | 24 |
| `tests/repository-settings.test.ts` | 4 |

Browser projects, counted from the report of the last whole run, `e2e-s22-2`,
over the twentieth round's code: `chromium-smoke` 108, `chromium-accessibility`
72, `chromium-input` 19, `firefox` 180, `webkit` 180, `chromium-scaled` 180,
`firefox-text-110` 61, `tablet` 119, `pages` 3, which is 922. The suite did not
run whole over this round's code, at the owner's decision on the gates, so these
figures stand for the twentieth round's code alone; the tests this round added
to it ran only as the results below name.

Every assertion added while closing a review finding was proved against the code
it guards — the defect was put back, or the test was run against the code before
the fix, and the new assertion was seen to fail — or the row that carries it
says why it is coverage rather than proof, and what holds the property instead.
From the fourth round on, the review record's disposition for each finding names
the mutation its test was proved with, or says it has none and why. Stated
without that second half, this paragraph was wider than the rows beneath it: the
twelfth round called three of its own additions coverage, and six more new tests
carried no mutation (F-784). This paragraph used to say each commit named its
mutation, and none did (F-244); the third round's proofs were recorded nowhere a
reviewer could repeat them, which is how two of its tests were found to hold a
helper rather than the code that had the defect (F-243).

The twenty-first round's rows say where a proof was not run or not made: at the
owner's decision on the gates its mutations in a browser were not run, and three
of its entries of the unit suite were not proven, each named in the row it
belongs to.

## Commands used for verification

```
pnpm run lint               # pnpm run version:check, pnpm run graph:check, pnpm run notices:check, eslint ., prettier --check .
pnpm run typecheck          # tsc --build tsconfig.build.json, then tsc -p tsconfig.json
pnpm run typecheck:full     # tsc --build --force tsconfig.build.json, then tsc -p tsconfig.json
pnpm run test               # vitest run --reporter=default --reporter=json --outputFile.json=node_modules/.cache/audiogubbins/vitest-report.json
pnpm run record:check       # node tools/check-record-titles.mjs, every test a disposition names, against the run
pnpm run test:dependencies  # depcruise --config .dependency-cruiser.cjs apps packages tests tools
pnpm run test:architecture  # pnpm run test:dependencies, then vitest run --project architecture
pnpm run test:e2e           # playwright test, every project
pnpm run test:e2e:smoke     # playwright test --project=chromium-smoke
pnpm run verify:commit      # pnpm run lint, pnpm run typecheck:full, pnpm run test, pnpm run record:check, pnpm run test:dependencies
pnpm run verify:integration # pnpm run verify:commit, pnpm run build, pnpm run test:e2e
cargo test --workspace
python docs/spec/tools/verify_hardening.py
sha256sum -c docs/spec/CHECKSUMS.sha256
```

## Results

| Check | Result |
| --- | --- |
| `pnpm run lint` | Pass over the code this round commits, before its docs were written, `lint-s23-packets.log`: version and graph current, ESLint clean, Prettier clean. ESLint and Prettier leave out every directory the cruise excludes, the development server's output among them, which a rule holds, since the twenty-first round, when ESLint read that output and failed the gate on work nobody had done. |
| `pnpm run typecheck` | Pass. TypeScript 5.9.3 with `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax` and `erasableSyntaxOnly`. The everyday typecheck builds incrementally; the gates of a commit and of an integration run `pnpm run typecheck:full`, which forces the whole build, and a rule holds the forced step in each gate and the unforced one out of them, where until the twentieth round the gate of a commit ran the incremental build (F-1057). It compiles the configuration files at the root and directly in each application folder as well, `vite.config.ts`, `playwright.config.ts`, `vitest.config.ts` and the preview servers' request log among them, through the root `tsconfig.json`, and a rule holds its list of files; and the root project compiles and checks the two tools a test imports, `tools/check-build-output.mjs` and `tools/check-record-titles.mjs`, their types written in comments, with no declaration beside them, which a rule holds as well, where the test audit merged as `dc60556` gave them declarations written by hand that nothing held to the code (F-1046). Both passed over the code this round commits, as the session's checks after the fix packets record. Until the nineteenth round nothing typechecked the configuration files: the root project failed under the compiler at once, with TS5069, and served only the type-aware linter, which was found while the request log F-1002 needed was being written. |
| `pnpm run test` | 2369 passed, 0 failed, 101 files, read from the JSON report of a run over the code this round commits, tree `c64be2ba`, with the rule of the project's guide to agents on what verified means brought to the owner's decision on the gates, started at 19:51:47 UTC, before this version of the docs, which is kept beside this round's proof log as `vitest-r21-docs1.json`; the docs are read by tests of the repository and architecture projects, and no figure of a run of the suite after this version is given here, since none had run when this was written. The round's runs before it, over the code as it then stood, are kept beside it as text logs: over `662a255`, before anything changed, 2304 passed in 101 files, `vitest-s23-start.log`; after the first three fix packets, 2340 passed and 1 failed, `vitest-s23-wave1.log`; after eight, 2356 passed and 2 failed, `vitest-s23-wave2.log`, the second a test of the measure of cost whose premise a step of the clock broke in a whole run, since fixed (F-1082); and after all fourteen, 2368 passed and 1 failed, `vitest-s23-packets.log`; the test that failed each time being the one that holds this package's commands to the manifest, which failed by design until their block was written again with each step in full (F-1067). The twentieth round's figure, 2304 in 101 files, was read from `vitest-r20-docs9.json`, over the tree it committed outside the docs, and its record gives the runs before and after it. The nineteenth round's figure, 2217 in 96 files, was read from `vitest-r19-docs15.json`, over the tree it committed outside the docs, and its record gives the runs before and after it. The eighteenth round's figure, 2157 in 93 files, was read from `vitest-r18-docs7.json`, over the tree it committed outside the docs; two verifications of its commit that its record placed after that run ran before it, and only the third followed it (F-1000). The seventeenth round's figure was read from a report taken before its last change outside the docs, the usage example of `tools/check-record-titles.mjs` fenced by hand after its re-flow had joined it into prose; the runs over its committed tree were the text log of the commit's verification, which gave the same count, and a second full browser run (F-969). The sixteenth round's figure was read from a report taken before its last edits to test files; the only run over its committed tree was the text log of the commit's verification, which gave the same count (F-967). The thirteenth round's figure rested on a run whose report was not kept, and the report it did keep recorded a failure (F-845). |
| `pnpm run record:check` | Pass: every one of 1879 cited titles, which is the checker's count of every title a disposition names and every other string of three words or more in double quotes or backticks, is a title a run reports, a title the record lists with the one its test has now, or quoted text it lists as prose. The fifteenth round gave its count of 572 as a count of quoted strings, which it is not (F-918). Until the fifteenth round it read a title only after the words it knew, and passed nine citations in eight rows that quote a title's start (F-849). |
| `pnpm run test:architecture` | Pass. dependency-cruiser: no violations, 329 modules and 1237 dependencies, over `apps`, `packages`, `tests` and `tools`, read from the cruise run over the code this round commits, `deps-s23-packets.log`, where the code at `662a255`, with Lightning CSS added, gave 323 and 1215, in `deps-s23-setup.log`; the control run of this round's cruise, over the code the round commits, cruised 329 modules too, and counts no dependencies; it read `apps packages tools` alone until the tenth round, so nothing stopped a browser test importing the docking engine (F-582). The gate of a commit, `pnpm run verify:commit`, runs the cruise as `test:dependencies`, its last step, and the architecture project inside `pnpm run test`, as the commands above give (F-1032). Architecture project: 238 passed, in 7 files, read from `vitest-r21-docs1.json`. |
| `pnpm run test:e2e` | Not run over this round's code, at the owner's decision on the gates, under which the browser suite is no gate of a change and the phase closed with no whole run of it: its last whole run is the twentieth round's, whose figures below stand for that round's code alone. The tests this round wrote or changed ran with nothing put back, each kept beside its proof log and none naming its tree: the sibling of the ring beside a classic scrollbar, for the status bar's ring, ten times of ten on `chromium-accessibility`, `p7-first-bar-scrollbar-1.log` (F-1075); the test that the report a tablet saves names iPadOS, five of five on `tablet` once the suite gave the page its touch points, `p7b-tablet-test-1.log`, where it failed five of five before, `p7-first-tablet-1.log`, and then the whole `tablet` project, 120 passed and 2 skipped, `p7b-tablet-project-1.log` (F-1093); the accessibility spec's tests the round wrote or changed, 15 passed and 3 skipped, `p7-a11y-new-1.log`; and the two tests of the rule for names, 10 passed on the five projects that run the smoke spec, `p7-names-1.log` (F-1090). The twentieth round's figure: 900 passed, 22 skipped, 0 failed, 9 projects, in `e2e-s22-2`, started at 14:55:44 UTC over `520c2a9d`, the code before a second reading of what changed was answered, whose build is that of the code this round commits in every file but the source map, which carries the comments that reading changed, so that it stands for that code at the owner's decision on re-runs, and kept beside this round's proof log with its log and the request logs of both preview servers. Skipped are seven tests on Firefox, the five system-preference tests, the test of the size the text is drawn at and the ring beside a classic scrollbar; eleven on WebKit, the nine forced-colours tests, that test and the ring beside a classic scrollbar; one on `chromium-scaled`, the ring beside a classic scrollbar, which the test reads on `chromium-accessibility` alone, in a Chromium of its own that draws its scrollbars (F-1064); one on `firefox-text-110`, the audit while the system asks for more contrast; and two on the tablet, a finger's scroll of a dialogue and the test of the size the text is drawn at; each with the reason recorded below. The request log of the application's server holds 3849 requests, each finished, and every request but the server's own question whether it was ready, before any test, carries the whole user agent, each engine's and the tablet's its own, and the header naming its project and test; the pages server's holds 14, each finished; and each of the 521 client errors the application's server's log holds is a connection the browser reset, which Node does not answer either, the pages server's holding none (F-1035, F-1063). `e2e-s21-1`, started at 20:37:19 UTC over the code before a clause no test could see was deleted from `isIdentifier`, `e2e-s21-2`, started at 21:55:46 UTC over the code before the measure of cost was changed, and `e2e-s22-1`, started at 12:26:39 UTC over the code before a reading of the whole change before its commit was answered, each gave what `e2e-s22-2` gives, project by project, with 551, 508 and 469 client errors in their logs, each a reset connection, and are superseded, since the code changed after them. No whole run of this round met the WebKit hang, which the nineteenth round diagnosed without finding its cause; it is one open item, owed to Phase 14 with the browser matrix under load, and every run keeps both preview servers' output in its log and, where the suite names a file, as `pnpm run test:e2e` does, a log of each server's connections, requests and responses in `test-results`, which a run that meets the hang copies aside (F-1002). The nineteenth round's figure, 871 passed and 18 skipped, is `e2e-s19-6`'s, over the tree it committed outside the docs, and its record gives the runs before it and the diagnosis. The eighteenth round's figure, 850 passed and 13 skipped, is `e2e-s14-3`'s, over a tree that differs from the one it committed outside the docs in five files no browser test reads (F-1028). The seventeenth round took two full runs, the first before the usage example of `tools/check-record-titles.mjs` was fenced and the second, `e2e-r17-full-2`, after it, over the tree it committed, each 821 passed and 13 skipped, and gave the first alone (F-969). One full run over the sixteenth round's committed tree failed two Firefox tests with a page crash, both in the group that resizes the window, and was run again; the figure the sixteenth round gave is the second run's, and its report of the first, `e2e-r16-crash.log`, is kept beside the sixteenth round's proof log (F-938). The seventeenth round ran the Firefox project six times, three with its text scale pinned and three without, with no crash, and every run of the whole suite this round ran both Firefox projects with none. |
| `cargo test --workspace` | 5 passed, in the twentieth round's run; this round changed no Rust, no Cargo file and not `version.json`, and did not run it. |
| `verify_hardening.py` | Pass: lint, reproducible compiled specification, reproducible context packs. |
| `sha256sum -c CHECKSUMS.sha256` | Pass, 102 files, this package, both ADRs this round changed and the phase's handoff capsule, new in this round, among them. It was the one file under `docs/spec/` missing from the list while this table reported the check passing (F-79). |

Tool versions: Node 26.7.0, pnpm 12.4.2, Playwright 1.63.0, Vitest 5.0.1,
TypeScript 5.9.3, React 19.3.0, Vite 8.3.0, and Lightning CSS 1.33.0, a
development dependency of the root since the twenty-first round, pinned to the
version Vite 8.3.0 resolves, with which the build's gate parses the stylesheets
it builds (F-1092).

## Browser and device results

| Project | Engine | Suite | Result |
| --- | --- | --- | --- |
| `chromium-smoke` | Chromium, Desktop Chrome | Shell, themes, palette, settings, shortcuts, workspace, rearranging, the declared minimum width and what the settings and the palette do below it, what the shipped document says, the whole ring of a button in the status bar, the size the text is drawn at, diagnostics | 108 passed |
| `chromium-accessibility` | Chromium, Desktop Chrome | axe over eleven states and every tab of the settings, forced colours, the focus ring on a highlighted entry in a menu, a select list and the palette, a notice clear of the status bar, a refusal shown in an open dialogue's own flow, the text a floating surface is written in, the size of a field's text where no finger is among the inputs, the whole of a long refusal reached by the keys, the dock's own cues, its tabs and a group's contents from the keyboard with the whole ring, the tab a group shows marked while it holds focus, the whole ring on contents that scroll beside a classic scrollbar, read in a Chromium of its own that draws its scrollbars, the advice on making room reached from the keyboard, live regions, reduced motion, system preferences | 72 passed |
| `chromium-input` | Chromium with touch | Mouse, keyboard, pen, including a palette row tapped with one, safe-area insets, and the touch suite, with a finger's scroll of a dialogue taller than the page and the size of every field a finger types into | 19 passed |
| `firefox` | Firefox, Desktop Firefox, its text scale and its pointers pinned | Smoke and accessibility | 173 passed, 7 skipped |
| `webkit` | WebKit, Desktop Safari | Smoke and accessibility | 169 passed, 11 skipped |
| `chromium-scaled` | Chromium, Desktop Chrome at a device pixel ratio of 1.25 | Smoke and accessibility | 179 passed, 1 skipped |
| `firefox-text-110` | Firefox, Desktop Firefox at a text scale of 110%, its pointers pinned | The tests of the smoke and accessibility suites tagged for scale: every audit of the page, in forced colours and while the system asks for more contrast among them, the focus ring on every control, a highlighted entry, the status bar and the dock, a group's contents and a dock tab reached by Tab, the tab a group shows marked while it holds focus, the ring's declaration, the width a docking workspace needs and what the shell does below it, the rearranging of the workspace, its splitters dragged and its panels kept across a reload, the least target in compact density, the size of a field's text and the text a floating surface is written in, a long refusal read whole, the names of the landmarks and the tab lists, the advice on making room reached from the keyboard, and, since the twenty-first round, a name with no space kept inside the status bar at the reflow size, with the stop of the Tab order at the bar exactly while it holds more than it shows (F-1073) | 60 passed, 1 skipped, in the twentieth round's run |
| `tablet` | WebKit, iPad Pro 11 profile with touch, sending the agent Safari on an iPad sends by default, a Mac's, with the iPad's five touch points given by the suite (F-1093) | Smoke and the touch suite, a palette row tapped among them, and the size of every field a finger types into | 117 passed, 2 skipped |
| `pages` | Chromium, served from `/AudioGubbins/` | The sub-path build REQ-PWA-031 requires | 3 passed |

Both suites run against the production build served by `vite preview`, not the
development server, so what the browsers exercise is what a user would get.
Firefox scales a page by the system's text size, which the other engines in the
suite do not, so the `firefox` project pins it at 100%, as every project pins
its device profile, at the owner's decision in the sixteenth round (F-963), and
pins its pointers to a mouse, since on the machine the suite runs on Firefox
reports its touch screen as a coarse pointer and a field is drawn for a finger
(F-975). A scale that is not whole is run by a project of its own, at the
owner's decision in the eighteenth round: `firefox-text-110` runs Firefox at a
text scale of 110%, as Windows users set it, over the tests tagged for it,
sixty-one, sixty since the test audit merged as `dc60556` and the advice on
making room since the twentieth round, every audit of the page, the focus rings
and the width tests among them (F-976, F-980, F-1030). There a device pixel is
55/60 of a CSS pixel, so a CSS pixel is 60/55 of the display's, not 1.1, and the
page takes widths that are not whole: 389.58 for a window of 390 and 391.42 for
391, with nothing between. The width helper the tests use answers the narrowest
width at or above the one asked that the page can take, read from the media
query the application reads, to a thousandth of a pixel, finer than the
sixty-fourth of a pixel WebKit lays a page out in, which reads a page 390 pixels
wide at 390.015, and the test at a phone width names the width it got (F-960,
F-980, F-1024). A test that needs a width under the declared one takes the
widest the page can take below it, and the helper asserts it has it: the page
takes the declared width in a viewport a pixel wider than the one it sets
(F-980). The focus ring is declared at three pixels, which no scale of one or
more draws under two. Firefox lays a page out in sixtieths of a CSS pixel,
fifty-five of them to a device pixel at 110%, and draws a ring in whole device
pixels rounded down, so it draws the ring three device pixels wide, 2.75 CSS
pixels, where a ring declared at two was drawn two wide, 1.83 (F-976). The
seventeenth round's three runs without the pin, which failed the two rings and a
test at a phone width, were taken over an earlier helper, before it was made to
step a pixel at a time; its one run of the width group without the pin over the
helper as it committed it, `firefox-unpinned-width-2.log`, failed the
phone-width test alone, where the helper refused a width the page could not take
(F-969). `chromium-scaled` runs the smoke and accessibility suites on Chromium
at a device pixel ratio of 1.25, as a display scaled to 125% does, at the
owner's decision in the seventeenth round (F-960). The test audit narrowed it to
the tests tagged for scale, 60 of the 180, with no run kept, and the twentieth
round restored the whole of both specs at the owner's decision: the tag for
scale selects tests for `firefox-text-110` alone, and a rule of the architecture
holds that no project leaves a test out by a tag (F-1030). It lays a box out and
reads it at a ratio that is a fraction, and nothing more: Playwright sets its
viewport in CSS pixels, so every width it takes is whole, and Chromium computes
a ring at the width declared, the width it paints not measured (F-1024); a width
that is not whole and a ring rounded down are `firefox-text-110`'s (F-980). The
preview server is never reused between runs, because reusing one skips the build
and would let a run be reported against whatever was built last (F-47).

Touch runs on two engines. It ran on Chromium alone while the tablet project ran
a suite with no touch in it, which a reviewer found and which
`tests/e2e/touch.spec.ts` answers (F-46).

Tests that assert on shortcut text, or press one, read the platform through
`tests/e2e/platform.ts`, because WebKit reports Apple hardware and the Apple
convention writes the modifiers as symbols with no separator.

The table's figures are those of `e2e-s22-2`, over the twentieth round's code;
the suite did not run whole over this round's, at the owner's decision on the
gates. Two browser tests of this round ask each engine, through the page, pairs
of names whose verdict turns on the rule's options, and number a copy past names
the engine must order as the rule does, on the five projects that run the smoke
spec, where they passed with nothing put back; Playwright's WebKit is not
Safari's collation, and on Windows not Apple's at all, so the rule on Safari, on
a Mac, an iPhone and an iPad, is owed to Phase 14 beside the checks on a device
(F-1090).

## Accessibility results

- axe-core through `@axe-core/playwright`, tags `wcag2a`, `wcag2aa`, `wcag21a`,
  `wcag21aa` and `wcag22aa`, over eleven states. Nine ran with every rule on
  Chromium, Firefox and WebKit: the dark theme as it ships, the light theme, the
  brightest and the darkest the control allows, high contrast, compact density,
  the command palette open, the settings dialogue open, and a menu open. Every
  tab of the settings is audited as well, with defaults waiting for the
  keyboard and bindings the platform takes listed; it was audited on the tab it
  opens on alone (F-550). The last version listed four tags where five run.
- What `wcag22aa` adds, in axe-core 4.13, is one rule, `target-size`. WCAG 2.2
  AA also asks for 2.4.11, focus not obscured, which no axe rule here measures.
  Browser tests do: one reads a notice against the status bar it points the
  reader at (F-672). A refusal raised while a dialogue is open is a line in the
  dialogue's own flow, above its actions, at the owner's decision: laid over the
  dialogue, it was placed beside the reader's focus, and with the dialogue
  itself focused, as a click on its text leaves it and a click on a button does
  on macOS and iPadOS, it was squeezed to a sliver (F-851). Every dialogue is a
  title, a part that scrolls and a footer that does not, which holds the line
  and the actions, also at the owner's decision: scrolled as a whole, the
  dialogue left the line out of sight whenever the reader's focus was on a
  control near its top, on all three engines (F-893). The footer has no cap and
  never scrolls, so it never cuts a refusal; the part that scrolls keeps room
  inside its padding for one control and its focus ring, a control of the
  density's height, or of the touch target where a finger is among the inputs
  (F-940); and where the three are taller than the page, the dialogue itself
  scrolls. There the control the reader is on wins the view, and the start or
  the end of a long refusal can lie past the dialogue's own edge, where the
  reader scrolls the dialogue to it (F-958). The text field is drawn at the
  control's height, at the owner's decision, where as a content box it drew
  taller than the control the floor keeps room for (F-940). That revises, at the
  owner's decision, a footer capped at 40dvh that scrolled inside itself, which
  at 320 by 256 pixels left the part that scrolls 41 or 42 pixels on all three
  engines, and scrolled the start of a long refusal out of the footer when an
  action took focus (F-894, F-897). Each part that scrolls is padded by the
  reach of the focus ring and brings a control into view with the same room, so
  it cuts no ring (F-895, F-940). Three tests read the line in the export
  dialogue against the control the reader is on, measured against every
  container that clips them and against the page (F-896): beside the button
  pressed at the dialogue's foot; raised from a control near its top, at the
  suite's size, at 844 by 390 and at 320 by 256 pixels, and in the settings from
  their first tab; and, for a refusal of several lines, at the foot and at the
  top, at the same three sizes, with the control scrolled to the dialogue's top
  edge. A fourth reads a refusal of many lines with the dialogue itself focused,
  at the same three sizes: it is whole in the footer, the part that scrolls
  keeps room inside its padding for its tallest control and that control's ring,
  and the wheel reaches the refusal's end. A fifth draws the whole focus ring of
  a control at either end of the part that scrolls and in the footer, and a
  sixth finds the line in the settings and none over the page (F-712, F-799,
  F-851, F-895). On Chromium's input project a finger on the footer scrolls a
  dialogue taller than the page to the end of a long refusal, and there and on
  the tablet a dialogue keeps room for a control drawn for a finger (F-940,
  F-962). A keyboard reader reaches the whole of a long refusal from the button
  pressed, by Page Down and the arrow up, which a browser test holds on every
  desktop project, on Chromium, Firefox and WebKit (F-990). Chromium loses a key
  pressed between the last frame of an arrow scroll and that scroll's end, some
  tens of milliseconds later: the key reaches the page, nothing cancels it, and
  nothing scrolls. That is the engine's behaviour, which a keyboard reader who
  presses in that gap meets as well and for which the page has no remedy, so the
  test presses each key once the scroll the last one began has ended (F-1005). A
  finger's scroll on WebKit, which the tablet project cannot drive, and `85dvh`
  while a phone's browser toolbars show and hide are owed to Phase 14 (F-962).
  In the flow, a refusal cannot cover the control, and the footer never cuts it.
  An on-screen keyboard rises over the foot of the page first, where the footer
  and the refusal are; what each engine then does with the dialogue is a premise
  not run, which needs a phone or a tablet and is owed to Phase 14 (F-863,
  F-867, F-898). A floating panel covering a focused control is still measured
  by nothing. 2.5.7, dragging movements, is met by what the Workspace menu
  offers: every splitter and every docking drag has a command, which the touch
  suite reaches with a finger. Two drags had none until the tenth round, which
  found this line untrue: moving a floating group, and moving a panel along its
  group's tabs. Six commands cover them now (F-572). 1.4.10, reflow, is not met
  below 640 CSS pixels, which `REQ-UX-057.1` declares as the smallest width
  AudioGubbins draws a workspace at; below it the workspace is not drawn and a
  notice says how much room it needs, with every command still reachable
  (F-574). 1.4.11 is met for the entry the keyboard is on, which was marked by a
  background difference of about 1.05:1 until the tenth round (F-566), and 1.4.1
  for which dock group is in use, which was text colour alone (F-609). 3.3.8,
  accessible authentication, has no surface in this phase. The name field's
  placeholder, which shows the workspace's current name, is drawn in the theme's
  supporting text, solved for body-text contrast, which a browser test reads
  (F-551). Forced colours ran with every rule but contrast on Chromium and
  Firefox; Safari has no forced-colours mode. High contrast asked for by the
  system ran with every rule on Chromium and WebKit, for the reason limitation 3
  gives. **Zero violations in every state that ran.** An earlier version of this
  line claimed every state on every engine (F-168).
- The focus ring is measured on every control of the settings dialogue: at least
  two pixels on every engine, Firefox at 110% included. This said 1.9 on
  Firefox, for a rounding its project, pinned at 100% since the sixteenth round,
  no longer met, and at 110% a ring declared at two was drawn at 1.83 (F-976).
  The ring is declared at three pixels, and a test reads the declaration from
  the served stylesheet: the width is declared once, every rule that draws a
  focus or a highlight ring resolves to it, every fallback of it is held to it,
  and it is drawn at two pixels at least at every hundredth of a scale from one
  to four and at every scale Firefox lays a page out at between them, a ring
  being drawn in whole device pixels rounded down (F-211, F-976). It reads every
  rule the page is served, the docking engine's included, and fails where one
  takes the ring away from an element in the tab order and no rule of the
  application's outranks it, as the engine's did for a group's contents. A
  group's contents and a dock tab draw the ring inside themselves, so the group
  and the scroller around the tab strip that clip them cut none of it, and in
  forced colours a pixel of the canvas lies between the ring and the border over
  the group; the tab a group shows is filled with the accent while it holds
  focus, since the ring covers its line and no tint of it met a contrast of
  three to one (F-996, F-1003).
- A dialogue, a menu, a tooltip, a select list and the notice over the page are
  portalled into the document's body, outside the element the theme set its text
  on, so each was drawn in the browser's default face, at 16 pixels, with a line
  height of `normal`, and the density did not reach their text. The theme's
  face, size and line height are set on the body now, and a browser test reads a
  menu, a dialogue and the notice in the application's own text in either
  density, on Chromium, Firefox and WebKit (F-934). It reads what the served
  stylesheet declares on the body as well, so a face or a line height lost from
  the shell and the surfaces alike fails it (F-972).
- Where a finger is among the inputs, every text field, the palette's included,
  is drawn at 16 pixels at least, so Safari on an iPhone does not zoom the page
  into it as it takes focus, and with no finger among them at the density's
  size. A browser test reads each field on Chromium's input project and on the
  tablet, and another reads them on every desktop project. No iPhone was run:
  Playwright's WebKit does not zoom, so the tests read the size the zoom is
  decided by, and a check on a real iPhone and on iPadOS is owed to Phase 14
  (F-975). The document asks for its text to be drawn at the size the
  stylesheets give it, `text-size-adjust: 100%`, so Safari on an iPhone turned
  on its side does not enlarge it; a smoke test reads it on the two Chromium
  projects of the smoke spec, and skips where the engine takes no percentage for
  it, as Firefox and the WebKit the suite drives do, and the check on a device
  is owed to Phase 14 (F-1026). The test audit merged as `dc60556` ran that test
  on `chromium-smoke` alone until the twentieth round restored the scaled
  project's whole specs (F-1030). The form Safari on an iPhone reads is the
  prefixed one, `-webkit-text-size-adjust`: the build's targets name Safari on
  iOS 16.4, on the browser floor beside Safari 16.4 on a Mac, so the transformer
  keeps the prefix, which the build's gate refuses a stylesheet without and a
  rule of the floor holds in what the design system's tokens build to; until the
  twentieth round the targets named no iOS and the build dropped it (F-1034). No
  project of the suite is iOS WebKit, so the floor's iOS entry is held by the
  build alone until the check on a device Phase 14 owes. The tablet sends the
  agent Safari on an iPad sends by default, a Mac's, and since a page tells an
  iPad from a Mac by its touch points alone, and Playwright's WebKit reports
  none with touch emulated, the suite gives the page the iPad's five; a rule of
  the architecture holds both, and a browser test that the report a tablet saves
  names iPadOS. A real iPad's reading of its touch points is owed to the same
  check on a device (F-1093).
- Keyboard operability, asserted rather than assumed: one Tab reaches the menu
  bar, the arrow keys move between the menus, Enter opens a menu and the arrow
  keys choose within it, reaching an entry that cannot be chosen and reading its
  reason (F-289), the focus position is visible, focus stays inside an
  open dialogue, and focus returns to where it started when a dialogue closes.
- Contrast is computed rather than chosen. `packages/design-system/src/tokens`
  solves the text, border and accent tokens against a WCAG target by binary
  search, in both directions and across the background where one side cannot
  reach, and records what it could not meet rather than returning an unreadable
  colour. The unit tests assert the resulting ratio across two themes, eight
  accents, twenty-one brightness steps and two contrast levels, and the guard
  that the set is non-empty states the count rather than restating how the set
  was built (F-50).
- High contrast follows the system until the user states their own preference,
  as reduced motion does, and the setting says which is in force.
- Reduced motion follows the system preference until the user states their own,
  and shortens transitions rather than removing them, so a panel still shows
  where it went.
- Every landmark AudioGubbins renders carries a name, including each dock
  group's tab list, which the adapter names from outside the engine (F-56).
- The body of a panel is in the tab order and scrolls when its content is taller
  than the group, which `tests/e2e/accessibility.spec.ts` measures by making one
  overflow. It was claimed here against two findings about something else, and
  no test read either property (F-111).
- Forced colours, which is how Windows High Contrast reaches the page, keeps the
  boundaries between surfaces that the user's own palette removes, draws the
  entry the keyboard is on in a menu and in the command palette in the
  platform's selection colours, text as well as background, and does so for an
  entry that cannot be chosen too, draws such an entry in `GrayText` when the
  keyboard is not on it, marks the tab each dock group shows and the group in
  use, and leaves the status states to the user's colours. The tests
  read a surface with no border outside the mode before and after it, and
  compare each of these with the system colours as the browser draws them; the
  test that stood here before could not fail (F-157, F-153, F-156, F-242,
  F-248, F-267, F-290). Each is compared with a neighbour it must not share
  with (F-309). Audited with every axe rule but the contrast one,
  which under emulation measures the page's own text colour against the forced
  background: a pair no browser draws.
- A recovery notice, a moved or resized panel and the shortcut recorder's result
  are each said through a live region as well as shown (F-152, F-155, F-190). A
  chord waiting for its next key is said and not shown, because the status bar
  shows it, and giving it up is said too (F-181, F-246). Each notice's dismissal
  is named after the notice, and focus stays in the status bar after it
  (F-245).
- A live region announces every refusal, and says the same refusal again when it
  happens twice, which a browser test now proves by waiting for the first
  announcement before listening (F-51).

## Storage and recovery results

- A stored layout is read field by field from `unknown` before use, by a parse
  that builds the layout from the fields it checks, its groups, its panels and
  their placement, a panel's title held to text within the bound a workspace's
  name has, 120 characters, and its parameters to named text, numbers and true
  or false, and answers the layout or the problem, so no caller asks twice; a
  field the parse does not check is not kept, and so never written back (F-1010,
  F-1044). A stored name is read as it is written, within the same bound, and
  refused in words rather than cut, by the one module that holds the workspace's
  name rule (F-1040).
- A damaged stored layout falls back to a preset, tells the user in the status
  bar and through a live region, and leaves everything else alone. Its text is
  set aside under `audiogubbins.workspace.unreadable` before anything is written
  over it (F-959). Where there is no room to set it aside, the text is left
  where it is, the workspace on screen is written nowhere and the user is told
  so, and every write of the workspace tries again, as the next start does; once
  one succeeds, the notice is brought up to date and the user is told the
  workspace on screen is kept again (F-968). A damaged layout larger than the
  room left can never be set aside, so until its text is discarded, which Phase
  02 owes with the export and discard of every text set aside (F-206), the
  workspace on screen is not kept (F-993). The notice can be dismissed, by a
  command like everything else. Covered by
  `packages/workspace/src/layout-store.test.ts` and by the browser test
  "recovers from a damaged stored workspace without losing anything else".
- A damaged collection of saved workspaces is reported on its own. On any
  damage, whole or partial, its text is copied aside and read back before
  anything is written, so nothing the user saves waits on the notice and
  dismissing it destroys nothing. Every damaged text is added to one list and
  replaces nothing. Only when that copy is refused is the text left in place and
  the collection written beside it. The copy is read at every start, set aside
  before anything removes it when it is damaged, and removed only in a write
  after one that kept the collection's own key. When there is nowhere to write
  the collection, it is listed as not being saved (F-150, F-151, F-226, F-230,
  F-286, F-288, F-341, F-342, F-348). This said the text was kept until its
  notice was dismissed, which held only when the whole file was unreadable. A
  whole copy beside a whole collection is the newer: it is written apart only
  while the collection's text is held in place. Its entry is listed where both
  name a workspace, and the collection's text is set aside first (F-527). Where
  there is no room to set the collection's text aside, or its copy's, the
  collection is written nowhere, every write of the workspace tries again, and
  the user is told once the workspaces saved are kept again; what a write
  withholds is said of every part it withholds, the workspace on screen, the
  workspaces saved, or both (F-968).
- Storage that refuses a write is reported rather than swallowed: the status bar
  names what is not being saved, and the failure is announced (F-37).
- Each store's notice of text it could not read says its fact, where the text is
  and what that costs, once: one module of recovery notices holds the subject of
  each and the refusal to dismiss one that is not showing, and one selector
  reads the notices standing, the mounted layout's, the collection's and then
  the profiles', which the status bar and the announcement at the start both
  read. The announcement says every notice's fact first, however many words the
  facts take, then their consequences in whole sentences within sixty words,
  those worded alike once, and points at the status bar where anything is left
  out (F-998). While a notice's text waits for room, its fact ends with what
  cannot be kept until there is room, the workspace on screen, the workspaces
  saved or changes to the shortcuts, so the announcement says the loss, with its
  condition, whatever its budget, and the facts are said whole, seventy-eight
  words where every store's text waits, the layout's 18, the collection's 33 and
  the profiles' 27, where they came to sixty-six before the condition was said
  (F-1060, F-1087). The advice that nothing in AudioGubbins makes room yet
  without a loss is an item of its own in the status bar, after the notices,
  shown once while any store's text waits for room, with no dismissal, and still
  shown after a notice is dismissed; no notice and no announcement of a write
  carries it, and an announcement of a write says the fact and that AudioGubbins
  tries again each time you change a workspace, or your shortcuts, and at the
  next start (F-998, F-1018). While what the status bar holds reaches past what
  it shows, downwards or sideways, the bar is a stop of the Tab order, with its
  name and a ring drawn inside it, so the advice is reached from the keyboard
  and scrolled into view (F-1037, F-1073); each item in it breaks a word where
  it must, so a long name with no space wraps inside the bar at the reflow size
  (F-1073); and the bar's ring is read by its paint on every project that runs
  the advice's test, and beside a classic scrollbar on Chromium, where it is
  drawn whole, while beside one in Firefox and WebKit it is unproven, since
  neither is shown one (F-1075). Text too large for the room left locks its
  store's writes out wherever it is held in place: the workspace on screen while
  the mounted layout's text waits, the workspaces saved while the collection's
  text waits with its copy's, and the shortcut profiles while theirs does, each
  until the text is discarded, which Phase 02 owes for all three with the export
  of every text set aside, reachable before the quota is met, and a bound on
  each list set aside, with a notice when an old text is dropped (F-993, F-1021,
  F-1022).
- Stored shortcut profiles any of whose text cannot be read, text that is not
  JSON or not an object, holds no list of profiles, was written in another
  format, or holds an entry the command layer refuses, are set aside whole under
  `audiogubbins.shortcuts.unreadable` before anything is written over them. The
  profiles that can be read are kept, and a notice says what could not be read
  and how many, and that the default shortcuts are in force where the profile in
  use was among them; a command of its own dismisses it, which destroys nothing.
  Where there is no room to set the text aside, the profiles are written nowhere
  over it and the user is told so, every write tries again, and once one
  succeeds the notice is brought up to date and the user is told. The log names
  what was left out by its place, and no text of the user (F-973).
- An identifier read from storage is kept only where it is one AudioGubbins
  derives, within the bound its store gives: a profile's 227 UTF-8 bytes, the
  255 a file's name may take less the ending of the exported file, which the
  command layer writes, and a workspace's 227, a bound of storage at the owner's
  decision, which no file name sets (F-1074). A profile or a workspace stored
  under another is left out, its text set aside with the notice other text that
  cannot be read has, and its identifier neither logged nor quoted (F-1038). An
  identifier leaves out the code points a reader sees nothing of, reads the
  Hangul fillers as a gap and is never a stem Windows reserves for a device,
  which is numbered as a name held is, so one stored holding either kind, or
  under such a stem, is set aside as well; a name of letters a reader cannot see
  alone is refused as blank (F-1089). The announcement of an export says the
  file's name whole, in quotation marks (F-1069). The copy beside the collection
  keeps every entry, one under an identifier the collection holds as well given
  a free one (F-1062). Where the runtime cannot compare names by the rule, the
  stored workspaces and profiles are read and switched between as ever, each
  name as it is stored, and saving, copying, renaming and importing are refused
  in words, the Capabilities panel saying why (F-1041); the check is made once,
  at the capability probe at the start, which the owner counts as the first use
  of naming, and a runtime that cannot make its collator is answered as one that
  fails it (F-1091). The settings say so before the user acts: one note above
  the shortcuts gives the reason, each control that names something is marked
  unavailable and described by it, the Import label is drawn as an unavailable
  button, and Rename on a built-in workspace advises a copy only where Duplicate
  can make one (F-1088).
- What the keyboard layout types, learned from the keys the user presses and
  read from the browser's layout map, is kept under
  `audiogubbins.keyboard-layout` and read back at the start, so a browser
  without a map does not read every keyboard as a US one until the user has
  typed again. A kept layout that cannot be read, or one written for another
  version, starts it from nothing (F-409), and is logged with a fixed reason,
  never the stored text (F-556). Whether the layout types another layout while
  Command is held is kept with it, written only where it does (F-522).
- Preferences, workspace layouts, shortcut profiles and the keyboard layout each
  carry their own schema version, independent of the product version
  (`version.json`).
- The docking engine's serialised form is never stored (`ADR-0010`). The layout
  AudioGubbins stores holds the floating placement of a floating panel, so a
  panel that was floating is floating when it comes back (F-48).

## Performance, audio and DSP

The phase packet requires no performance measurement, no audio reference result
and no benchmark, because nothing in this phase plays or processes audio. The
deterministic fixtures that later phases will measure against are in place and
tested (82 tests over the signal generators), including the amplitude and
distribution checks that found a real defect in the noise generator, and which a
later review found too weak to hold their own claims (F-53).

## Known limitations

Each is permitted by the specification or is a property of a third-party
component, and none is hidden from the user:

1. **Panels are placeholders that name their phase, but for two.** Each
   placeholder says what it will hold and which phase brings it, and a browser
   test reads that text (`REQ-EXEC-136.9`). The Diagnostics and Capabilities
   panels work: the Diagnostics panel's filter is kept above the dock, so a
   remount keeps it. A group's scroll position is the engine's, and a remount
   of the dock loses it; owed to Phase 04 (F-560).
2. **Pen input is driven on Chromium only.** A pen press with force and tilt is
   dispatched through the Chrome DevTools Protocol, which Firefox and WebKit do
   not offer, so no automated test drives a pen on them. What the tests assert
   is what the page received: the pointer kind, the pressure and both tilt
   angles. The model that reads them has no browser in it and is unit tested. A
   finger's scroll is driven the same way, as touch events sent through the
   protocol, so the test that scrolls a dialogue taller than the page with a
   finger runs on `chromium-input` and is skipped on `tablet` with that reason;
   WebKit's own finger is owed to Phase 14 (F-962).
3. **Five system-preference tests do not run on Firefox.** Measured against the
   served build, with `matchMedia` read in the page on each engine: a colour
   scheme or a contrast set as a context option, or by the page before its
   first navigation, never reaches Firefox's document; set by the page once it
   has loaded, it reaches all three; and with only the contrast changed,
   Firefox does not tell a query list made earlier. The colour-scheme tests set
   the preference once the shell runs and pass on Firefox, and a test on every
   engine keeps the measurement executable. The four contrast tests and the one
   test of what the shell reads as it starts are skipped on Firefox with those
   reasons, and run on Chromium and WebKit. It was eight tests, under a reason
   the reduced-motion tests contradicted (F-159).
4. **The browser matrix never reaches the cross-origin-isolated branch.** The
   preview server sends no isolation headers, so `crossOriginIsolated` is false
   in every browser test and the degraded path is the only one exercised there.
   The isolated branch is covered by unit tests against an injected environment.
   Isolation matters when the audio engine arrives; a hosted GitHub Pages build
   cannot send the headers at all, which the capability's own remedy text now
   says (F-76).
5. **Gesture settings have no owner in the preference contract.** `REQ-UX-068`
   requires a user to be able to choose a fixed strength over pressure, and no
   tool in this phase has a strength that pressure could vary. `ADR-0017` gives
   the persisted preference and its control to the phase that adds the first
   pressure-sensitive tool (F-65).
6. **Menus cannot be opened by pointer more than once per file under jsdom.**
   A module-level layer state in the menu library survives unmounting. The unit
   tests open menus from the keyboard; the pointer path is covered in a real
   browser, where the artefact does not exist.
7. **A Firefox `InvalidStateError` on a fast reload came from the service
   worker.** The earlier bisection ruled out the application, the docking
   engine, the WebGL probe and the stylesheet, and never tested the worker,
   which a reviewer identified as a textbook cause (F-82). Measured: with the
   worker registered the error appeared in 5 rounds of 5; with it unregistered,
   in 0 of 10. The production build ships no service worker, so the cause is not
   in what a user receives.
8. **Forced colours are not tested on WebKit.** Forced colours is how Windows
   High Contrast reaches a page, through Chrome, Edge and Firefox on Windows.
   Safari has no such mode; macOS reaches the page through `prefers-contrast`,
   which the contrast tests cover. The nine forced-colours tests are skipped on
   WebKit with that reason.
9. **The long-press context action has no surface yet.** `REQ-UX-067` names long
   press as the context action within editing canvases, and this phase has
   none. The primitive is built and tested; the waveform canvas, Phase 04's, is
   the first surface that mounts it (F-188). Every other part of `REQ-UX-067`
   is met: every panel operation is reachable without a drag, which was untrue
   of nudging a floating group and of moving a panel along its group's tabs
   until the tenth round gave each a command (F-572).
10. **Which key a browser matches on another keyboard layout is modelled, not
   measured on every engine.** The model follows each browser's documentation
   and source: a Latin layout matched by character, a non-Latin one by a letter
   key's position, the digit row by its digits. No test runs a real non-US
   layout; the unit tests, and a browser test with a stubbed layout map that
   runs on the five projects that run the whole smoke suite (`chromium-smoke`,
   `chromium-scaled`, `firefox`, `webkit` and `tablet`), hold the model and its
   wiring, not how each engine matches a key (F-493). A character a layout types
   only with Shift is outside the model, since a layout map and an unmodified
   press tell only what a key types on its own, and no shipped default uses one,
   which a test holds. A key that types `+` unmodified, as on German, Spanish
   and Italian, is read as the US key that types it with Shift, so Control on it
   is the zoom it is (F-557). On macOS "Dvorak – QWERTY ⌘", which types QWERTY
   while Command is held, which of the two layers the system reads a Command
   press by is its own answer, and unread is one of the three: a default whose
   character sits away from its US key has no safe place until a press settles
   it, so it waits, and the Shortcuts settings say so and name a key that
   settles it (F-568). The press that settles it is a bare Command press, with
   Caps Lock off, on a letter key whose character the layout has already shown
   and which a US layout types on another key: a key both layers type alike
   teaches nothing either way (F-567). Once settled, Command presses are placed,
   named and checked at their US positions where the layout switches, and where
   the layout types its own characters, at the keys that type them (F-522). That
   the engines report the ⌘ layer's letter in `event.key` is from their
   documentation, not measured here; an engine that did not would report the
   unswitched letter, which is read as a layout that does not switch, and which
   costs such a user the benefit and costs nobody a working shortcut (F-624).
   ChromeOS's own shortcuts go to Phase 14's compatibility matrix (F-412), and a
   convention of its own for Android goes with them (F-684).

   The shipped defaults that sit on a combination a browser acts on begin with
   the chord prefix itself. Control+K is the omnibox in search mode in Chrome
   and Edge and the search field in Firefox, and it is the Windows and Linux
   accelerator: Firefox on macOS focuses its search field on Command+K. The
   Apple form was claimed of Chrome, which publishes none, and of Edge, for
   which none is known here (F-792, F-838). Nine of the ten defaults are behind
   it. The second presses add the palette, Save as, Reset and the dark theme —
   `P`, `S`, `R` and `D`, the browser's print, save, reload and bookmark — and
   three more: the light theme on `B`, which is Firefox's bookmarks sidebar,
   diagnostic mode on `G`, which is find-again, and Close this panel on `X`,
   which is Cut. The reservation table holds a press at least one supported
   browser or system takes *before the page*, and each of these is handed to the
   page first, so an audio editor that wants Save gets the press and cancels the
   browser's. That is a choice rather than an oversight, and the table's header
   names four of these — Control+S, Control+P, Control+R and Control+D — as
   deliberately absent from it; the rest are absent by the same criterion, which
   the header states. An earlier version of this sentence said the header named
   the same combinations, of a list of eight (F-788). An earlier version of this
   paragraph said "four shipped defaults", which is exhaustive on its face and
   is not the count: the prefix is on nine of the ten and was named nowhere
   (F-569, F-690, F-716).

   The same criterion took five of the table's desktop rows out in the
   fourteenth round: the ways into the address bar (Control+L, Alt+D and F6),
   the zoom keys, a tab by its number, Alt with an arrow, and F11. Each was
   read against the engines' own lists of what they keep from the page —
   Chromium's `BrowserCommandController::IsReservedCommandOrKey` and the keys
   Firefox's key set marks `reserved` — and neither holds any of them, so
   each reaches the page first and a binding on one runs (F-818). The
   fifteenth round asked what that criterion does not: whether a reader
   relies on the browser for the press. The owner decided that such a press
   is refused with a reason that says so, as a third kind of row: the ways
   into the address bar (Control+L, Alt+D and F6, and Command+L), the zoom
   keys and F11. A binding on one would take, silently, the zoom the
   too-narrow notice tells a reader to use, or a keyboard's way out of the
   page, so the recorder and an import refuse it on every engine (F-852).
   F-818's test called F11 a press neither engine keeps from the page, and
   both keep it in full screen (F-886). A tab by its number and back and
   forward stay absent, and the Apple rows for them and for Safari's
   settings went by the same criterion: WebKit gives the page every key
   equivalent first (`WebViewImpl::performKeyEquivalent`). What Safari's own
   menus take before WebKit sees a press is not read, and the table's header
   says so (F-866).

11. **The workspace is not drawn below 640 CSS pixels.** `REQ-UX-057.1` declares
   that width, and `shell.css` shows a notice below it instead of a dock: three
   docked columns at a panel's declared minimum, with the splitters between
   them, need more than six hundred pixels, and drawn anyway the dock clipped
   its panels and scrolled in two directions inside a shell that cannot scroll
   back. Declining to draw one, and saying so, is the owner's decision, taken
   rather than reflowing the shell; `REQ-UX-057.1`'s own clause and the owed
   list record it, so a reader of this phase can see who decided and what was
   decided (F-689). Phase 01 therefore does not meet WCAG 1.4.10 below that
   width; the clause records it, owned with `REQ-UX-029`. The dock stays mounted
   behind the notice, so widening the window brings the arrangement back
   untouched, and the menus, the palette, the settings and the status bar keep
   working. The width is written in `too-narrow.tsx` for the message and in
   `shell.css` for the rule, because a media query cannot read a custom
   property, and it is written a third time in the browser suite; a fast-tier
   rule holds all three equal, and a browser test drives the window to either
   side of it (F-574, F-660). The settings are laid out below the width as well,
   which this finding also named: the tab list wraps, and a browser test opens
   the settings at a 320-pixel viewport and reads every tab's box against the
   dialogue's (F-635). Crossing the width moves focus to the head of what has
   taken the workspace's place and says which side of it the window is on,
   rather than leaving focus on the document body with nothing said (F-669).
12. **A layout learned on another keyboard survives on Firefox and Safari.**
   Chromium's layout map is read again each time the user returns to the tab,
   so a layout changed while AudioGubbins runs is followed. Firefox and Safari
   offer no map, so there is nothing to tell one keyboard from another: a
   layout kept from the last visit stands until the user types enough to
   correct it. Owner Phase 14, with the keyboard platform (F-622).

## Dependencies added, and their review

Runtime: `react`, `react-dom` (`apps/web`), `radix-ui`
(`packages/design-system`), `dockview` and `dockview-react`
(`packages/workspace`). Every one is named by `ADR-0001`, each is contained by
the boundary an ADR describes, and no package declares a dependency its own
source does not import, which an architecture rule asserts.

Development, at the root: `typescript`, `vitest`, `@vitest/coverage-v8`,
`eslint`, `@eslint/js`, `typescript-eslint`, `eslint-plugin-jsx-a11y`,
`eslint-plugin-react-hooks`, `globals`, `prettier`, `dependency-cruiser`,
`@playwright/test`, `@axe-core/playwright`, `jsdom`, `@testing-library/react`,
`@testing-library/jest-dom`, `@types/node`, `lightningcss`, the parser of the
transformer the build uses, which the build's gate reads the built stylesheets
with, added in the twenty-first round at the version Vite resolves (F-1092), and
`@audiogubbins/capabilities`, which the browser tests read the platform through.

Development, in `apps/web`: `vite`, `@vitejs/plugin-react`, `vite-plugin-pwa`,
`@types/react`, `@types/react-dom`, `@testing-library/react`,
`@testing-library/user-event`, `@testing-library/jest-dom`, `jsdom`, `vitest`.

An earlier version of this list omitted eight of these, including
`vite-plugin-pwa` (F-83). That plugin generates network-intercepting code, so it
most needed the `REQ-EXEC-175` evaluation: it is disabled for the production
build, the application ships a static `manifest.webmanifest` instead,
`tools/check-build-output.mjs` fails the build when a service worker reaches the
output, and a browser test asserts that a served build registers none (F-39).
The build-output rule exists because this package cited one before there was one
(F-144).

`workbox-google-analytics` is present transitively, through `vite-plugin-pwa`.
No generated worker ships, and the lockfile review records it as reviewed and
inert (F-20) rather than leaving it for a reader to find. An architecture rule
reads the lockfile for analytics packages as well as the manifests, and the
build-output test checks the built files for analytics hosts.

Each dependency is a tool with a single purpose and none reports usage. `pnpm`
isolates `node_modules` with hoisting disabled, which
`tests/repository-settings.test.ts` asserts, so a package can only import what
its own manifest declares.

## Migration and schema impact

No migration. Five partitions are written to storage, each under its own key and
each carrying its own version, which `apps/web/src/state/` reads back and
refuses when it was written for another:

| Partition | Format | Key |
| --- | --- | --- |
| Appearance settings | `userPreferences` 1 | `audiogubbins.preferences` |
| Workspaces | `workspaceLayout` 1 | `audiogubbins.workspace` and `audiogubbins.workspaces`; `audiogubbins.workspace.unreadable` holds the text of the mounted layout that could not be used, `audiogubbins.workspaces.unreadable` the list of every damaged text, the collection's and its copy's, and `audiogubbins.workspaces.recovered` the collection while that text could not be set aside |
| Shortcut profiles | `shortcutProfile` 1 | `audiogubbins.shortcuts`; `audiogubbins.shortcuts.unreadable` holds the stored profiles' text where any of it could not be read |
| Diagnostic log levels | `logVerbosity` 1 | `audiogubbins.verbosity` |
| Keyboard layout | `keyboardLayout` 1, with `commandByPosition` written only where it is true, which a layout stored before it reads without | `audiogubbins.keyboard-layout` |

`diagnosticBundle` 1 is a format in transit rather than in storage: a report is
written to a file the user chooses and is never kept. A shortcut profile is both
— stored, and exported to a file in the same shape.

Two earlier statements here were wrong and are recorded rather than quietly
replaced. The first said every one of four formats was persisted, when the
bundle is not (F-84). The second, written to correct it, said a shortcut profile
had no persistence path, which the phase's own remediation had already given it
(F-142). The log verbosity was persisted with no version at all until this
review found it (F-143).

The product version is `0.1.0` and is deliberately independent of all six.

## Screenshots and recordings

None. Every visual and interaction claim in this package is asserted by an
automated check against the rendered application: the contrast ratios are
computed from what the browser resolved, the touch target is hit-tested rather
than measured, and the pointer kind, pressure and tilt are read from the event
the page received. Playwright captures a screenshot only when a test fails, and
no test fails.

## Requirement-to-evidence mapping

`REQ-EXEC-215` states that a requirement is not satisfied because code that
looks related exists. A reviewer read this table row by row and found five that
cited evidence proving something else (F-49); each of those five now cites a
test that makes the claim, and the tests that were missing were written. The
rows name each test file and no longer copy its count, which the table under
Tests gives once: copied, nineteen of them still gave the seventh round's
numbers after the eighth (F-529).

| Requirement | Implementation | Evidence |
| --- | --- | --- |
| `REQ-ARCH-004` Core architectural principles | Package layering, injected ports, no global store | `tests/architecture/dependency-rules.test.ts` (layering, cycles, forbidden imports, declared-but-unimported edges, the stylesheet entry, the parts of the application in one direction, the cohesion band with each file at its size, and the review of every function from fifty logical lines, at its size); `tests/architecture/module-exports.test.ts` (every module export taken by another module, or listed with the reason a test needs it); `tests/architecture/package-exports.test.ts` (every package export used, or listed with its reason, reading a signature's types alone); `ADR-0011` |
| `REQ-UX-005` User experience goals | Keyboard-first shell, named landmarks, visible focus, touch targets | `tests/e2e/accessibility.spec.ts`; `tests/e2e/input.spec.ts`; `tests/e2e/touch.spec.ts` (on two engines) |
| `REQ-PROD-006` Primary users | Shell built for professional keyboard and pointer work: command palette, chords, rebindable shortcuts, dockable panels | `tests/e2e/smoke.spec.ts`; `packages/commands/src/palette.test.ts` |
| `REQ-PWA-031` Local development | Vite 8 dev server and production build, no backend, and the sub-path build a project site is served from | `tests/e2e/smoke.spec.ts` "needs no backend, so nothing is requested from anywhere else"; `tests/e2e/pages.spec.ts`; `tests/build-output.test.ts` |
| `REQ-REPO-033` Source control and licensing | Git repository, Apache-2.0 in every manifest, `.gitattributes` keeping LF on every platform | `tests/repository-settings.test.ts` ".gitattributes keeps LF in the working tree on every platform" and the binary rules; architecture test "keeps the licence on every package" |
| `REQ-ARCH-034` Dependency philosophy | Five runtime dependencies, each named by `ADR-0001`, each behind an AudioGubbins contract | Architecture tests for Dockview and Radix containment, and "declares no dependency its own source does not import"; `ADR-0009`, `ADR-0010` |
| `REQ-PROD-056` Product name | "AudioGubbins" in the document title, the shell and every manifest | `tests/e2e/smoke.spec.ts` "starts and shows the shell" |
| `REQ-UX-057` Dockable workspace | `packages/workspace`, one adapter over Dockview | `packages/workspace/src/layout-store.test.ts`, `panel.test.ts`, `adapter/geometry.test.ts` (a group still drawn where it was read back as stored), `adapter/coalescer.test.ts`, `adapter/dockview-adapter.test.tsx`, which mounts `DockHost` with the engine replaced and unmounts it, `same-arrangement.test.ts` for two arrangements compared by what they hold; `apps/web/src/dock-rearrangement.test.ts` for the dock put back after a refused drag, and `apps/web/src/dock-wiring.test.tsx` for the application wired so; `apps/web/src/commands/workspace-commands.test.ts`; smoke "rearranging the workspace" (drag, resize, re-tab, float) and "offers no reset after a tab is chosen and the first chosen again" |
| `REQ-UX-058` Workspace presets | Six presets, each an arrangement of the kinds this build has, and the settings that rename, duplicate, reset and delete them, each saying why it cannot | `packages/workspace/src/presets.ts` with `layout-store.test.ts`; `apps/web/src/shell/settings/workspaces.test.tsx`; smoke "switches to a preset the menu names" |
| `REQ-UX-059` Workspace persistence | Layout store with validation, save-as, reset and recovery | `apps/web/src/state/workspace-store.test.ts`, `state-storage.test.ts`, for the collection kept through damage and a write that is refused or has nowhere to go; smoke "saves the arrangement as a new workspace", "restores the saved workspace after a reload", "keeps a panel the user widened at its width across a reload" |
| `REQ-UX-060` Asset browser and editor tabs | Panel kinds, the docking tabs, and a placeholder that says what it will hold and when | smoke "offers the workspace with every panel of the preset" and "says what each panel is for and which phase brings it", which reads the text rather than assuming it |
| `REQ-UX-066` Shortcut system | Physical key codes, chords, conflict detection including prefix shadowing, platform rendering, reserved list read on the user's keyboard layout, a default profile placed by the characters it is pressed with, rebinding and profiles | `packages/input/src/keyboard-layout.test.ts`, `packages/capabilities/src/keyboard-layout-map.test.ts`, `apps/web/src/state/keyboard-layout-store.test.ts`, for a layout learned, read from the map and kept between visits, and a stored profile read as written; `apps/web/src/keyboard-wiring.test.tsx` for the application wired so, the recorder included; `apps/web/src/shell/menus.test.ts` and `command-palette.test.tsx` for a shortcut written in what the keyboard types; `apps/web/src/shell/settings/shortcut-recorder.test.tsx`, `shortcuts.test.tsx`, `packages/commands/src/shortcut.test.ts`, `platform-reservations.test.ts`, `profile-editing.test.ts`, `chord-tracker.test.ts`, `shortcut-transfer.test.ts`, `packages/input/src/keyboard.test.ts`, `apps/web/src/shell/palette-navigation.test.ts`, `apps/web/src/input/use-shortcuts.test.ts`; `apps/web/src/commands/shell-commands.test.ts` "binds no press the browser takes first on" each convention, on each of four keyboard layouts, and "binds no press the browser takes first, at any step of a chord", on each convention with nothing known of the layout; smoke "remapping a shortcut" and "writes a shortcut in what the keyboard types, in the menu and in the palette" |
| `REQ-UX-067` Touch and gesture model | Pointer abstraction, touch targets that do not shrink, every panel operation reachable without a drag, and the context-action primitive a long press opens. The requirement names long press within editing canvases, and this phase has none: no surface mounts the primitive yet (limitation 9, F-188) | `packages/input/src/pointer.test.ts`; `packages/design-system/src/primitives/context-actions.test.tsx` for the primitive; `tests/e2e/touch.spec.ts` on Chromium and WebKit, including arranging the workspace with a finger |
| `REQ-UX-068` Stylus and pressure | Pointer samples carrying pressure and tilt, pressure always optional | `tests/e2e/input.spec.ts` "presses a control, and the browser reports the pressure and the tilt", which reads back the force and both angles the test dispatched; `pointer.test.ts` for tool strength with pressure absent |
| `REQ-UX-069` Motion and animation | System preference honoured until the user overrides it; reduced rather than removed | `packages/design-system/src/tokens/theme.test.ts`; accessibility "the reduced-motion preference is respected" |
| `REQ-UX-070` Theme system | OKLCH tokens, computed contrast, eight accents, brightness, high contrast following the system | `packages/design-system/src/tokens/colour.test.ts`, `theme.test.ts`; axe across eleven states, as the accessibility results set out; `apps/web/src/shell/pre-paint.test.ts` holding the first-paint colours to the tokens; `apps/web/src/shell/use-contrast-warning.test.ts` for a palette that falls short |
| `REQ-UX-071` Density and customisation | Comfortable and compact density with an unchanged touch target | smoke "keeps the touch target the same size in both densities"; touch "answers a tap that lands beside a small control" and "can hit every menu entry, list option and palette row" |
| `REQ-EDIT-072` Contextual inspector | Inspector panel in the presets, naming the phase that fills it | smoke "offers the workspace with every panel of the preset" (the inspector by name) and "says what each panel is for and which phase brings it" |
| `REQ-EDIT-073` Typed command architecture | Registry, bus, availability with reasons, undo contract, transactions, and a rule that the interface uses them | `packages/commands/src/registry.test.ts`; `apps/web/src/commands/shell-commands.test.ts`, `workspace-commands.test.ts`, `voiced-execution.test.ts`; `tests/architecture/command-route.test.ts`, which reads types to find a store the interface changes by any other route, with a control for each way it can be reached |
| `REQ-REPO-142` Open-source licence | Apache-2.0 at the root and in every package manifest | Architecture test "keeps the licence on every package" |
| `REQ-ARCH-151` Front-end and workspace technology | React 19, TypeScript, Vite 8, Radix, Dockview behind the adapter | Architecture tests "imports the docking engine only from the workspace package", "imports the primitive library only from the design system primitives"; `ADR-0010` |
| `REQ-ARCH-153` State ownership | Partitioned external stores, created in the composition root, changed only through commands | `ADR-0011`; `tests/architecture/command-route.test.ts`; `apps/web/src/state/state-storage.test.ts`, `workspace-store.test.ts` |
| `REQ-REPO-154` Repository and package topology | Ten packages, one application, one crate, generated graph | `pnpm run graph:check`; architecture layering tests, which name every package |
| `REQ-UX-155` Styling and design system | Semantic tokens only, no component-level colour, Radix behind the primitives | Architecture tests for the primitive library and for a colour literal outside the tokens; `colour.test.ts`; `ADR-0009` |
| `REQ-PRIV-161` Diagnostic submission and consent | Bundle described before consent, closed content set, never transmitted | `packages/diagnostics/src/bundle.test.ts`; smoke "shows what the report will contain before anything is saved" |
| `REQ-PRIV-162` Usage analytics policy | No analytics of any kind | Architecture tests "has no network call anywhere in production source", "imports no analytics or telemetry service", "declares no dependency that reports usage", and the lockfile review; `tests/build-output.test.ts` for the built files; smoke "nothing is requested from anywhere else" |
| `REQ-PRIV-164` Language and localisation | British English throughout, `lang="en-GB"` | Architecture test "uses no American spelling in prose or user-facing text", which reads `index.html` as well as the source; accessibility "gives the page a language" |
| `REQ-PRIV-165` Structured diagnostic logging | Typed records whose field values can only be string, number, boolean or null, so audio cannot be logged, with every string redacted | `packages/diagnostics/src/logger.test.ts`, `redaction.test.ts`, `log-store.test.ts`; `credentials.ts` and `path-finding.ts` are held by the redaction tests |
| `REQ-REPO-185` Monorepo structure | pnpm and Cargo workspaces, generated manifests | `pnpm run graph:check`; `cargo test --workspace` |
| `REQ-REPO-186` Package and workspace management | Isolated `node_modules`, hoisting disabled, so no transitive dependency resolves undeclared; an undeclared import of one of the three workspace packages the root declares is stopped by an architecture rule that reads every file under each package's and the application's `src/`, tests and test support with them, and again by the composite build | `tests/repository-settings.test.ts` ".npmrc disables hoisting, so nothing resolves a transitive dependency it did not declare"; architecture tests "imports no AudioGubbins package its manifest does not declare, from any package", "never reaches past another package into its src" and "declares no dependency its own source does not import" |
| `REQ-REPO-187` Product versioning | `version.json` as the single source, generating a TypeScript package and a Rust module, with a `--check` gate | `pnpm run version:check`; `cargo test --workspace`; architecture test "gives every package the same product version"; `ADR-0016` |
| `REQ-REPO-191` Reference assets and fixtures | Generated signals and projects, provenance recorded, stable once used, and the two measures the tests of cost share, of processor time and of the comparisons of names | `packages/test-fixtures/src/signals.test.ts`, `projects.test.ts`, `processor-cost.test.ts`, `comparisons.test.ts`; `PROVENANCE.md`; `ADR-0019` |
| `REQ-EXEC-184` Architecture enforcement tests | Executable rules for layering, cycles, containment, globals, colour literals, spelling, and the command route | `tests/architecture/dependency-rules.test.ts`, `module-exports.test.ts`, `package-exports.test.ts`, `public-contracts.test.ts`, `command-route.test.ts`, `browser-floor.test.ts` (the browser floor, and what the library declares above it only where it is guarded), `browser-suite.test.ts` (no project leaves a test out by a tag or a file, and each project's specs are held to a table, F-1030, F-1068), each proved by mutation; dependency-cruiser, whose package rules each fire on an import made to prove them, the cruise itself run for the rules the fourteenth round added (F-565, F-872) |
| `REQ-EXEC-216` Capability reporting | Twenty capabilities and thirteen features, the comparison of names and naming among them (F-1041), each with a reason and a remedy, reported in a panel and in the status bar when something is missing | `packages/capabilities/src/registry.test.ts`, `browser-environment.test.ts`, `apps/web/src/shell/panels.test.tsx` (the panel with a browser that offers nothing, and every panel kind without a region of its own), `status-bar.test.tsx` (for none, one and several missing, and each notice dismissed by name); smoke "says what the browser cannot do rather than failing quietly", which takes a capability away so the report is always made |

## Commits

Oldest first, on `phase/01-application-foundation`, every commit up to but not
including the one that records this round. Read from the log rather than
remembered, at the range the sentence above states: `git log --reverse
--format='%h %s' $(git merge-base main HEAD)..HEAD~1`, partitioned on whether
the subject matches `F-\d`, gives **156 commits, of which 32 name a finding and
124 name none**. The command printed here ended at `HEAD` until the twelfth
round, which is one commit past the scope, so a reader who repeated it got
different numbers with nothing saying why (F-725). The range walks every parent
of a merge, so it reaches the test audit's commits through the second parent of
the audit's merge, `dc60556`; run at `dc60556` itself, `HEAD~1` is `8b46e45`,
and the range misses them (F-1032). Once this round's own commit is made,
`HEAD~1` is `662a255`, the twentieth round's.

The 124 that name none are: fourteen that built the phase before any review,
each naming its work unit; seven resume notes; one merge from `main`; one
evidence package; one that records the seven lens reviews; one that names its
round rather than its findings; seven round records; nineteen remediation
commits that say what they change rather than which finding they close, which
the record's dispositions tie to their findings; four launcher commits, one of
them a merge; and the test audit's sixty-nine, sixty-two that change tests,
tools and code and seven merges, `dc60556` the last.

A commit that closes review findings names them in its subject up to
`ae2a3f1`; from `fd92198` on it says what it changes instead. This paragraph
said each later commit names its findings (F-564), then that every commit up to
`ae2a3f1` does (F-581), then gave a breakdown of thirteen commits that did not
reconcile with the log and named a range that held none of them (F-687). It is
generated now.

```
dd2b59d Establish the monorepo foundation and the domain package
f33adce Add local structured diagnostics with no network path (WU-01.D)
2e7a1bc Add the typed command layer, shortcuts and palette (WU-01.C)
1e1d027 Add capability detection and degraded-feature reporting (WU-01.D)
d6f028a Add the semantic design token and theme system (WU-01.B)
b4d94b3 Add the theme provider and accessible primitives (WU-01.B)
f48dfc7 Add the workspace contracts, presets and Dockview adapter (WU-01.C)
44bcc4e Add chord tracking and the pointer input abstraction (WU-01.D)
1aa75c1 Add the application shell: state, commands, panels and the build
5ade74a Record the Phase 01 resume note
90746e2 Merge remote-tracking branch 'origin/main' into phase/01-application-foundation
71850a2 Add deterministic fixtures and the architecture test suite (WU-01.E)
9fc8d1c Drive the shell in real browsers, and fix what that found (WU-01.F)
f49f8d5 Close a panel from the keyboard, and name where the user starts (WU-01.F)
c152468 Record the five architecture decisions Phase 01 took (WU-01.G)
be87626 Write generated specification artefacts with verbatim newlines
daf32a9 Write the Phase 01 evidence package, and drop a dependency nothing imports
694ca31 Bring the Phase 01 resume note up to date
067f1c6 Record the seven lens reviews, and correct what they found false here
f3f59c2 Theme the document, so a floating surface is drawn at all (F-01, F-02)
ee9b7e4 Bring the resume note up to date after the reviews
63cb682 Record where a panel actually is, not where it was assumed to be (F-03)
c52f5ca Tell a refusal from a result when closing a panel (F-06)
6ad96af Keep the workspaces the user made (F-05)
d37584a Say why an entry cannot be chosen, in text (F-15)
20c56d0 Record the remediation progress in the resume note
22252ad See every import, not only the ones written with "from" (F-12)
11e5fed Keep the building machine out of the deployable build (F-14)
2cc0b7b Test the wiring between the browser and the theme (F-13)
b0b53c9 Say a refusal twice, and show it (F-10)
21e6e68 Put focus back where it can still be found (F-11)
0be327a Give every workspace operation a command and a surface (F-04, F-09)
9f5d65f Let the user remap every shortcut, with Command on Apple hardware (F-07, F-61)
a17d5be Record the blocking findings closed so far in the resume note
9838b31 Show what a diagnostic report holds, then save it; let the user set the log level (F-08, F-21)
f734aa9 Record who owns the domain value model, and the blocking dispositions (F-24)
5b3a9c8 Hand the non-blocking sweep over with its triage in the resume note
71627db Format the resume note
9f63be1 Give the version registry its own leaf package, and drop unused edges (F-27, F-23)
497f59f Redact every string a diagnostic record carries, and name the files (F-16, F-17, F-22, F-69)
7a61c60 Ask the browser in one place, build the application on mount, and contain failures (F-25, F-26, F-45, F-74, F-38)
34a5ab9 Tell the user when a change will not be kept, and let the recovery notice go (F-37, F-34, F-33, F-28)
2c46097 Enforce the local-first promise in the page, ship no production worker, and build for Pages (F-18, F-19, F-20, F-39, F-75, F-82)
2937bcf Keep colours in the tokens, targets hittable and the shell out of the notch (F-60, F-43, F-58, F-41, F-59, F-62, F-63, F-64, F-52)
b1fb36b Drive the workspace in the browser, and fix what that found (F-48, F-56, F-57, F-66, F-70)
cc05583 Ask whether WebGPU has an adapter, and let the registry take late answers (F-42, F-77)
239e625 Give input one home, ban type assertions, and remove what nothing calls (F-29, F-35, F-32, F-67, F-68, F-71, F-73)
310df7a Make the tests able to fail, and route the dock through the command bus (F-50, F-51, F-53, F-54, F-55, F-30)
947fcef Keep a chord through a European layout, and test touch on two engines (F-44, F-46, F-65, F-76)
3d4c669 Write the evidence from what the tests actually assert (F-49, F-78 to F-85)
b306f64 Close what the re-review found, from the dock's identity to the redaction of a spaced path (F-86 to F-147)
67566ad Stop a remounted dock reporting into the next workspace, and keep every saved workspace through a recovery (round 3, part 1)
f8b7dbc Close what the third review found, from reserved chord presses to the recovery nobody heard (F-152 to F-225)
70fcf81 Record the third review round, and write the evidence from the run
3bad50e Close what the fourth review found, from saves lost beside a damaged file to quoted paths left in a report (F-226 to F-284)
56c4a4c Record the fourth review round, and write the evidence from the run
e3b0a81 Close what the fifth review found, from a name left before its placeholder to a copy deleted by a failed save (F-285 on)
929f8e9 Record the fifth review round, and write the evidence from the run
9500102 Close what the sixth review found, from a name left before a lower-case word to a shortcut read on the wrong keyboard (F-340 on)
38ee4f1 Record the sixth review round, and write the evidence from the run
ae2a3f1 Close what the seventh review found, from shortcuts checked on an unknown keyboard to a workspace that no longer matched itself (F-386 on)
fd92198 Run each form of a command twice, and hold the layout kept between visits
9b1f227 Give each rule and sentence of the shell one home
5e18eae Write the motion levels, and the last separator of a path, once each
866f380 Remove a secret in JSON written inside JSON, and a path after an ellipsis
ad3a5c5 Record the seventh review round, and write the evidence from the run
9e0fa4c Launch the application from Run.bat or Run.ps1 and open it in the browser
32dad23 Open the path a base without a leading slash is served from
fccd4ad Reuse a development server this checkout started any other way
06f2b53 Merge branch 'phase/01-application-foundation' into run-launcher
4ad4efa Read a secret written after a dot, and learn a keyboard without recording it
688a037 Keep an imported shortcut, hide one the browser takes, and follow the dock
6e0f9fb List a newer copy of the saved workspaces, and place every default on a key
b45d0ce Record the eighth review round, and write the evidence from the run
6d0e80b Keep redaction linear, read Command on its own layer, and keep a side panel on its side
cb375a5 Record the ninth review round, and write the evidence from the run
9f9e2ac Ring the keyboard's place, read the Command layer honestly, and hold every rule to what it enforces
7d255f6 Read a path once, answer a finger on a palette row, and hold every claim to what the code does
7be9b80 Name a key that can end the Command wait, keep a logged field out of redaction, and hold each proof to what was run
82e40d4 Name a key the reader's platform delivers, give text its own package, and keep the shell inside the page
6f21d56 Keep a notice beside the reader's focus, hold the record to the tests it names, and keep text a leaf
155382b Show a refusal in the dialogue's own footer, refuse the presses a reader relies on, and read every quote in the record
1936898 Keep a dialogue's footer whole, hold each rule to what it reads, and ask for a Command press only while it is asked
e2b9fb9 Write every surface in the application's text, name a copy as it was typed, and keep room in a dialogue for a finger
3dfbdf7 Keep damaged text aside until there is room, give every copy a name of its own, and draw the focus ring whole at any scale
ce1d1e5 Check every signal fixture in one pass, and hold a loopable sine to a length it had to round
6bd0c2f Ask again every millisecond while a web test waits for a promise to settle
185a0ac Wait for the first layout reading to be adopted before asking for another
b56b2f6 Load the application afresh only for the test that its import reads nothing
61fa2b0 Take what a composition test set on the page off it after every test
d82176d Hold the capability registry to detecting once, logging at Info and forgetting a listener that leaves
d860188 Set a workspace name in one change where only what follows it is tested
0dcc9f4 Read a review record in the test's own process, and hold the stale-report refusal to a test of its own
4e6c703 Hold the workspace name field to the name it sends with nothing typed
55c7948 Tell the browsers apart that claim to be each other, and keep listening while anyone does
c46ee84 Type in the palette before holding it to announcing the count once typing stops
1e88763 Hold a cut to the part of a text it reads, not only to what it returns
cb5f597 Hold a recovery notice at the word bound to being said whole
f2b22e6 Hold an identifier's shape at both ends of its length
4732700 Hold the storage test to the sentence, and leave its urgency to the composition test
c467396 Ask the build gate what it finds in the test's own process, on a machine of the test's own
a20bbed Name the refusal each sample time check expects, and try each bound where it falls
54d4c57 Hold an Option press in a field to typing, reported as AltGr or not, in the test named for both
c3bf950 Hold the shell's command identifiers to being distinct in one test
f3e7a1b Count the soloed processor's latency, and name every problem a broken instance has
714315b Hold a mapped failure to the failure it was given
7b18cf6 Hold the sample project's regions and markers to identifiers of their own
820d02b Ask the launcher every question in one PowerShell, and hold the stated range to an answer of one of two
811f43f Hold the log panel's update depth by every test that draws it
b824086 Hold a rename of a workspace the user made by the test that trims the name
c102fd2 Try a long press at its exact time and tolerance
f1de90d Tell presses apart by every modifier, and read Caps Lock where it is on
5e00bbb Read each file's comments once for every width rule
b978c3a Hold an unreadable stored shortcut profile by the store's own tests
c154ea5 Read the command route's control in the program the rule already has
85bd974 Rank palette results against rivals that would come first alphabetically
9b873b3 Hold six web assertions to the exact value where they held any value
945e209 Hold a command group's undo to its order, and a refusal's record to what it names
5b0dd50 Show the shifted level of a zoom key left alone by the reservations themselves
d7844cf Refuse each malformed press and binding by its own code, and read a written shortcut
bf350f2 Parse each file once for every export rule, and read the floor's library once for every snippet
b4c8e83 Read each file's code once for every architecture rule, and give the browser floor a file of its own
de7ea81 Hold three architecture rules to having read what they check, and title the domain's manifest rule by what it holds
8e63289 Key a shortcut by what it holds, and write every Apple modifier in Apple's order
1b852a0 Wait a turn of the task queue after mounting the application, not two microtasks
0234d0e Keep another command's binding through a rebind and an unbind, and the original whole
07c3d40 Hold the note to no cause while the map is asked for, whatever the asking is called
d741513 Wrap the bounded-cut comment to the width comments are written at
0b280ac Hold each browser test to the proof its title names, and drop the ones another test already holds
dbb1ba7 Run at a scaled display only what a scale can move, and each engine-free proof on one engine
2140e6d Run the architecture rules once in a commit's checks, and check types without rebuilding what has not changed
9fed685 Fill the browser floor's opening comment to the width the tree's comments are written at
1e156ee Say what the reload test waits for before it reloads
2f70ee3 Merge branch 'test-audit-repo' into test-audit
2fe3b6b Merge branch 'test-audit-packages' into test-audit
cfccf0e Merge branch 'test-audit-web' into test-audit
959fcc6 Check a package's types without rebuilding what has not changed
a5125b8 Hold redaction's cost against ordinary prose, so a window read for each start fails
2b8f5fd Read a share's root in prose, and hold each path redaction to the text it leaves
3a21b02 Hold the diagnostic mode's length and the bundle's text to their exact values
b84999d Show that a divided bottom strip is read as the bottom, and hold the workspace answers to exact values
bcf35af Build each palette the contrast tests read once, and hold the chrome and a grey to every channel
003f899 Give the console back after the notice test that silences it
ce65a17 Read the theme a provider writes onto the document, not the one an earlier test left
80559e0 Read what an open menu shows from one opening
0219c7b Merge branch 'test-audit-ui' into test-audit
e330ede Check a record and a build when the check is run through a link
3dff546 Hold the log panel, a feature's name, a soloed latency and a refusal's record to what each claims
91f79fb Keep the colour-scheme listener sent before the system changes, where WebKit hears the change
d97b1f6 Merge branch 'test-audit-e2e' into test-audit
87e964f Fill the refusal record's comment to the width comments are written at
a90efdf Run every audit and every test the dock measures at a scaled display, and pause before the first press
8b46e45 Draw the focus ring on a panel's contents, compare names by one rule on every machine, and say every notice's fact at the start
542cb3e Merge branch 'phase/01-application-foundation' into test-audit
dc60556 Merge the test audit: faster checks, and tests that fail for the reasons they give
662a255 Reach the status bar from the keyboard, refuse naming where names cannot be compared, and keep every workspace of a copy
```

The four launcher commits, `9e0fa4c` to `06f2b53`, were made on this branch
separately and kept at the owner's request: they add `Run.bat`, `Run.ps1`, their
test and four lines of `.gitattributes`, and touch nothing of this phase's work.
The test audit's sixty-nine commits, `dc60556` and the sixty-eight it brought
that the phase did not hold, were made by another session on a branch of their
own, `test-audit`, into which the phase was merged first as `542cb3e`, and were
merged into the phase as `dc60556` while the twentieth round's lenses read
`8b46e45`; the owner decided that the merge stands, and the twentieth round
reviewed it, and answers its commits' messages in the record rather than
amending them. The commit that carries this version of the package, and the
twenty-first round's record, follows the last above. The list stopped at
`947fcef` in a version before, leaving out the two commits that closed the
second round (F-167).

The phase lands on the main branch as one commit holding its final tree, merged
by squashing, at the owner's decision in the twenty-first round, so the commits
above are the branch's history, which is never pushed, and the absolute local
paths some of them hold go nowhere (F-339, F-555).

## Reviewer findings and remediation

`reviews/phase-01-review.md` holds every finding, its verification status and
its disposition. Seven lens reviews were run and reported there; every finding
was verified or disproved before anything was changed for it, and the
disposition table in that file records what was done with each one.

An earlier version of this section described that process in the present tense,
as though it were under way, and pointed at a file that did not exist (F-78).

Twenty-one rounds were run, each with all seven lenses, read-only. The count is
the number of rows below it, which it stopped matching in the twelfth round
(F-771):

| Round | Over | Findings | Blocking |
| --- | --- | --- | --- |
| First | the phase as built | 85, F-01 to F-85, eight of them against this package | 1 CRITICAL, 14 HIGH |
| Second | `3d4c669`, the first remediation | 62, F-86 to F-147 | 6 HIGH |
| Third | `b306f64`, the second remediation | 78, F-148 to F-225, merged from 102 the lenses reported | 7 HIGH |
| Fourth | `70fcf81`, the third remediation | 59, F-226 to F-284, merged from 70 the lenses reported and two partial closures | 2 HIGH |
| Fifth | `56c4a4c`, the fourth remediation | 55, F-285 to F-339, merged from 68 the lenses reported | 2 HIGH |
| Sixth | `929f8e9`, the fifth remediation | 46, F-340 to F-385, merged from 62 the lenses reported and one regrade | 1 HIGH, and two MEDIUMs regraded HIGH in the seventh round (F-446) |
| Seventh | `38ee4f1`, the sixth remediation | 61, F-386 to F-446, merged from 80 the lenses reported, and one found while fixing them | 2 HIGH |
| Eighth | `ad3a5c5`, the seventh remediation | 71, F-447 to F-517, merged from 89 the lenses reported | 1 HIGH |
| Ninth | `b45d0ce`, the eighth remediation | 48, F-518 to F-565, merged from 64 the lenses reported, and one found while fixing them | none |
| Tenth | `cb375a5`, the ninth remediation | 64, F-566 to F-629, merged from 76 the lenses reported | none |
| Eleventh | `9f9e2ac`, the tenth remediation | 65, F-630 to F-694, merged from 82 the lenses reported, and two found while proving them and reading the change | 2 HIGH |
| Twelfth | `7d255f6`, the eleventh remediation | 54, F-695 to F-748, merged from 60 the lenses reported, and two found while fixing them | 1 HIGH |
| Thirteenth | `7be9b80`, the twelfth remediation | 49, F-749 to F-797, merged from 61 the lenses reported, and one found while verifying the baseline | 1 HIGH |
| Fourteenth | `82e40d4`, the thirteenth remediation | 51, F-798 to F-848, merged from 66 the lenses reported, and one found while fixing them | none |
| Fifteenth | `6f21d56`, the fourteenth remediation | 45, F-849 to F-893, merged from 57 the lenses reported, and one found while proving them | none |
| Sixteenth | `155382b`, the fifteenth remediation | 40, F-894 to F-933, merged from 65 the lenses reported | none |
| Seventeenth | `1936898`, the sixteenth remediation | 34, F-934 to F-967, merged from 47 the lenses reported | none |
| Eighteenth | `e2b9fb9`, the seventeenth remediation | 28, F-968 to F-995, merged from 40 the lenses reported | none |
| Nineteenth | `3dfbdf7`, the eighteenth remediation | 34, F-996 to F-1029, merged from 40 the lenses reported | none |
| Twentieth | `dc60556`, the nineteenth remediation and the test audit | 37, F-1030 to F-1066, merged from 51 the lenses reported | none |
| Twenty-first | `662a255`, the twentieth remediation | 31, F-1067 to F-1097, merged from 36 the lenses reported | none |

That is 1097 findings, and the record gives each one a disposition. Every
`BLOCKER`, `CRITICAL` and `HIGH` is fixed. Every `MEDIUM` is fixed, or accepted
in whole or in part with its reason and its owner. Those accepted are F-175, in
part, and F-188, of the third round; F-297, in part, of the fifth, until the
sixth removed the part it left (F-379); and F-459, in part, of the eighth, for
F-302's marker, owed to Phase 05. F-458, accepted whole in the eighth round, is
fixed in the ninth (F-522), as are F-407 and F-331, which F-459 accepted, and
F-304's filter; its scroll position is owed to Phase 04 (F-560). This said only
two of the third round's were accepted (F-561). The tenth round accepted two
MEDIUMs in part: F-579, which disables a binding by the union of the supported
engines rather than by the browser in force, so a profile means the same thing
wherever it is carried; and F-574, where the shell declares a minimum width
rather than reflowing below it, which is the owner's decision and leaves WCAG
1.4.10 unmet below that width. Both are owner Phase 14. F-574 was marked
**Fixed** whole and is regraded here, because its substance was deferred and
counted in nothing (F-689). The eleventh round accepted one MEDIUM in part:
F-641, whose two rows went because the table's own criterion rejects them, and
whose wider question — a table of what never arrives and what may not, with the
application disabling only the first — is the same question as F-579's
remainder. Owner Phase 14. The twelfth round accepted one MEDIUM in part: F-698,
where a bare `seed=` was kept, and the thirteenth restated the trade without
reversing it (F-767). The fourteenth reversed it at the owner's decision
(F-817): a bare `seed=` is how a wallet's recovery phrase is written, and it is
removed now with every name that ends in the word, `recoverySeed` and `hdSeed`
among them, and with `seedWords`, while `randomSeed`, the number a generator of
noise, identifiers or fixtures starts from, is named whole and kept. Nothing
this tree logs is called `seed`, and the rule that holds the logged field names
to what is logged says so the day something is. F-698 is fixed, and Phase 14 no
longer owes a rule for it. Each `LOW` and `NOTE` left open names its owner, and
the eleventh round left three of its own, all owner Phase 14: F-645's reading of
the layout map once for a return that fires two events, F-684's convention of
its own for Android, and F-689, which is F-574's reflow. The twelfth round left
one premise of its own, also owner Phase 14: whether WebKit suppresses the click
it synthesises from a pencil tap as it does from a finger tap (F-699), which a
pen driven through the Chrome DevTools Protocol cannot show. The fourteenth
round closed F-698 and left one premise of its own, also owner Phase 14:
Safari's own list of what it keeps from the page, which the Apple reservation
rows then stood on (F-818). The fifteenth round fixed every MEDIUM it found,
removed the Apple rows no read list keeps, since WebKit gives the page every key
equivalent first, which leaves Safari's own menus with F-818's premise (F-866),
and left one premise of its own, also owner Phase 14: whether an on-screen
keyboard on a phone or a tablet hides a refusal in a dialogue (F-867). The
sixteenth round fixed both MEDIUMs it found, and accepted one LOW as part of
F-867's item, since the same device check answers it: the footer it put the
refusal in is the part of the page an on-screen keyboard covers first (F-898).
The seventeenth round fixed the MEDIUM it found (F-934), and left one premise of
its own, also owner Phase 14: what a finger on WebKit, a keyboard reader and a
phone's browser toolbars do with a dialogue taller than the page (F-962). The
eighteenth round fixed every finding it found, and left one check of its own,
also owner Phase 14: whether Safari on an iPhone, and on iPadOS, zooms into a
text field, which no engine the suite drives does (F-975); a keyboard reader's
part of F-962 is tested now (F-990). What F-993 records, a workspace on screen
not kept while a damaged mounted layout too large to set aside waits to be
discarded, is no item of its own: it is part of the export and discard of text
set aside that Phase 02 owes (F-206), which names that layout's key now. The
nineteenth round fixed the MEDIUM it found (F-996), widened that owe to every
store whose held text locks its writes out, the collection and the shortcut
profiles as well (F-1021), with the export and the discard reachable before the
quota is met, and a bound on each list set aside, also Phase 02's and part of
the same item (F-1022), and left two items of its own: the WebKit hang, a test
timed out loading the page or in its script in three of eight whole runs, whose
cause the round's diagnosis did not find, owner Phase 14 with the browser matrix
under load (F-1002); and Safari's erasing of every script-written store of a
site not used for seven days of browsing unless it is on the Home Screen, owner
Phase 12, which owns persistence, with the check on a device in Phase 14
(F-1025). The check on an iPhone F-975 owes gains the same phone turned on its
side (F-1026). The twentieth round fixed both MEDIUMs it found (F-1030, F-1031)
and every other finding, and left no item of its own; the phone's check reads
the prefixed rule on the text's size, which the build keeps now (F-1034). The
twenty-first round fixed every finding it found, and left one item of its own,
owner Phase 14 beside the checks on a device: the rule for names on Safari, on a
Mac, an iPhone and an iPad, whose collation is Apple's and which no engine the
suite drives on Windows gives (F-1090); the check on an iPad of the tablet's
touch points is part of F-975's item (F-1093). With F-618, F-622 in part and
F-579's remainder, fifteen items are open and each has a carrier. The third
round corrected nineteen second-round dispositions that claimed more than the
code did, the fourth thirty-five earlier ones, the fifth twelve more, the sixth
twenty-six, the seventh twenty-nine, the eighth thirty-six, the ninth
thirty-seven, the tenth seventeen, the eleventh thirty-five, the twelfth
thirty-three, the thirteenth thirty-four, the fourteenth fifty-eight, the
fifteenth thirty-nine, the sixteenth twenty-nine, the seventeenth twenty-eight,
the eighteenth twenty-five, the nineteenth twenty-five, the twentieth
twenty-four and the twenty-first thirty-three, each after what it first said.
The number counts every correction in the review record carrying the round's
marker, wherever it is written, a marker broken across two lines included: the
tenth round's correction to the ninth round's preamble carries one so broken and
is counted, and the tenth round's two paragraphs of prose corrections at the end
of its section, F-628's and F-626's, carry none and are in no count (F-650,
F-1027), and a correction written into a proof log, which is not part of the
record, is in none either (F-844). An earlier version of this line said the
seventh round corrected thirty-three, which does not reconcile with the record's
own markers (F-628). The seventh round's lens reports and proof log were lost
before it was written up, and its counts and proofs were reconstructed (F-514);
the eighth round's and every round's since were kept. Two items were for the
owner rather than the code, and the owner decided both in the twenty-first
round: the absolute local paths in the branch's unpushed history, in earlier
versions of the resume note and in the launcher's test as `fccd4ad` committed
it, go nowhere, since the phase lands on the main branch as one commit merged by
squashing and the branch is never pushed (F-339, F-555); and `combineSinks`,
which nothing uses, is kept with its four tests (F-364, F-466). The version of
this section before the third round described the first round alone (F-167).
Several statements in this package exist because a reviewer showed the previous
wording to be false; each of those is marked with the finding that caused it.