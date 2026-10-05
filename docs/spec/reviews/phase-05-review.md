# Phase 05 — Core Non-Destructive Editing — Review Record

The nine lenses `phases/phase-05-core-non-destructive-editing.md` requires,
run as five independent read-only reviewers over
`git diff 250362f..3acce62`, the phase as it stood when its implementation and
its gate run were complete, against the packet, `contracts/review-gates.md`,
the owned requirements and `ADR-0050` to `ADR-0053`. No reviewer was told to
preserve the implementation, and none edited the tree.

Under the owner's decision of 2026-09-28, which still holds while the
application is young, the phase has one review pass, whose verified findings
are all fixed, rejected with the reasoning or explicitly accepted, and no
looped rounds and no mutation harness. Each fix still carries a test that its
author saw fail against the code it replaced, unless the entry says why none
can.

Severity follows `contracts/review-gates.md`. `BLOCKER`, `CRITICAL` and `HIGH`
prevent `PASS`. `MEDIUM` must be fixed or explicitly accepted with
justification and tracking. `LOW` and `NOTE` may remain if tracked. Two
findings a reviewer rated between low and medium are recorded at `MEDIUM`, the
higher.

Every finding was verified by its reviewer before it was reported, by a run
or a reading of the code against the rule it breaks, and again by the
remediation, which reproduced it in a test before fixing it. **Status**
records that verification:

- `CONFIRMED` — reproduced, or established by reading the code against the
  requirement.
- `REJECTED` — investigated and shown not to hold. The reasoning is recorded.

Findings are numbered for this phase alone, from F-01, as Phase 04's are.
Where a row names Phase 02's findings, such as the inherited F-55, it says so.

## Lenses run

| Reviewer | Lenses | Findings | Blocking |
| --- | --- | --- | --- |
| 1 | Architecture; Code Quality / Maintainability | 12 (F-01 to F-12) | 1 HIGH |
| 2 | Audio Correctness; Codec / Interchange Correctness | 5 (F-13 to F-17) | none |
| 3 | Data Integrity / Recovery; Security / Malformed Input | 4 (F-18 to F-21) | none |
| 4 | UX / Accessibility | 7 (F-22 to F-28) | 1 HIGH |
| 5 | Testing / Regression; Adversarial Agent-Quality | 6 (F-29 to F-34), and a list of the areas found sound | none |

No finding was raised by two reviewers. The thirty-four are two `HIGH`, nineteen
`MEDIUM`, twelve `LOW` and one `NOTE`.

## Found before the review

The gate run that completed the implementation, before any lens ran, found
and fixed: Prettier's formatting of the audio import commands (`685ab48`);
three module comments past the comment width (`8a6609a`); a dependency cycle
between the edit operations and the plan, broken by moving the fade shape and
direction to their own module, and the rule that fixtures are test-only not
treating a package's `src/testing/` as test code (`3acce62`); and markers
hidden under their overlay that could still be grabbed (`77447f1`).

## Blocking findings

### F-01 — HIGH — Splitting a region with processing was refused, or kept the wrong processing

- **Lens:** Architecture. **Status:** `CONFIRMED`, reproduced.
- Splitting a region whose processing lay after or over the split point was
  refused, because the second part was added carrying processing, which
  `project.add-region` refuses; and the first part kept its whole chain,
  because setting a region's properties keeps its processing. `REQ-EDIT-014`
  makes a region's processing its own, and `ADR-0051` says each part keeps
  the processing that covers it. F-02, raised beside it, found the meaning of
  a split written in the application layer (`split-commands.ts`,
  `region-target.ts`) rather than the domain.
- **Disposition:** fixed in `b35dc9c`, with F-02. What a split makes lives in
  the domain, `region-split.ts` (`splitRegion`, `splitWholeAsset`,
  `restateRegion`): the two parts, each with the processing that covers it,
  the loop where it lies wholly within a part, and the whole-asset split,
  which measures the edited length itself. The project change is composed
  from the existing region commands in one undoable group, so no inverse
  carries a whole chain. `region-split.test.ts` splits before, after and over
  the processing and requires
  `sounds as the region did, part for part, with a fade over the split`;
  `editing-commands.test.ts` requires
  `withdraws back to the first operation not kept in place and applies the rest, undone whole`.
  The sub-claim that `split-commands.ts` derived a sample count from view
  input was overstated, since the values were already checked where they were
  read; the re-wrap is gone with the move.

