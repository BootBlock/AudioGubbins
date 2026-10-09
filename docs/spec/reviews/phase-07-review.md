# Phase 07 — Recording — Review Record

## The owner's decision

On 2026-10-07 the owner decided that in-depth reviews, audits and their fix
rounds happen once, after the whole specification is implemented, and not
during any phase; a lens a phase packet requires is to be recorded as
deferred to the post-implementation review instead. Phase 07 therefore ran no
independent review lens. In their place a separate agent, which had not built
the phase, made a read-only scope check; the build itself and the gate run
found three more defects.

Severity follows `contracts/review-gates.md`. `BLOCKER`, `CRITICAL` and `HIGH`
prevent `PASS`. `MEDIUM` must be fixed or explicitly accepted with
justification and tracking. `LOW` and `NOTE` may remain if tracked.

**Status** `CONFIRMED` means established by reading the code against the
packet, or, for the gate run's findings, reproduced by the run. No finding was
rejected. Findings are numbered for this phase alone, from F-01.

## Lenses deferred

Each lens `phases/phase-07-recording.md` requires is deferred to the review
after the whole specification is implemented:

| Lens | Disposition |
| --- | --- |
| Architecture | Deferred to the post-specification review. |
| Audio / DSP Correctness | Deferred to the post-specification review. |
| Security / Privacy | Deferred to the post-specification review. |
| Data Integrity / Recovery | Deferred to the post-specification review. |
| Performance / Scalability | Deferred to the post-specification review. |
| UX / Accessibility / Input | Deferred to the post-specification review. |
| Browser / PWA Compatibility | Deferred to the post-specification review. |
| Testing / Regression | Deferred to the post-specification review. |
| Code Quality / Maintainability | Deferred to the post-specification review. |
| Adversarial Agent-Quality | Deferred to the post-specification review. |

## The scope check

The check read the code after every slice was committed (`910f1a66`) against
every In Scope item, acceptance criterion, architectural invariant, failure
and recovery behaviour, forbidden shortcut, inherited debt and required public
contract of the packet, and against `ADR-0070` to `ADR-0072`. It edited
nothing. It found one item missing, the offer to restart the audio engine at
the input's sample rate, and eight carried out in part: F-01 to F-08 below,
and F-12.

| Id | Severity | Status | Finding |
| --- | --- | --- | --- |
| F-01 | HIGH | CONFIRMED | Missing: where the input reports another rate than the context's, the diagnostics said so but nothing offered to restart the context at the input's rate, which `ADR-0070` requires (`REQ-REC-094`, `REQ-ARCH-085`). |
| F-02 | MEDIUM | CONFIRMED | Device labels were kept out of logs and the diagnostic report only by the recording code's care: nothing replaced a label a log record's fields carried, and no test followed a recording session through the log (`ADR-0070`, `REQ-PRIV-161`, `REQ-PRIV-165`). |
| F-03 | MEDIUM | CONFIRMED | The storage left was read only once the input was armed, after the browser had opened the microphone, where `ADR-0071` reads it before arming; an arming with no room opened the input and closed it again (`REQ-REC-096`). |
| F-04 | MEDIUM | CONFIRMED | The recording diagnostics were withheld until an audio context and the storage estimate had reported, so an insecure page and a refused permission, which need neither, were not said until then (`REQ-REC-097`, `REQ-PWA-077`). |
| F-05 | MEDIUM | CONFIRMED | No diagnostic said that the chosen input was no longer connected, one of the device changes `REQ-REC-094` names. |
| F-06 | MEDIUM | CONFIRMED | Two of the packet's views had no test: the Inspector's take and take stack, and the Audio settings' input section. |
| F-07 | MEDIUM | CONFIRMED | The page read the write lease once, when the input was armed, so an armed input opened again for another device or profile, and a punch recorded after its pre-roll, took no account of another tab taking the project over meanwhile. The storage worker's own check, which refuses a recording in a window without write access, stood (`REQ-STOR-098`). |
| F-08 | LOW | CONFIRMED | The calibration's texts said rate where they meant sample rate, and the Recording panel's latency section wrote what changed of a path its own way, not as the diagnostics word it. |
| F-12 | LOW | CONFIRMED | The media store's recovery of an incomplete store ran when the storage worker started, before any project's recording sessions were listed, where `ADR-0071` said it ran after them. The order cannot harm a session: the store's recovery undoes only the store's own incoming files and the objects its intents name, and a session's chunks lie under its project. |

