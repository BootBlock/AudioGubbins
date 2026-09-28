> **Status:** Done. 2026-09-28: the twenty-first review round is fixed and
> written into the review record (F-1067 to F-1097), and Phase 01 is closed at
> `PASS` at the owner's decision on the gates, with no further round of the
> lenses: the ledger gives it `PASS` and phases 02 and 03 `READY`, and its
> handoff capsule is `docs/spec/traceability/handoffs/phase-01.md`. It lands on
> `main` as one commit, merged by squashing.

# Phase 01 — Application Foundation

Resume note. It says where the work is and what is left; the review record holds
every finding and its disposition, and the evidence package holds the counts.

## Where the work is

|                  |                                                                         |
| ---------------- | ----------------------------------------------------------------------- |
| Primary checkout | the repository's own directory — on `main`, for reading and integrating |
| Worktree         | `../AudioGubbins-phase-01`, beside it — **do the work here**            |
| Branch           | `phase/01-application-foundation`                                       |
| Remote           | `origin`, with `main` pushed as far as the spec commits                 |

## Checking the state

```bash
cd ../AudioGubbins-phase-01
pnpm run verify:commit             # lint, forced typecheck, unit tests, record, cruise
pnpm run test:e2e                  # every browser project
cargo test --workspace             # 5 tests
cd docs/spec && python tools/verify_hardening.py && sha256sum -c CHECKSUMS.sha256
```

## The review so far

- Round 1: 85 findings (F-01 to F-85). Round 2: 62 (F-86 to F-147). Round 3: 78
  (F-148 to F-225), merged from the 102 the seven lenses reported. Round 4: 59
  (F-226 to F-284), merged from 70 and two partial closures. Round 5: 55 (F-285
  to F-339), merged from 68. Round 6: 46 (F-340 to F-385), merged from 62 and
  one regrade. Round 7: 61 (F-386 to F-446), merged from 80 and one found while
  fixing them. Round 8: 71 (F-447 to F-517), merged from 89. Round 9: 48 (F-518
  to F-565), merged from 64 and one found while fixing them. Round 10: 64 (F-566
  to F-629), merged from 76. Round 11: 65 (F-630 to F-694), merged from 82 and
  two found while proving them and reading the change. Round 12: 54 (F-695 to
  F-748), merged from 60 and two found while fixing them. Round 13: 49 (F-749 to
  F-797), merged from 61 and one found while verifying the baseline. Round 14:
  51 (F-798 to F-848), merged from 66 and one found while fixing them. Round 15:
  45 (F-849 to F-893), merged from 57 and one found while proving them. Round
  16: 40 (F-894 to F-933), merged from 65. Round 17: 34 (F-934 to F-967), merged
  from 47. Round 18: 28 (F-968 to F-995), merged from 40. Round 19: 34 (F-996 to
  F-1029), merged from 40. Round 20: 37 (F-1030 to F-1066), merged from 51.
  Round 21: 31 (F-1067 to F-1097), merged from 36. All are in
  `docs/spec/reviews/phase-01-review.md`, each with a disposition. Round 3
  corrected nineteen round-2 dispositions, round 4 thirty-five earlier ones,
  round 5 twelve more, round 6 twenty-six, round 7 twenty-nine, round 8
  thirty-six, round 9 thirty-seven, round 10 seventeen, round 11 thirty-five,
  round 12 thirty-three, round 13 thirty-four, round 14 fifty-eight, round 15
  thirty-nine, round 16 twenty-nine, round 17 twenty-eight, round 18
  twenty-five, round 19 twenty-five, round 20 twenty-four and round 21
  thirty-three.
- Round 4's two HIGHs and every MEDIUM were fixed in `3bad50e`, round 5's in
  `e3b0a81`, round 6's in `9500102`, round 7's in `ae2a3f1` to `866f380`, round
  8's in `4ad4efa`, `688a037` and `6e0f9fb`, round 9's in `6d0e80b`, round 10's
  in `9f9e2ac`, round 11's in `7d255f6`, round 12's in `7be9b80`, round 13's in
  `82e40d4`, round 14's in `6f21d56`, round 15's in `155382b`, round 16's in
  `1936898`, round 17's in `e2b9fb9`, round 18's in `3dfbdf7`, round 19's in
  `8b46e45`, round 20's in `662a255`, which follows the test audit's merge,
  `dc60556`, and round 21's in the commit this list is part of, which follows
  `662a255`, the round reviewed. Each round names its own commit here as it is
  written up, and the round before it by hash: the eleventh round's commit
  carried this note with none of that round in it (F-703), and a rule now holds
  the list above to the review record's own rounds, and to its status line, its
  corrections sentence and its commit list with them (F-755). Each disposition
  from round 4 on names the mutation its test was proved with, or says it has no
  behaviour to prove.