### F-22 — HIGH — No region could be selected except by opening it

- **Lens:** UX / Accessibility. **Status:** `CONFIRMED`, reproduced.
- A tap on a region in the strip read as a tap on the empty strip, so the
  region commands found a region only in its own view, where the playhead
  cannot leave it; from the keyboard a region's ends could only move inwards,
  and a marker could not be selected at all. The refusals told the person to
  click a region, which a keyboard cannot do (`REQ-UX-005`, `REQ-EDIT-063`).
- **Disposition:** fixed in `2d97240`. A tap or click on a region's span or
  end in the strip selects it, Shift adding it, the shortest of overlapping
  regions taken so a longer one stays reachable outside it, through
  `editor.select-region`, which the palette runs too. New commands select the
  next and previous marker (the brackets) and region (Shift and the brackets)
  from the selection or the playhead, and the refusals name the tap and the
  keyboard route. A selected region is drawn apart in the strip. Tests in
  `edit-commands.test.ts`, `pointer-tools.test.ts`, `frame-composer.test.ts`
  and `tool-pointer.test.ts`, among them
  `selects the region tapped, on its span or its end, and adds one with shift`
  and
  `selects a region in a view of its sound from the keyboard, so its ends move both ways`.

## Non-blocking findings

| Id | Severity | Lens | Finding |
| --- | --- | --- | --- |
| F-02 | MEDIUM | Architecture | What a split means was written in the application layer, in `split-commands.ts` and `region-target.ts`, not the domain. |
| F-03 | MEDIUM | Code Quality | The edited source opened its file under the first read's signal and kept the opening, so a read cancelled while the file opened, or an opening that failed, failed every later read (`plan-content.ts`). |
| F-04 | MEDIUM | Architecture | `ClipboardPayload` was a domain alias of `EditPlan`, while what the clipboard holds, a slice of a plan with the records of the media it reads, was named otherwise, against `ADR-0053`. |
| F-05 | MEDIUM | Architecture | A paste that converts the sample rate was reachable only by an argument no menu, shortcut or command set, while the refusal said it could be asked for. |
| F-06 | MEDIUM | Code Quality | `projectEntries` planned every asset, placed its markers and regions and wrote it out as text before finding the entry unchanged. |
| F-07 | LOW | Code Quality | `counted` was written three or four times: the inherited F-55 was not wholly paid. |
| F-08 | LOW | Architecture | The codecs carried their own copy of the engine's cancellation, so a cancel the engine checks for by its own type could be taken for a fault. |
| F-09 | LOW | Architecture | The audition's side was encoded in a string key, and audition requests raced with no signal. |
| F-10 | LOW | Code Quality | Opening a project asked for every asset's file at once, and the linked-file lookups took no signal (`project-media-store.ts`). |
| F-11 | LOW | Code Quality | Sample counts were derived from the person's or the view's input where the domain's checked count belongs, and the loop crossfade check was copied from the domain. |
| F-12 | LOW | Code Quality | `QuickEditSession.asset` is written and never read. |
| F-13 | MEDIUM | Audio, Codec | A one-channel copy with a placed role was spread as mono on paste, and a lone Centre went to stereo at 0 dB (`channel-matrices.ts`). |
| F-14 | MEDIUM | Audio | A region's processing was not anchored in content frames through later edits of the asset: a reversal turned a fade round, a deletion inside a fade steepened it, and a paste inside processed range took the processing (`placement.ts`). |
| F-15 | LOW | Audio | A matrix stage summed zero factors, so an infinity made an untouched channel NaN, and a −0 a swap only moved came out +0 (`stage-arithmetic.ts`). |
| F-16 | LOW | Audio, Codec | A rate-converted paste split into pieces was resampled piece by piece (`paste-planning.ts`). |
| F-17 | NOTE | Codec | A comment in `sample-conversion.ts` said full scale is exclusive, where a 32-bit integer's largest code converts to 1.0. |
| F-18 | MEDIUM | Data Integrity | A cancelled import could commit the asset while the page said nothing was kept (`port-channel.ts`, `audio-import.ts`). |
| F-19 | MEDIUM | Data Integrity | A Quick Edit whose new project could not be opened left that project behind (`quick-edit-commands.ts`). |
| F-20 | MEDIUM | Data Integrity | A Quick Edit whose import threw left its project behind. Rated between low and medium. |
| F-21 | LOW | Data Integrity | Withdrawing a failed Quick Edit returned early when closing or removing its project failed, without reopening the project open before. |
| F-23 | MEDIUM | UX | A command button that could not run was disabled, with its reason in a tooltip no screen reader or touch reaches (`command-button.tsx`). |
| F-24 | MEDIUM | UX | The Inspector keyed its kept fields on their value, so the focus was lost after a rename or a tag change, and two regions of one name shared a draft. |
| F-25 | MEDIUM | UX | Buttons that swap or vanish dropped the focus: Import and Cancel in the Asset Browser, and the control that stops a region looping. |
| F-26 | MEDIUM | UX | The comparison view still said playing waits for the audio engine, announced the switch of side twice, hard-coded a label, and ignored whether audio can play. |
| F-27 | MEDIUM | UX | The Region tool was missing from the editor toolbar, and the tool descriptions omitted dragging a region's end. |
| F-28 | LOW | UX | The channel commands took channels by their numbers from 0; a refusal said to click a marker; the crossfade field did not submit. |
| F-29 | MEDIUM | Testing | The clipboard's split test built 200,000 segments, about two seconds and sensitive to load; the reviewer also claimed the argument was re-serialised at every level. |
| F-30 | MEDIUM | Testing | The audition test never checked that side A is what plays. |
| F-31 | MEDIUM | Testing | `edit.to-stereo` and `region.clear-loop` were untested, the layout and copy commands had no case with nothing selected, and an unscoped channel test asserted nothing of the operation. |
| F-32 | MEDIUM | Testing | The test of a second import while one runs raced its 50 ms poll. Rated between low and medium. |
| F-33 | LOW | Testing | The dismissed-chooser tests asserted after one turn of the event loop only. |
| F-34 | LOW | Adversarial | The browser test's reload checked that a marker and an edit were present, not their position or range. |