## Found by the build

The slice that built the recording flow reported F-09 in what the slices
before it had made, and the closing records found F-13 in exports nothing
outside their package used.

| Id | Severity | Status | Finding |
| --- | --- | --- | --- |
| F-13 | MEDIUM | CONFIRMED | Several recording facts had two homes or none. The status bar's input state was derived both by the recording package's `inputIndicator`, which nothing used, and by the application's `inputStatus`; whether a stop was expected was ruled both by `stoppedUnexpectedly` and by the project format's `endedUnexpectedly`; the punch's window was computed inline beside `punchWindow`; the retrospective range of 5 to 60 seconds was checked in both the recording package and the audio runtime; and nothing checked a retrospective buffer against the memory `REQ-REC-090` makes it subject to. |
| F-09 | MEDIUM | CONFIRMED | The recovery manifest kept no record of the take a recording was begun for, so a recovered take was named afresh by the page and placed with no latency compensation, unlike the take a stop would have made (`REQ-REC-096`, `ADR-0070`, `ADR-0071`). |

## Found by the gate run

| Id | Severity | Status | Finding |
| --- | --- | --- | --- |
| F-10 | MEDIUM | CONFIRMED | The Workspace menu listed the Recording panel, titled Recording, beside the Recording preset, so the two read alike to a screen reader (`REQ-UX-005`); the smoke project's first run failed on it. |
| F-11 | LOW | CONFIRMED | The recording crash sweep had no time limit of its own and timed out once under the whole suite, where its sibling sweeps have 120 s. |

## Disposition