## How the phase closed

1. No further round of the lenses runs, at the owner's decision on the gates
   (2026-09-28): the twenty-first round's findings are fixed and recorded, and
   the harness that was proving them was stopped, as the review record gives.
2. Done in the change that records the twenty-first round: the ledger gives
   Phase 01 `PASS` and phases 02 and 03 `READY`, the handoff capsule is written
   from the template, and this note is in `docs/todo/done/`.
3. Left to the session: commit the round on the branch, then land the phase on
   `main` as one commit holding its final tree, merged by squashing, push
   `main`, remove the worktree and delete the branch with `git branch -D`, at
   the owner's decision (F-339). The branch's commits, and the absolute local
   paths earlier versions of this note, from `5ade74a` on, and the launcher's
   test as `fccd4ad` committed it hold, are never pushed (F-339, F-555).
   `combineSinks` is kept with its four tests, at the owner's decision (F-364,
   F-466).

## Decisions the owner took in this phase

Each is written where the code and the record can point at it, so a reader can
tell a decision from a convenience.

- **The shell declares a minimum width rather than reflowing.** Below 640 CSS
  pixels AudioGubbins says how much room it needs instead of drawing a docking
  workspace it cannot lay out. `REQ-UX-057.1` states the width and records the
  WCAG 1.4.10 non-conformance below it, owned with `REQ-UX-029`; the reflow
  itself is on the list below, owner Phase 14 (F-574, F-689).
- **A bare `seed=` is redacted.** It is how a wallet's recovery phrase is
  written; `randomSeed`, the number a generator starts from, is named whole
  and kept. This reverses the trade F-698 made and F-767 restated (F-817).
- **A reservation row stands on an engine's own list, or on a reader.** The
  desktop rows neither Chromium's nor Firefox's list of what it keeps from
  the page holds — a tab by its number and Alt with an arrow — were removed
  rather than kept as a precaution (F-818), and so were the Apple rows for a
  tab by its number, back and forward, and Command with a comma, since
  WebKit gives the page every key equivalent first (F-866). The address bar,
  zoom and F11, which F-818 removed with them, are rows again, of the third
  kind below (F-852).
- **A press a reader relies on the browser for is refused, with a reason.**
  The ways into the address bar, the zoom keys and F11 reach the page, and
  a binding on one would take them from a reader silently, so they are a
  third kind of row, refused on every engine (F-852).
- **A refusal raised in a dialogue is a line in the dialogue.** It is shown
  in the dialogue's own flow, above its actions, not laid over it (F-851).
- **Every dialogue has a footer that never scrolls.** A dialogue is a title,
  a part that scrolls, and a footer holding the refusal line and the
  actions. The footer has no cap, so a refusal is never cut and stays beside
  the actions; the part that scrolls keeps room for one whole control; and
  where the three are taller than the page allows, the dialogue itself
  scrolls rather than cutting any of them. This revises F-893's footer,
  capped at 40dvh and scrolling inside itself, which left the part that
  scrolls a sliver on a short page and scrolled a long refusal's start out
  of sight (F-894, F-897).
- **The record is read against a run.** `verify:commit` reads every quoted
  string of three words or more in a disposition, and every title one names,
  against the titles a run reports; a quote that is no title is listed in the
  record with the title its test has now, or as prose (F-798, F-849).
- **Two names are one by the same rule on every machine.** English collation,
  with every option that decides whether two names are one stated, punctuation
  and digits compared as they are written, since a name travels in an exported
  file (F-999); the check is made once, at the capability probe at the start,
  which the owner counts as the first use of naming, a runtime that cannot make
  its collator answered as one that fails it (F-1091), and a runtime that fails
  it starts, with naming refused and said as a missing capability, where a check
  as the rule loaded left the page blank (F-1041). An identifier keeps the
  letters, marks and digits of every script (F-1001), derives the code points a
  reader sees nothing of as nothing and the Hangul fillers as a gap, and never
  is a stem Windows reserves for a device, which is numbered; a name of letters
  a reader cannot see alone is refused as blank (F-1089); a typed name that ends
  in the word copy is read as a copy's (F-1004); one allocator in the text
  package holds a list's names and identifiers, with no cap on how many stored
  entries are read (F-1012, F-1023); a name another workspace has, or has as the
  list shows it, is refused (F-1019); and a mounted workspace whose name another
  has is listed under it numbered from two, as an import is, while saving keeps
  an arrangement alone (F-997). A browser test asks each engine the rule through
  the page; Apple's collation, on a Mac, an iPhone and an iPad, is owed to Phase
  14 (F-1090).