### Rejected

- **F-12**, wholly. `ADR-0053` says the Quick Edit session names the project
  and the asset; the Quick Edit test asserts both, and Phase 09's export
  will read the asset. A field the decision requires is not dead.
- **F-21**, in part. Reopening the project open before needs the made project
  closed first, so where closing fails it cannot be reopened; that part does
  not hold. The removal part holds and is fixed.
- **F-29**, in part. Halving the payload gives `n log n` serialisations, not a
  quadratic number. The test's size holds and is fixed.

## What the reviewers found sound

- The PCM readers: the 8-bit offset, 24-bit sign extension, AIFF and AIFF-C
  byte order, the extensible format's GUIDs, chunk padding, the bounds of
  RF64's `ds64`, and truncated data read to the last whole frame. The readers
  and the validation agree, and every codec read is bounded.
- Fades exact at their ends, anchors carried through every operation, gain
  bounds, the paste's refusal of another rate, and inverses that restore the
  state exactly; a paste holds the media before the records are added.
- Names never reach storage keys. No browser global in the domain, the codecs
  or the clipboard; no swallowed catch; no checker escape in production code;
  no test support in a production entry point; the Asset Browser's list keyed
  and updated in place.

## Disposition

Every verified finding is fixed, rejected with its reasoning, or accepted with
tracking. Each fix carries a test that failed against the code it replaced,
unless the entry says why none can. Commits are on `phase-05-editing`.