Every finding is fixed. Commits are on `phase-07-recording`: `4f97a530` (the
manifest's take), `07192629` (the scope check's other findings and the sweep),
`b6c07659` (the panel's title) and `3eb769d6` (F-13).

| Id | Disposition |
| --- | --- |
| F-01 | **Fixed** in `07192629`. A rate mismatch entry carries an action to restart the engine at the input's rate, where an engine can run at it; the command `recording.restart-at-input-rate` makes the context again at that rate after telling the input why (`apps/web/src/recording/engine-rate.ts`, `apps/web/src/audio/context-host.ts`), and is refused while recording and for a punch. The person decides. Held by "explain a rate mismatch and offer the input's rate as an action", "offer no restart at a rate no audio engine runs at", "is refused with the reason until an open input runs at another rate", "is refused while a recording runs, which it never cuts off", "is refused for a punch, which records at the rate of the audio it replaces", "offers the input's own rate where the browser resamples it, and restarts only when asked" and "is made again at the rate the person chose, telling the input why first". |
| F-02 | **Fixed** in `07192629`. The logger replaces the value of every field named for a device's label or name as the record is made (`packages/diagnostics/src/device-labels.ts`, `logger.ts`), so neither the kept log nor a bundle holds one. Held by "is replaced as the record is made, so the kept log never holds it", "is replaced in a measurement too", "is found by the field that holds it, not by a field that merely ends in a name" and "is in neither, through a whole recording session". |
| F-03 | **Fixed** in `07192629`. Arming asks the storage worker for the time left at the context's rate before the browser is asked for the microphone; where nothing fits the arming is refused with the reason, and below the margin the person is warned (`apps/web/src/recording/take-arming.ts`, `input-opener.ts`). Held by "reads the storage left before the input opens, and warns below the margin", "refuses to arm where no recording would fit, before the browser is asked anything" and "warns once while recording as the storage left runs low". |
| F-04 | **Fixed** in `07192629`. The entries that rest on the browser and the platform alone are given at once (`browserDiagnostics` in `packages/recording/src/recording-diagnostics.ts`; `apps/web/src/recording/input-diagnostics.ts`), and the views say the rest are not yet known. Held by "give what rests on the browser alone before a context or the storage reports", "says at once that the page is not secure, before any audio context or storage reports" and "says at once that the microphone is refused". |
| F-05 | **Fixed** in `07192629`. A warning says the chosen input is no longer connected and what arming will then open. Held by "say when the chosen input is no longer connected, as a warning (REQ-REC-094)" and "says at once when the chosen input is no longer connected (REQ-REC-094)". |
| F-06 | **Fixed** in `07192629`. `apps/web/src/shell/recording/take-inspector.test.tsx` and `apps/web/src/shell/settings/recording-input.test.tsx` test the two views, among them "renames the take by its command, and shows the name the project holds", "shows a stack, its takes and the one chosen, when no take is named", "says a take or a stack is gone rather than showing nothing", "lists the inputs by name, and chooses one only by its command, remembering it" and "lets monitoring start by itself only with a profile marked as used with headphones". |
| F-07 | **Fixed** in `07192629`. The session is given the lease as a reading, made again whenever it is asked, as when recording starts and when an armed input opens again (`apps/web/src/commands/take-recording-commands.ts`, `apps/web/src/recording/take-arming.ts`). Held by "opens an armed input again for another profile only while this tab holds the lease" and "records nothing where the project was taken over while the pre-roll played (REQ-STOR-098)". |
| F-08 | **Fixed** in `07192629`. The texts say sample rate, and `pathChangesText` in `packages/recording` is the one wording of a path's changes, for the diagnostics and the view. Held by "names a changed sample rate as such where a calibration no longer applies". |
| F-09 | **Fixed** in `4f97a530`. The manifest keeps the take's name, the new stack's name and its compensation, written when the recording begins, and a recovered take is named and placed by it (`packages/project-format/src/recovery-manifest.ts`, `packages/storage/src/recording-takes.ts`); a recording that starts a stack without naming it is refused when it starts, since recovery reads only the manifest. `ADR-0071` is amended. Held by "refuses one that does not say what its take is called and placed by", "that starts a stack without naming it, which no recovery could then name" and "names the take it becomes and says how that take is placed, and recovers it as such". |
| F-10 | **Fixed** in `b6c07659`. The panel is titled Recorder; its kind stays `recording`. The smoke test "lists every workspace in the Workspace menu, each preset marked as built in", which refuses an entry reading a preset's bare name, passed in the third run of the whole smoke project. |
| F-11 | **Fixed** in `07192629`. The sweep has the 120 s its siblings have. A time limit has no behaviour to fail. |
| F-13 | **Fixed** in `3eb769d6`. `inputStatus` (`apps/web/src/recording/input-view.ts`) is the one derivation, since only the application sees a calibration's input and the device the browser opened; `endingOf` (`apps/web/src/recording/take-words.ts`) is the one mapping of a stop to an ending, judged by `endedUnexpectedly`; `punch-start.ts` and the punch audition use `punchWindow`, which starts at frame 0 where an edit moved the range nearer the start than its pre-roll; the range is the recording package's alone, and the runtime refuses only a length no buffer could have; and `retrospectiveFit` shortens a buffer to the whole seconds that fit an eighth of the memory the page reports, keeping it whole where none is reported (`apps/web/src/recording/buffer-arming.ts`). Unused exports are no longer offered. Held by "says opening, armed, buffering, counting in and recording as distinct states", "keeps each reason as its own ending, and only the person and the timed stop as expected", "keeps the whole interval where the browser says nothing of its memory", "shortens the interval to the whole seconds that fit in its share of the memory left", "keeps nothing where not even the shortest interval fits" and "keeps a retrospective buffer of any length a buffer can have, and none at zero". |
| F-12 | **Fixed** in `4f97a530`, in the record: `ADR-0071` is amended to say when the store's recovery runs and why it never reaches a session, which `packages/storage/src/media-recovery.ts` states beside the code. The code did not change. |

## Re-review

No lens was run, so none is re-run; the lenses are deferred as above. Each fix
is held by the tests its row names, and by the gate over the tree in the
evidence (`reviews/phase-07-evidence.md`).