- **What makes room is said once, as an item of its own.** The advice that
  nothing makes room yet without a loss stands in the status bar while any
  store's text waits for room, and cannot be dismissed while it does; a notice
  and the announcement of a write say the fact, and that AudioGubbins tries
  again each time you change a workspace, or your shortcuts (F-998, F-1018).
  While what the status bar holds reaches past what it shows, downwards or
  sideways, the bar is a stop of the Tab order, with its name and a ring drawn
  inside it, since no help exists yet for a control of the advice's own to lead
  to (F-1037, F-1073); and a waiting notice's fact says what cannot be kept
  until there is room, seventy-eight words of facts said where every store's
  text waits (F-1060, F-1087).
- **A focus ring the dock would clip is drawn inside.** A group's contents and a
  dock tab draw the ring inside themselves, with a pixel of the canvas between
  the ring and the group's border in forced colours (F-996, F-1003), and the tab
  a group shows is filled with the accent while it holds focus, since the ring
  covers its line (F-1003).
- **A stored layout is parsed.** It is built from the fields the reading checks,
  a panel's title held to the bound a workspace's name has, 120 characters, and
  its parameters to named text, numbers and true or false (F-1010, F-1044).
- **A key Chromium loses is the engine's.** A key pressed between the last frame
  of an arrow scroll and its end scrolls nothing; that is recorded as the
  engine's behaviour, which a keyboard reader meets too and the page has no
  remedy for (F-1005). The keys test asserts, from a record the page keeps, that
  no key was pressed while a scroll of the dialogue was open, so that defect
  fails it whether or not the engine loses the press (F-1053).
- **The text is drawn at the size it is given.** The document asks for
  `text-size-adjust: 100%`, not `none`, so a reader's own text size and zoom
  still apply (F-1026). Safari on iOS 16.4 is on the browser floor beside Safari
  16.4 on a Mac, so the build keeps `-webkit-text-size-adjust`, the form Safari
  on an iPhone reads, which the build's gate, reading each stylesheet with
  Lightning CSS's parser, and a rule of the floor hold (F-1034, F-1092). No
  project is iOS WebKit, so the floor's iOS entry is held by the build alone
  until Phase 14's check on a device; the tablet sends the agent Safari on an
  iPad sends by default, a Mac's, with the iPad's five touch points given by the
  suite, since Playwright's WebKit reports none, and a real iPad's reading of
  them is owed to the same check (F-1093).
- **What cannot be settled here goes to its phase.** The bound on text set aside
  to Phase 02 (F-1022); Safari's erasing of a site's storage to Phase 12, with
  the check on a device in Phase 14 (F-1025); and the WebKit hang, diagnosed
  first in this phase and its cause not found, to Phase 14 as one open item
  (F-1002).
- **The test audit's merge stands.** `dc60556`, sixty-nine commits of tests and
  tools another session merged while the twentieth round's lenses read
  `8b46e45`, stands, and the twentieth round reviewed it; its messages are
  answered in the review record, not amended.
- **Every project runs every test its specs hold.** The scaled Chromium project
  runs the whole smoke and accessibility specs again, as F-960 decided; the tag
  for scale selects tests for the Firefox project at 110% alone, which keeps the
  sixty the audit tagged, and the test of the advice on making room; and the tag
  for tests run once is gone (F-1030). The rules read every selector Playwright
  gives a project, hold each project's specs to a table, and read a tag written
  in a title (F-1068).
- **The tests of cost share the fixtures package's two measures.**
  `relativeCost` reads the workload and the baseline in turn, in blocks, by
  processor time, each until it has spent a quarter of a second and been read at
  least thirty-two times, and no further pair of blocks once those read have
  cost 32 seconds, the owner's decision while the round was proved, revising a
  first one of sixteen blocks a side, which doubled the time of every light
  comparison; each defect of a test it measures was proven quiet and under forty
  busy processes until the owner's decision on the gates; a test that reads it
  is allowed 520 seconds, derived in code from its cap and the longest reading
  it allows, 12 seconds, which it enforces (F-1097); `comparisonsIn`, beside it,
  counts the comparisons of names a piece of work makes, for the tests of
  numbering, and reads no machine time, its tests holding four times the names
  to fewer than 5.5 times the comparisons, its ceiling (F-1083, F-1097); the
  tests of the text and diagnostics packages may take the fixtures package, and
  those of the input and version packages may not, the domain package's cannot,
  a decision of its own, `ADR-0019` (F-1031, F-1033, F-1036, F-1054, F-1061,
  F-1076).