| Id | Disposition |
| --- | --- |
| F-01 | **Fixed** in `b35dc9c`, as above. |
| F-02 | **Fixed** in `b35dc9c`, with F-01: the split is the domain's, and the application composes the project change from it. Held by `region-split.test.ts`. |
| F-03 | **Fixed** in `afbb0ef`. The file opens under the reader's own lifetime, which release cancels, each read checks its own signal once the file is open, and a failed opening is cleared so the next read tries again. In `edited-source.test.ts` the tests `reads on after a read cancelled while its file was opening` and `opens its file again after an opening that failed` failed against the old source. |
| F-04 | **Fixed** in `3eabd20`. `@audiogubbins/clipboard` publishes `ClipboardPayload` with its origin, its plan and its records, as `ADR-0053` states it, and an insertion's content is typed as the `EditPlan` it is; the persisted form is unchanged and the ADR stands. A type has no behaviour to fail: the public contracts list holds the shape, and `clipboard.test.ts` was moved to it. |
| F-05 | **Fixed** in `9fe5542`. `edit.paste-converting-rate` is in the Edit menu beside Paste and in the palette, the hidden argument is withdrawn, and a plain paste's refusal names both rates and that command. The test `pastes audio at another rate only by the command that converts it, which a paste names` in `edit-commands.test.ts`. |
| F-06 | **Fixed** in `28f470a`. An asset's entries compare the records they were made from, by identity and then by their text, written once a record; only an entry made again is planned, and `projectEntry` plans one entry's asset alone. `project-assets.test.ts` counts the plans; `plans again only the asset a change touched, and keeps the entries of the rest` failed against the old code. |
| F-07 | **Fixed** in `a485b4d`, with remnants **accepted**. One `counted` in `packages/text`, which `packages/project-commands` now depends on (`ADR-0018` amended) and the timeline is given through its writing port; `counting.test.ts` holds it, among it `takes the singular for one alone`. CRC-32 is one, and the project listing's copy in the media roots is gone. Accepted with tracking, for Phase 06's handoff: `audio-graph` and `audio-engine` keep their own count, since `ADR-0030` keeps them free of the text package; a time of day to the second is written three ways (`browser-host.ts`, `app.tsx`, `diagnostics-panel.tsx`); `usage-measurement.ts` still lists projects by hand; and names are quoted two ways (`project-command.ts` and `wording.ts`). |
| F-08 | **Fixed** in `19681a3`. Cancellation lives in the domain, `cancellation.ts`, and the codecs' copy is deleted. The mismatch was not reachable in practice, since the feeder cancels with an error reason; `rejects with the shared cancellation error where the signal’s reason is not one` in `malformed-media.test.ts` failed against the old codecs. |
| F-09 | **Fixed** in `5b8dd99` and `82c644d`. The side is typed state in the history review store, and each request for a side's state replaces the one before by a signal passed down to the worker. `plays the side asked for last, whichever the worker answers first` in `audition-commands.test.ts`. |
| F-10 | **Fixed** in `ef4320a`. Files are asked for four at a time in project order, none once the project is let go, and the linked-file port takes the signal of the work that wants a file. The tests `asks for a few files at a time, however many assets the project has` and `gives up the files it asks for, and asks for no more, once the project is let go` in `project-media-store.test.ts`. |
| F-11 | **Fixed** in `da1a0c1`. Looping a region reads its crossfade as a checked sample count and validates the looped region by the domain's own check, refusing with the domain's sentence. A refusal test in `edit-commands.test.ts`. |
| F-12 | **Rejected**, as above. |
| F-13 | **Fixed** in `12d5453`. Spreading and averaging are for the mono role alone; a lone placed channel converts by role, and a lone Centre reaches stereo at −3 dB. In `channel-matrices.test.ts`, `keeps a lone channel with a place in that place, rather than spread it as mono` and `pastes one channel copied from a stereo pair back on its own side`. |
| F-14 | **Fixed** in `2844af8`. The plan fold takes a region's processing in at its basis, just before the asset operation its basis counts to, so its stages are in content frames like any other, and a region's plan is that plan cut to its boundaries. Gains, silence, inversion and channel edits had the same defect, and are fixed with it. `renders every region over a random chain as its processing applied where it was placed` in `edit-property.test.ts`, a property test against the oracle, and `so a fade reversed after it ends silent rather than starts silent` in `placement.test.ts` failed against the old fold. |
| F-15 | **Fixed** in `f73ded7`. A row sums only the inputs it gives a factor, from the first product, and a row of one factor of 1, and every frame outside the range, copies the sample's bits; the oracle states the same rule. `keeps every bit of a channel it copies or leaves alone: a −0 and a NaN’s payload` and `swaps two channels without the zero factors reaching an infinity` in `stage-arithmetic.test.ts`. |
| F-16 | **Fixed** in `90368d1`. A converted paste too large for one argument is refused, with `clipboard.too-large-to-convert`, and audio already at the asset's rate is pasted as it is. In `clipboard.test.ts`, `refuses to split audio it converts, which the resampler converts only whole` and `pastes audio at the asset’s own rate as it is when asked to convert it`. |
| F-17 | **Fixed** in `935934a`. The comment states the range for each bit depth, and 25-bit and 26-bit cases join the 32-bit one: `reads the extremes of each integer depth as −1 and one step short of 1, or 1 past 25 bits` in `codec-fixtures.test.ts`. |
| F-18 | **Fixed** in `6e350ca`, in the port protocol every call uses. A cancelled call waits for the worker's answer, rejecting where the call was given up or failed and resolving where it was carried out first; an opening finished just before the cancel is let go, and callers that gave up drop late answers. `reports an import as made where the cancel reaches the worker only after it added the asset` in `audio-import-commands.test.ts` and `settles only once the other side has given the call up` in `port-channel.test.ts` failed against the old protocol. |
| F-19 | **Fixed** in `0f7b4f0`. Making the project is split from opening it, so the project made is withdrawn when the opening fails. `keeps nothing where the project open before cannot be let go, which stays open` in `quick-edit-commands.test.ts`. |
| F-20 | **Fixed** in `0f7b4f0`. The attempt runs in a try whose finally withdraws it. `keeps nothing of a Quick Edit whose import fails rather than answers`. |
| F-21 | **Fixed in part** in `0f7b4f0`: a failed removal still reopens the project open before, held by `opens again the project open before where the project made cannot be removed`. The rest is rejected, as above. |
| F-22 | **Fixed** in `2d97240`, as above. |
| F-23 | **Fixed** in `4f2dab0`. A command button that cannot run stays in the tab order, marked unavailable and described by its reason, said once above a row of them; the Transport, Asset Browser and Inspector buttons all use it. `keeps a button whose command cannot run in the tab order, saying the command’s own reason once` in `transport-panel.test.tsx`. |
| F-24 | **Fixed** in `4f2dab0` and `c11aa9a`. The Inspector keys its fields by the region and starts a draft again in place when the project's value changes. `never shows a name typed for one region as another’s of the same name` in `inspector-panel.test.tsx`. |
| F-25 | **Fixed** in `4f2dab0`. Import and Cancel are one button whose label changes, its status line always present, and the control that stops a region looping stays, unavailable with its reason. `turns the import control into the one that calls the import off and back, keeping the focus on it` in `asset-browser.test.tsx`. |
| F-26 | **Fixed** in `82c644d`. The stale sentence is removed, the side heard is said once by the command that switches it, the play button is the command's own, named by its label and unavailable with its reason where audio cannot play. `says the side heard once, by the command that switches it, and plays it only where playback can` in `history-panel.test.tsx`. |
| F-27 | **Fixed** in `9fece59`. The toolbar is built from the tool declaration, so a new tool cannot be left off, and the tool descriptions say they select regions and move a region's ends. `offer every tool, each choosing it in this view` in `editor-toolbar.test.tsx`. |
| F-28 | **Fixed** in `7a4f1a7` and `2d97240`. The channel commands take a channel by its name or its number from 1, as the lanes are numbered, the refusals name the tap and the keyboard route, and the crossfade field submits. The editor's own selection command keeps lanes from 0, deliberately, as the lanes' index. Held by the channel tests in `edit-commands.test.ts`. |
| F-29 | **Fixed** in `90368d1`. The planner takes the longest argument as a parameter, defaulting to the one the commands read with, and the tests use fifty segments and a small limit, either side of the boundary: `splits only past the longest argument, which is the one the commands read by default`. The quadratic claim is rejected, as above. |
| F-30 | **Fixed** in `5b8dd99`. `plays the audio in view as the side heard has it, changing neither state` requires side A's own plan exactly and both states unchanged; it fails with the audition forced to side B. |
| F-31 | **Fixed** in `7a4f1a7`. The tests `makes a mono sound stereo, each side its one channel`, `stops a region looping, which one undo puts back` and `copies the whole sound with nothing selected` are new, the layout conversions run with and without a selection, and the unscoped channel test requires the operation recorded before it reads the channels. |
| F-32 | **Fixed** in `76e8049`, which made the second-import test ask the moment the importing state is entered, rather than polling for it. `d400c3c` then replaced that test with `offers neither another import nor a Quick Edit while one runs, saying why`, which asks the same way and holds both commands unavailable while the import runs. |
| F-33 | **Fixed** in `76e8049`. `says nothing and changes nothing when the person dismisses the chooser` also requires the import idle and nothing asked of storage, and Quick Edit's `says nothing and makes nothing when the person dismisses the chooser` that nothing was said, so each sees the dismissal end the flow. |
| F-34 | **Fixed** in `7a04570`. `imports a file, marks and edits it, and finds the same project after a reload` keeps the marker's name and position and the edit's range as the page showed them, and requires the same after the reload. |

### Accepted as known limits

- F-07's remnants, listed in its row, owed to Phase 06's handoff.
- The browser test removes Chromium's File System Access pickers with
  `addInitScript`, since Playwright cannot answer them, so it exercises the
  input element, Firefox's path.
- The tests that send edited audio between threads under jsdom use the `Blob`
  of `node:buffer`, since jsdom's does not survive Node's structured clone.
- Tests that pass alone time out under load at Vitest's five-second default:
  the ESLint and Prettier exclusion test, the clipboard's split test before
  F-29's fix, the random command walk in `project-commands.test.ts`, the
  comment-width test, the keyboard-wiring test and the golden render. None is
  weakened or skipped; the debt is tracked in the handoff.

### Found during remediation

- The shell's fixes found `file.import-audio` still offered while an import
  runs, and F-14's fold made unnecessary the refusal to convert the layout
  while a region's processing names channels. Both were given to a follow-up
  branch, merged in `faf8cde`: `d400c3c` makes the import and Quick Edit
  unavailable, saying why, while an import runs; `c703ef5` removes both
  refusals once tests showed region processing that names channels renders
  correctly through a later conversion, a hundred-run property test against the
  oracle among them; `c6f3dd8` fixes the Inspector, which named an edit's
  channels by the source's layout rather than the layout at the edit's basis, a
  defect the conversion made reachable.