- **A stored identifier is one AudioGubbins derives.** One read from storage is
  kept only where it is its own derivation, within the bound its store gives,
  227 UTF-8 bytes for a profile, the 255 of a file's name less the ending the
  command layer writes, and 227 for a workspace, a bound of storage (F-1074);
  any other is set aside with a notice, and an exported file's name is held
  within 255 bytes and said whole in its announcement, in quotation marks
  (F-1038, F-1069).
- **A Proof the audit changed is proved again.** Every Proof of the nineteenth
  round whose test the audit changed was proved again over the tree the
  twentieth round commits, beside the proofs the audit's messages claim, every
  log kept (F-1039).
- **The gates check what they build.** The tools a test imports keep their types
  in comments, compiled and checked by the root project, with no declaration
  beside them (F-1046); and the gates of a commit and of an integration force
  the whole typecheck, the everyday one staying incremental (F-1057).
- **A request names its engine and its test.** The request log writes the whole
  user agent, and the suite sends a header naming the project and the test,
  which the log writes (F-1063); and one test launches a Chromium of its own
  with classic scrollbars to read the ring of contents that scroll, every
  project keeping its widths (F-1064).
- **A copy is named in few words.** The name field's description says that
  Duplicate uses the name typed there, or names the copy after the workspace,
  the number left to the announcement of the copy (F-1043).
- **The review sizes stand.** The recorded review sizes of the shortcut commands
  and the layout commands stay at 168 and 125 logical lines, the availability of
  naming written once beside the other rules of a command's availability
  (F-1041).
- **Naming unavailable is said before the user acts.** One note above the
  shortcuts gives the reason, each control that names something is marked
  unavailable and described by it, the Import label is drawn as an unavailable
  button, and Rename on a built-in workspace keeps the store's own reason and
  advises a copy only where Duplicate can make one (F-1088).
- **A proof names its tree.** The evidence writes each step of its block of
  commands in full, which a rule reads (F-1067); a build equal in every file but
  the source map meets the rule on re-runs, since the map is not run (F-1094);
  and the status bar's ring beside a classic scrollbar has a test of its own
  (F-1075).
- **The gates are light until the application is much more developed.** Phase 01
  closes with the twenty-first round, with no further round of the lenses. From
  then on a change passes the whole unit suite, the compiler and the lint, with
  no harness of mutations and no runs under load, though a new test is still
  seen to fail once by its author; each phase has one pass of review, its
  findings fixed; and the browser suite is no gate of a change.
- **Phase 01 lands as one squashed commit.** Its final tree is one commit on
  `main`; the branch's commits and the absolute local paths in them are never
  pushed, and the branch is then deleted (F-339, F-555).
- **`combineSinks` stays.** It is kept with its four tests (F-364, F-466).

## Owed to later phases, for the handoff

Each is a finding the review record tracks or accepts, or a part of one fixed in
this phase that its disposition leaves to a later one: the keys F-973 and F-993
add, and the stores F-1021 adds, to Phase 02's export and discard of text set
aside, and the check on a real iPhone that F-975 owes to Phase 14, which F-1026
widens. This list carried them until the handoff capsule was written; the
capsule, `docs/spec/traceability/handoffs/phase-01.md`, carries them now:

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

## Rules this phase works under

- Verify a finding before changing anything, and prove a regression test against
  the code it was written to catch. Name the mutation in the finding's
  disposition.
- Never reduce scope, delete a test or relax a requirement as a fix.
- `pnpm run verify:commit` before every commit, and the browser suite before a
  commit that changes what a browser runs, until the owner's decision on the
  gates in the twenty-first round: from then on the whole unit suite, the
  compiler and the lint, with no harness of mutations, and the browser suite no
  gate of a change.
- After any edit under `docs/spec/`, run `python tools/verify_hardening.py` from
  `docs/spec/` and regenerate `CHECKSUMS.sha256`.
- A browser test that asserts on shortcut text, or presses a shortcut, reads the
  platform through `tests/e2e/platform.ts`.
- Scratch files go outside the tree: Playwright empties `test-results/` on
  every run. Write what the record needs into the record as soon as it is
  known.
- The review lenses run read-only against a committed tree, never building or
  running suites.
- No absolute local path in anything committed; name a checkout relative to the
  repository.