- The same branch reported that the sentence the empty view's list gives an
  asset counted the source's channels, so an asset converted to mono still read
  as two channels; `9d2f396` reads the edited plan's layout instead, with a test
  that failed before it.
- The merged tree crossed the review band in `project-assets.ts`; `24c8ed6`
  moves the building of one entry to `project-entry.ts` rather than listing the
  file as reviewed.
- Driving the built app for the record's pictures showed Cut, Copy and Paste
  listed as `Ctrl+x`, `Ctrl+c` and `Ctrl+v`: they were bound with the helper for
  named keys, so each shortcut named the letter, which no key press carries,
  and the keys did nothing through the shortcut system. `7aced0b` places them
  by the layout, as undo is, with
  `puts cut, copy and paste on the keys that type x, c and v on the layout`,
  which failed before it.
- That fix took the clipboard keys on the whole page, which four tests caught:
  they pin that, outside the editor, the platform's own copy and paste reach
  the browser, so a person can copy page text. `8d47417` runs the clipboard
  commands from a key press only where the focus is in an editor panel, by the
  command a press completes, and leaves the press to the browser elsewhere; the
  four pass unchanged, and the tests it adds failed before it.
- Several fix branches wrapped comments past the comment width, re-flowed in
  `c0abea2`, `0f085ce` and `6bb4350`.

## Re-review

The owner's decision of 2026-09-28 replaces looped review rounds with one
pass whose findings are fixed. No lens was re-run. Each fix was verified by
the test its author saw fail before it and by the gate over the merged tree,
and the browser test runs over the merged tree before it lands.
