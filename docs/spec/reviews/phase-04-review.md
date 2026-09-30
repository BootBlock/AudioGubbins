# Phase 04 — Waveform and Timeline Foundation — Review Record

The seven lenses `phases/phase-04-waveform-and-timeline-foundation.md`
requires, run as independent read-only reviewers over
`git diff 0445d2e..94b51bf`, the phase as it stood when its implementation was
complete, against the packet, `contracts/review-gates.md`, the owned
requirements and `ADR-0040` to `ADR-0047`. No reviewer was told to preserve
the implementation, and none edited the tree.

Under the owner's decision of 2026-09-28 the phase has one review pass, whose
verified findings are all fixed or explicitly accepted, and no mutation
harness. Each fix still carries a test that was seen to fail against the code
it replaced.

Severity follows `contracts/review-gates.md`. `BLOCKER`, `CRITICAL` and `HIGH`
prevent `PASS`. `MEDIUM` must be fixed or explicitly accepted with
justification and tracking. `LOW` and `NOTE` may remain if tracked.

Every finding was verified by its reviewer before it was reported, by a
measurement, a run or a reading of the code against the rule it breaks, and
again by the remediation, which reproduced it in a test before fixing it.
**Status** records that verification:

- `CONFIRMED` — reproduced, or established by reading the code against the
  requirement.
- `REJECTED` — investigated and shown not to hold. The reasoning is recorded.

## Lenses run

| Lens | Findings | Blocking |
| --- | --- | --- |
| Architecture | 5 | 1 HIGH |
| Performance / Scalability | 7 | 1 HIGH |
| UX / Accessibility / Input | 11 | 2 HIGH |
| Testing / Regression | 3, and a note of the checks that found nothing | 1 HIGH |
| Audio Correctness | 3 | 1 HIGH |
| Browser Compatibility | 6 | 1 HIGH |
| Adversarial Agent-Quality | 8, and a table of the owned requirements | 1 HIGH |

Findings raised by more than one lens are merged under one identifier, with
the lenses listed together, at the higher of the severities they were given.
Six were raised by two lenses, so the forty-three reported make a merged list
of thirty-seven findings: eight `HIGH`, seventeen `MEDIUM`, eleven `LOW` and
one `NOTE`.

## Blocking findings

### F-01 — HIGH — Commands ignored the selection set's precedence

- **Lens:** Architecture. **Status:** `CONFIRMED`, reproduced.
- `editor.remove-markers` read the selection's markers, and
  `editor.zoom-to-selection` its range, whichever facet was active, where
  `ADR-0042` and `REQ-EDIT-063` resolve a command's target from the active
  facet and never fall back to another. `resolveTarget` held that rule, and
  no command called it. Facets persist until cleared, so a marker clicked and
  then a range dragged left the marker selected under the active range: run
  through the real command bus on the loop asset, the removal Delete runs
  removed the marker, which may be off screen. The reverse order made F zoom
  to the old range.
- **Disposition:** fixed in `5a7c727`. Both commands resolve their target
  through the selection set's one precedence and refuse, with the reason,
  when the active facet is not one they take, and extending the selection
  starts from the playhead rather than from a range the person has since set
  aside. `is acted on by its facet made last, never by one made before it`
  in `editor-commands.test.ts` runs both orders; it failed against the old
  commands, which applied the removal where it had to be refused, and a
  second test there failed where the old extend started from the set-aside
  range.

### F-02 — HIGH — A view wider than 4,096 device pixels never drew its waveform in the sample band, and redrew for ever

- **Lens:** Performance / Scalability, and Audio Correctness at `MEDIUM`.
  **Status:** `CONFIRMED`, reproduced.
- Below 256 frames a device pixel a view read a window of samples, capped at
  1,048,576 frames in `view-audio.ts` and in the worker, while the range it
  showed was its width times its zoom. Past 4,096 device pixels that range
  outgrew any window: the window never covered it, every column drew as
  pending, and each `known()` asked again, was answered at once from the kept
  window and redrew. Driven at 2,560 CSS pixels, a pixel ratio of 2 and 500
  samples a pixel, a real `ViewAudio` asked and redrew on each of ten frames
  and never covered its 1,280,000 frames. A 5K display, or a 5,120-pixel
  ultrawide, meets this with the editor full width.
- **Disposition:** fixed in `8960fa4`. Between 16 and 256 frames a device
  pixel a view now reads a window of 16-frame detail buckets, summarised by
  the pyramid's own rule, and only below that the samples, so no column reads
  more than sixteen values a frame. A window spans the view and a view's
  width either side, is bounded by the widest view it is sized for, is asked
  for before the view reaches its edge and never again once held, and until
  it arrives a column draws level zero's envelope rather than pending.
  `asks once for the widest window a view wider than any window can have, and not again`
  in `editor-parts.test.ts` failed against the old view, which asked again;
  two more tests there hold the detail buckets and the ask ahead of the
  edge. The wide-display browser test of F-14 zooms a three-hour session
  through every level and requires the page to rest at each.

### F-03 — HIGH — The editor's Ctrl shortcuts took select-all and word movement from every text field

- **Lens:** UX / Accessibility / Input. **Status:** `CONFIRMED`, reproduced
  in jsdom and in Chromium against the built application.
- The phase bound Ctrl+A, Ctrl+Left, Ctrl+Right and Ctrl+D without the
  Ctrl+K prefix. `isTypingPress` and `ownsItsKeys` both gave up a press with a
  modifier, so the chord tracker ran it and prevented the browser's default
  whether or not the command was available. In the command palette, typing
  "zoom in", pressing Ctrl+A and typing "x" read "zoom inx", Ctrl+Left never
  moved the caret by a word, and the editor's selection and playhead changed
  behind the dialogue.
- **Disposition:** fixed in `37db059`. A text field keeps the chords it edits
  with before the chord tracker sees them: the caret keys, Backspace and
  Delete with any modifier, and select all, undo, redo and the clipboard with
  Control or Command. Outside a field the chords are the editor's, and a
  chord's second press still reaches the tracker. The field tests in
  `use-shortcuts.test.ts` failed against the old listener with
  `expected [ 'editor.select-all', …(1) ] to deeply equal []`, and the browser
  test `leaves a text field its select-all and its word movement` in
  `input.spec.ts` types in the palette.

### F-04 — HIGH — The editor's labels were nearly invisible in the light theme

- **Lens:** UX / Accessibility / Input. **Status:** `CONFIRMED`, measured.
- The waveform display is dark in both themes, but the text drawn on it took
  the chrome's text colours, which are dark in the light theme. On the loop
  asset the marker names measured 1.04:1 against the display and the channel
  names 2.22:1; more contrast made them 1.14:1 and 1.82:1, and brightness +1
  put the channel names at 1.28:1, where `REQ-UX-070` requires contrast to
  hold across the brightness range.
- **Disposition:** fixed in `7f0f80d`. The waveform palette carries the
  display's own label and supporting label colours, solved to the levels body
  and supporting text must reach at the contrast chosen, against whichever of
  the display's background, its pending wash and the spectrogram's floor they
  are hardest to read on. The wash is a waveform colour, and the ruler takes
  the chrome's text by its own name, `rulerText`. `theme-palette.test.ts`
  composes a view's frames in every display mode and checks every label
  against what the frame draws under it, for both themes, both contrast
  levels, every accent and 21 brightness steps; it failed against the old
  palette at the finding's 1.04 and 2.22. `theme.test.ts` holds the new tokens
  on each surface of the display. The design system now exports
  `contrastRatio`, `ContrastRequirement` and `srgbToOklch`, recorded in the
  public contracts.

### F-05 — HIGH — The renderer-loss suites never checked that anything was drawn, and a failed draw was reported as drawing

- **Lens:** Testing / Regression, and Adversarial Agent-Quality at `MEDIUM`.
  **Status:** `CONFIRMED`, established by reading the suites and the renderer
  against the acceptance criterion, and reproduced by the remediation.
- The three suites of `test:renderer-loss` asserted only the Capabilities
  report and the Zoom reading, which comes from the view store and not the
  canvas. `Renderer.#restored` set the state to drawing and counted a
  recovery before it redrew, and the redraw ignored a draw that answered
  false. The editor suites and the renderer's unit tests each said the other
  checked the pixels, and no test drove either GPU backend. A WebGL2 restore
  that rebuilt nothing, or a WebGPU device whose canvas was not configured
  for it, left the view blank with every suite green.
- **Disposition:** fixed in `81d0951` (the renderer) and `79a24ea` (the
  browser suites). A backend answers each draw as drawn, away while its
  context or device is lost, or failed with the reason. A restore counts as a
  recovery only once the latest frame is drawn again, a backend that cannot
  draw the first frame is not taken, and a failed draw is reported with its
  reason while the next backend takes over, as `ADR-0044`'s recovery says.
  WebGL2 checks the first draw after each rebuild for an error, a WebGPU
  device given after a loss must pass the validation draw a new device
  passes, and an error no scope caught fails the backend. Ten tests in
  `renderer.test.ts`, `webgl2-backend.test.ts` and `webgpu-backend.test.ts`
  failed against the old code, among them
  `is not counted as recovered when it cannot draw after a restore, and the next kind draws instead`.
  Each browser suite now reads a screenshot of the view, since neither GPU
  backend keeps its drawing buffer: the peak colour at the tone's loud
  columns and the clear colour where the channel is silent, at the columns
  the Showing and Zoom readings put them, before the loss and after the
  recovery, with the zoom changed while a WebGL2 context is away, and the
  overlay by the channel's name. With a restore that skips the rebuild put
  back, the report assertion failed; with an empty vertex array, or a WebGPU
  device that submits nothing, 170 columns were wrong. A fourth defect put
  back was corrected by a later redraw before the suite read the view, and
  the unit tests hold it.

### F-06 — HIGH — The reference picture was judged by its frame's start, and the browser test measured the seek asked for

- **Lens:** Audio Correctness, and Adversarial Agent-Quality at `MEDIUM`.
  **Status:** `CONFIRMED`, reproduced against the real `pictureCorrection`.
- `pictureCorrection` took the frame on screen to be the one whose start is
  at or before its timestamp, and measured the playing drift from that
  frame's start against exactly one period. WebM stamps frames in whole
  milliseconds, so at 30, 29.97 or 24 frames a second a frame stamped below
  its start was read as the frame before. Parked on frame 4 of a 30-frame
  file with the playhead moved to frame 3, the correction answered in sync
  and the picture stayed on frame 4, against `ADR-0046`'s exact frame while
  parked; playing at 0.1666 s with frame 4 correctly shown, it asked for a
  seek. The browser test recorded at 25 frames a second, where every
  timestamp is exact, compared `video.currentTime`, which is the seek the
  picture had just asked for, and never read back the frame marks its own
  fixture drew.
- **Disposition:** fixed in `387f20e`. The frame shown is the one whose start
  is nearest its timestamp, which holds for any rounding short of half a
  frame, and an element's current time, used until the browser says which
  frame a seek presented, is taken as a moment within its frame. Playing, the
  picture is sought only when that frame is more than one frame from the
  frame that holds the position. Three of the policy's tests in
  `video-reference.test.ts` failed against the old policy, and
  `knows each frame by its millisecond timestamp, rounded either way, at 30 and 29.97`
  holds both roundings. The browser test
  `shows the frame of the playhead while parked, and within a frame of it while playing`
  makes a 30-frame VP8 WebM in the page with WebCodecs, stamped in
  milliseconds, each frame drawing its own number as eight bars, and reads
  that number back from the pixels on screen, parked while stepping across
  frames stamped early, and playing. It failed against the old policy in one
  of two runs, so the unit tests are the deterministic proof. **Accepted:**
  the browser test does not count the seeks playing takes, which depends on
  the machine's load;
  `leaves playing picture alone within one frame of the frame that should show`
  holds that a correctly shown frame is not sought.

### F-07 — HIGH — A video whose picture the browser cannot decode was reported ready

- **Lens:** Browser Compatibility. **Status:** `CONFIRMED`, reproduced in
  Chromium and Firefox.
- Only an `error` event marked a picture undecodable. Given a container they
  read with a video codec they cannot decode, ProRes in `.mov` or MPEG-4
  Part 2 in `.mp4`, Chromium and Firefox fire `loadedmetadata` and
  `loadeddata`, play the sound, report a picture of 0 by 0 and fire no error.
  The Picture panel showed black beside correct readouts, the filmstrip asked
  for captures a pixel wide, and no notice said the file could not be shown,
  which `ADR-0046` and the packet require. A file of sound alone went the same
  way. WebKit fires an error for all three files.
- **Disposition:** fixed in `9c4b277`. The picture is judged once the browser
  has a frame to show rather than at its metadata, and a picture of no size
  is reported as undecodable with its reason, letting go of the file and
  leaving the audio as it was.
  `says a file with no picture the browser can decode, and lets go of it` in
  `reference-picture.test.ts`, and the browser test
  `says a file with no picture it can decode, and leaves the audio as it was`,
  which opens a WebM of sound alone recorded in the page, both failed without
  the check.

### F-08 — HIGH — Opening a reference picture loaded the whole file and all of its decoded sound, with no bound

- **Lens:** Adversarial Agent-Quality. **Status:** `CONFIRMED`, established
  by reading the code against `REQ-EXEC-216` and the packet's failure rules.
- `picture.open` always decoded the picture's sound: the whole file as one
  `ArrayBuffer`, then `decodeAudioData`, whose PCM the asset kept for the
  session and copied on every read, once for the peak worker and again on
  every Play. No bound, streaming path or refusal existed, and the signal was
  read only once the decoding had finished. A 60-minute, 1.5 GB reel needed
  about 1.5 GB of file, 1.4 GB of decoded sound and 1.4 GB more for the peak
  worker, enough to take the tab down with the editor and the session's
  markers, which `ADR-0047` does not yet persist.
- **Disposition:** fixed in `d30e1ac`. Opening a picture reads nothing of its
  sound. `picture.extract-sound` is a command of its own, in the Reference
  picture menu, the palette and the Picture panel, and before anything is
  read it weighs the file and its decoded sound, at 48 kHz, four bytes a
  sample and eight channels, against a quarter of the memory the page reports
  it has left, or a fixed gibibyte where it reports none. Past that the
  command is unavailable with a reason that states both, shown beside the
  panel's control, and a picture that does not say how long it is is
  refused. The file is read as a stream, cancelled when the picture is closed
  or another opened; the decoding itself cannot be stopped, and its result
  is dropped. Tests in `editor-commands.test.ts`, `sound-bound.test.ts` and
  `reference-picture.test.ts` failed against the old code, among them
  `reads nothing of the sound when a picture is opened`. **Accepted:** the
  bound counts eight channels, since the browser says nothing of a file's
  channels until it has decoded them; a file of more would exceed the stated
  bound. Where the page reports no memory figure, the fixed gibibyte admits
  about eleven minutes of sound.

## Non-blocking findings

| Id | Severity | Lens | Finding |
| --- | --- | --- | --- |
| F-09 | MEDIUM | Architecture | The waveform pyramid lived as long as the Editor panel's component, and every command that changed the layout remounted the dock, so a pyramid half made was dropped and begun again from frame 0 (the packet's rule that the cache follows media identity, not component lifetime). |
| F-10 | MEDIUM | Performance | Between 1 and 256 frames a device pixel, every composed frame scanned every sample in view on the main thread, about 12 ms of each frame for 5.1 at 3,840 device pixels, and the window was fetched again in million-frame copies, drawn as pending until each arrived. |
| F-11 | MEDIUM | Performance | The worker posted one message of about 43 transferred buffers per 65,536-frame chunk, and each re-rendered the whole Editor view: about 7,900 renders over the three-hour session's build. |
| F-12 | MEDIUM | Performance | Every editor surface subscribed to the whole of six stores and redrew on any change, so one view following playback redrew every view, and every Editor panel re-rendered, each display frame. |
| F-13 | MEDIUM | Performance | Cancellation stopped at the page: the worker had no cancel message and still read and shipped an abandoned window, and the zero-crossing search was passed no signal. |
| F-14 | MEDIUM | Performance | Nothing tested or measured the acceptance criterion that large assets scroll and zoom without rebuilding peaks from raw PCM per frame; no browser suite opened the three-hour session. |
| F-15 | MEDIUM | UX | Bare-key editor shortcuts acted on the editor hidden behind a modal dialogue: M, Z and Ctrl+A on a tab of the settings added a marker, chose the Zoom tool and selected everything. |
| F-16 | MEDIUM | UX | A finger that came down during a pen's press took the press over, and a second cancelled it, so a resting palm broke pen selection on Surface-class hardware, against the module's own contract. |
| F-17 | MEDIUM | UX, Browser | The long press was split between the tool's 500 ms timer with an 8 px tolerance and Radix's 700 ms timer with none: a hold of 500 to 700 ms, a hold that shifted a pixel, and a pen held still opened nothing and abandoned the press (Phase 01's F-188). Two findings of two lenses, merged. |
| F-18 | MEDIUM | UX | Keyboard moves in the editor surface, an application region, gave a screen reader nothing: the playhead reading was a timer, the zoom readings were not live, and no command announced. |
| F-19 | MEDIUM | UX | Opening another view left the keyboard on the group's tab panel, where the arrow keys are the panel's own, so the editor's keys did nothing until the person tabbed back into a surface. |
| F-20 | MEDIUM | UX | The keyboard could extend a selection only a sample a press and never shrink it, and could neither set a selection's ends nor move a marker (`REQ-UX-005`). |
| F-21 | MEDIUM | Testing | The tool pointer's zero-crossing snapping had no test: with snapping switched off in the code, every suite passed. |
| F-22 | MEDIUM | Testing, Adversarial | Zooming about the pointer, the fingers or the Zoom tool's click was untested: with the anchor dropped every suite passed, and the pinch test's title promised an anchor its body did not check. |
| F-23 | MEDIUM | Audio | Pause left the transport at the processor's count, which runs ahead of the device by the output latency, so the parked playhead, the parked picture and a marker added at the playhead jumped past what was heard. |
| F-24 | MEDIUM | Browser | After a GPU process crash the overlay canvas, which carries the labels, the ruler text and the thumbnails, came back blank, since only the geometry's context was watched. |
| F-25 | MEDIUM | Architecture, Adversarial | The package-export allowlist justified Phase 04's unconsumed exports with "the commits that follow", which had landed; `targetsWithin`, `withSpectralArea` and `pictureDrift` had no production caller. |
| F-26 | LOW | Architecture | The renderer read the WebGPU flag namespaces and `setTimeout` from the page, against `ADR-0040` and `ADR-0044`, in a lint group that allowed every browser global, so neither GPU backend could be tested outside a browser. |
| F-28 | LOW | Performance | The Picture panel asked for every display frame while it showed an asset, playing or not. |
| F-29 | LOW | UX | The Picture panel's actions were disabled with their reason in a tooltip, out of the tab order and out of a keyboard's or a finger's reach. |
| F-30 | LOW | UX | A channel's button changed its name between hiding and showing while also reporting pressed, which a screen reader reads ambiguously. |
| F-31 | LOW | UX | The waveform's progress and its failure were a plain paragraph, so assistive technology was never told a view had no waveform. |
| F-32 | LOW | Browser | The IndexedDB probe counted `indexedDB` of `null`, as Firefox names it with IndexedDB turned off, as available. |
| F-33 | LOW | Browser | Each picture opened started another chain of frame callbacks, and every earlier chain ran for the life of the page. |
| F-34 | LOW | Browser | A wheel read in pages was taken as one pixel, and a trackpad pinch WebKit reports as a gesture zoomed the page, not the timeline. |
| F-35 | LOW | Adversarial | Each view's spectral settings were stored, validated and branched on, and nothing could change them. |
| F-36 | LOW | Adversarial | The peak cache reported a write kept when its request succeeded, before its transaction committed, and kept a connection the browser had closed. |
| F-37 | LOW | Adversarial | The resume note and the draft evidence contradicted the code and each other: work listed as left was done, and the evidence claimed a spectral selection the application could make and a snap kind for samples. |
| F-27 | NOTE | Architecture | The packet's `TimelineCoordinate`/`SamplePosition` has no type of that name, and nothing recorded that the domain's `SampleCount` is it. |

### Rejected

No finding was rejected.

## What the reviewers found sound

- The viewport's arithmetic: scroll, zoom and anchor round trips over 20,000
  random cases at positions of 2⁵⁰ to 2⁵¹ with no drift, and drift at huge
  zoom covered on the three-hour asset and on a viewport a hundred years
  long.
- Drop-frame timecode at 29.97 and 59.94, the pyramid's minimum and maximum
  over three channels with chunks out of order, rounded outward by at most a
  step, the signal recipes' 5.1 order and loop points, the recipe source's
  seek to any frame, and the refusal of a sample rate an asset cannot be
  played at.
- The snapping precedence: the kind and the position tie-breaks, each
  removed, failed the suite. A stale or corrupt peak cache, and an
  undecodable file of bytes that are no video, are covered in unit and
  browser tests.
- Seven of the packet's eight public contracts exist under its names, and
  `REQ-PROD-160`'s deferral builds nothing musical while leaving
  `TimeFormat` and `SnapKind` unions a musical kind can join.
- No test was skipped or weakened: the deleted tests went with their deleted
  modules, and the packet's filtered unit run passed.

## Disposition

Every verified finding is fixed or accepted with tracking. Each fix carries a
test that failed against the code it replaced, unless the entry says why none
can. Commits are on `phase-04-waveform-timeline`.

| Id | Disposition |
| --- | --- |
| F-01 | **Fixed** in `5a7c727`, as above. |
| F-02 | **Fixed** in `8960fa4`, as above. |
| F-03 | **Fixed** in `37db059`, as above. |
| F-04 | **Fixed** in `7f0f80d`, as above. |
| F-05 | **Fixed** in `81d0951` and `79a24ea`, as above. |
| F-06 | **Fixed** in `387f20e`, as above, with the count of seeks while playing accepted. |
| F-07 | **Fixed** in `9c4b277`, as above. |
| F-08 | **Fixed** in `d30e1ac`, as above, with the eight-channel bound accepted. |
| F-09 | **Fixed** in `8960fa4`. An asset's peaks are held for as long as a view in the view store shows it, not while its panel's component is mounted, so opening, moving or resizing a panel keeps a pyramid half made. `shown-peaks.test.ts` remounts a surface mid-build and requires the same pyramid. Run against the old sources the test cannot load, since the hold did not exist; the pyramid's loss on remount is what it replaces. |
| F-10 | **Fixed** in `8960fa4`, with F-02: detail buckets of 16 frames summarised in the worker, so no column reads more than sixteen values a frame, and a window asked for before the view reaches its edge. `peaks.test.ts`, `peak-host.test.ts` and `editor-parts.test.ts` hold the buckets and the column reads; against the old sources the bucket tests fail, the host having no bucket query and the worker no bucket message. |
| F-11 | **Fixed** in `8960fa4`. Finished runs go to the page in batches at most once a display frame, merged into one buffer where they touch, and a panel is told of progress only when the words it shows change. `peak-host.test.ts` requires a long build to arrive in a few batches, and failed against the old host, which delivered a message a chunk. |
| F-12 | **Fixed** in `8960fa4`. A surface composes a frame only when a value it is drawn from has changed, compared by identity, and redraws for new peaks only while its last frame waited on some; each Editor panel renders for its own view and asset. `view-scene.test.ts` holds a surface's inputs unchanged while another view scrolls; against the old sources it fails, since nothing compared a frame's inputs. |
| F-13 | **Fixed** in `8960fa4` (the worker answers one request at a time, a chunk at a time, and stops reading a window the view cancels) and `35037d7` (the tool pointer passes its signal to the zero-crossing search). Tests in `peak-host.test.ts` and `tool-pointer.test.ts`; against the old worker the cancel is refused as a malformed message, and five of the tool pointer's seven tests fail with snapping to zero crossings disabled. |
| F-14 | **Fixed** in `8960fa4`. A browser test in `timeline.spec.ts`, on a display 7,600 pixels wide at a pixel ratio of 2, zooms the three-hour session through every level and requires the page to come to rest at each; the old build did not rest at 1,536 samples a pixel. |
| F-15 | **Fixed** in `37db059` and `22f22ee`. A modal dialogue says it is modal, and while one is open a key pressed alone is the dialogue's and a chord is answered with how to use it, except a command that changes only how the interface is drawn, flagged `changesAppearance`, so a reader can brighten, darken or retheme the dialogue in front of them. Tests in `use-shortcuts.test.ts`, and the browser test `changes nothing behind a modal dialogue` in `input.spec.ts`, failed against the old code; `shell-commands.test.ts` holds which commands carry the flag. |
| F-16 | **Fixed** in `35037d7`. A touch while a pen presses starts no press, pan or pinch and cancels nothing, and a pen that comes down takes the tool from a finger. `pointer-input.test.ts` records the tool's calls, and failed against the old code in both orders. |
| F-17 | **Fixed** in `35037d7`. Pointer input alone decides a long press, with the input package's 500 ms and 8 px, and opens the context actions where the press was held; the recogniser reads a held pen as the context action too. `pointer-input.test.ts` failed against the old code with `expected [] to deeply equal [ [ 400, 120 ] ]`, and against the old build a jittered finger held 600 ms, and a pen held still, opened nothing; `touch-pen.spec.ts` holds both. |
| F-18 | **Fixed** in `a7ac7da`. What a run of keys in the surface changed is said politely once the keys stop, the playhead, the zoom and what it shows, and the surface is described by its readings. `use-readings-said.test.tsx` and a browser test in `input.spec.ts` failed against the old code. |
| F-19 | **Fixed** in `fcc9aea`. The dock records the control the keyboard is on and gives it back after a mount, and a panel a command made the one in use has the keyboard on its marked home, which is an editor view's surface. `dock-memory.test.ts` holds both; against the old build a new view's surface was not focused. |
| F-20 | **Fixed** in `727fc09`. I and O set the selection's start and end at the playhead; Shift and an arrow extend the selection a pixel with the playhead, and the primary modifier with them a sample, both able to shrink it; Alt and an arrow nudge the selected markers a pixel, and Alt and Shift a sample, each nudge undoable. Six new tests in `editor-commands.test.ts`, and a browser test in `timeline.spec.ts` that works from the keyboard alone. |
| F-21 | **Fixed** in `35037d7`. `tool-pointer.test.ts` drives the tool pointer through a fake host whose search answers a known boundary, the channels shown and the tolerance; with snapping switched off in the code, five of its seven tests fail. |
| F-22 | **Fixed** in `ceead88` and `35037d7`. The command tests zoom by a factor, in and out about a pixel, and read where the boundary under it is drawn after; with the anchor at 0 they fail with `expected 700 to be less than 1`. The pinch test in `touch-pen.spec.ts` now requires the boundary under the fingers to stay within a pixel, which found the drift recorded below; the old code read 23.96 pixels. |
| F-23 | **Fixed** in `d2a292a` and `eaa90f0`. Pause moves the paused transport back to the frame heard, so what is parked is what was heard, and Play goes on from there. `playback-control.test.ts` pauses under a non-zero output latency, and failed against the old control, which parked 960 frames past what was heard. The first fix moved the pause with a seek, which also moved the point Stop returns to; `eaa90f0` parks it with a transport event of its own, as recorded below. |
| F-24 | **Fixed** in `57089ea` and `79a24ea`. The render surface reports the overlay's context lost and given back, and the renderer paints the latest frame's text and images when it returns while the geometry draws. A test in `renderer.test.ts` failed against the old code on the count of the overlay's paints, and the browser test `draws the view and its labels again when the GPU process crashes` in `renderer-reduced.spec.ts` found no label pixels without the listener. |
| F-25 | **Fixed** in `31146df` and `9ff1b5a`. Exports only their own package used are module-private, `targetsWithin` and the engine's unused description length are removed, and what stays offered states a true reason, `withSpectralArea` for Phase 08's spectral tools among them. `framePeriod` is deleted and `pictureDrift` is private to the picture correction, whose test checks the correction a two-frame drift asks for. `package-exports.test.ts` and `module-exports.test.ts` hold the lists. |
| F-26 | **Fixed** in `774bc5f`. The WebGPU flags are the values the specification fixes, as module constants, the WebGL2 backend takes the schedule it waits by, and the renderer has a lint group that forbids every browser global. `webgl2-backend.test.ts` and `webgpu-backend.test.ts` are new; the WebGPU tests failed against the old code on the missing `GPUShaderStage` global. |
| F-27 | **Fixed** in `31146df`. `ADR-0041` says that the domain's `SampleCount` is the packet's `TimelineCoordinate`/`SamplePosition`, and the evidence maps it. No test can fail on a sentence. |
| F-28 | **Fixed** in `341d126`. The Picture panel asks for display frames only while the asset plays, and parked follows the playhead, the transport and the binding. `picture-panel.test.tsx` is new and failed against the old panel. |
| F-29 | **Fixed** in `341d126`. The actions are the buttons the settings use, which stay in the tab order while they cannot run, with each reason written once above them and tied to the buttons it explains. Held in `picture-panel.test.tsx`. |
| F-30 | **Fixed** in `7ffaa2a`. Each channel's button is named by its channel, in a toolbar named Channels shown, and pressed says the channel is shown. `editor-toolbar.test.tsx` failed against the old code, which named no such toolbar. |
| F-31 | **Fixed** in `a7ac7da`. The progress is written into a status region that is there before it has anything to say, and the failure is an alert. `peaks-note.test.tsx` is new; it fails against the old markup by construction, since the old paragraph had no role. |
| F-32 | **Fixed** in `288b3ba`. The probe asks for a factory that opens databases. `browser-environment.test.ts` holds the `null` case, which the old probe reported as available. |
| F-33 | **Fixed** in `387f20e`. The waiting callback is cancelled when the file is let go. A test in `reference-picture.test.ts` that opens pictures in turn counted three chains against the old code, where it requires one. |
| F-34 | **Fixed** in `35037d7`. A wheel read in pages scrolls by the view's width, and a trackpad pinch WebKit reports as a gesture zooms the timeline about the pointer, while a pinch of fingers on the screen is left to the pointer events. Held in `pointer-input.test.ts`. **Accepted with tracking:** Safari is not driven here, where Playwright's WebKit has no `AudioContext`; the browser matrix is Phase 14's. |
| F-35 | **Fixed** in `8ba5535`. Commands space a view's spectrogram frequencies evenly or by octave, and show every frequency to half the asset's rate or the audible band, each view's its own. Tests in `editor-commands.test.ts` and `shell-commands.test.ts`; the scale test failed against the old commands, which had none. The spectrogram lane stays the presentation shell, which Phase 08's spectral analysis draws. |
| F-36 | **Fixed** in `288b3ba`. A write waits for its transaction to complete and fails with its error otherwise, and a connection the browser closes is let go and opened again by the next read. `peak-cache-store.test.ts` now models the transaction's completion and abort; against the old store a write whose transaction aborts resolved, and a closed connection was not opened again. |
| F-37 | **Fixed** in the commit that records this review. The resume note says the phase is done and moves to `docs/todo/done/`, and the evidence says a spectral selection exists in the data model, made by no tool until Phase 08, and that samples need no snap kind because every position is a sample boundary. |

### Accepted as known limits

- The razor tool places the playhead where it would split; splitting is an
  edit, Phase 05's (`REQ-EDIT-014`).
- Regions come only from the test assets that define them, and markers and
  regions are held for the session: Phase 05 edits regions and Phase 02's
  project persists both (`ADR-0047`).
- The spectrogram lane is the presentation shell the packet sanctions, and
  Phase 08's spectral analysis draws it.
- Safari and WebKit were not run for the editor, for the reason F-34 gives.

### Found during remediation

- The pinch test written for F-22 found that a pinch drifted about 24 pixels
  from under the fingers at a view fitted to the asset: the scroll that
  followed the midpoint was taken before the zoom, and clamped at the start.
  The zoom is now about where the midpoint was and the scroll follows it
  (`35037d7`).
- A command may now say it changes only how the interface is drawn, the
  optional `changesAppearance` flag of the commands package's `Command`, which
  every appearance command sets and which F-15's modal rule reads
  (`22f22ee`). The public contracts record it.
- The design system's context actions take an opener, whose `openAt` sends
  the trigger a context menu event at the held point, for an owner that
  recognises its own long press; Radix's controlled opening would place the
  menu at the top left. With an opener, Radix's own timer and the browser's
  touch and pen context event are kept off the press (`35037d7`,
  `context-actions-opener.test.tsx`).
- F-20 changed what the existing extend commands do: they moved a selection
  a sample from wherever it was, and now move the playhead a pixel and take
  the selection's moving end with it. Their tests were rewritten to the new
  behaviour, and the sample steps are new commands with tests of their own
  (`727fc09`).
- A parked picture whose file has no frame starting at the target, as a file
  at another rate than it is counted at may not, was sought again on every
  display frame. It is now sent to a frame once, and the target is cleared on
  Play (`387f20e`).
- The reference picture and the decoder that extracts its sound are made in
  a part of the editor's composition of their own, since the editor part had
  grown past a function's length (`81403de`).
- The browser run over the merged tree found that Stop, after a pause and a
  resume, returned to where the pause had been heard rather than to where
  the play began: F-23's correction was a seek, and a seek while paused moves
  Stop's return point. The transport now has a `parked` event that moves a
  paused position alone, the playback session a `park` that applies it and
  lets go of the audio the processor holds, and the control parks rather
  than seeks. `playback-control.test.ts` stops after the resume and failed
  against the old control with Stop at 3,840 frames; `transport.test.ts` and
  `playback-session.test.ts` hold the event and the session's park
  (`eaa90f0`).
- Comments beside the keyboard and pointer changes that were rewrapped
  without their words changing are back as they were (`9c7c078`).

## Re-review

The owner's decision of 2026-09-28 replaces looped review rounds with one
pass whose findings are fixed. No lens was re-run. Each fix was verified by
the test that failed before it and by the gate over the merged tree, and the
browser suites ran over the merged tree before it landed.

### Quoted text that names no test

| Quoted | In |
| --- | --- |
| expected [] to deeply equal [ [ 400, 120 ] ] | F-17 |
| expected 700 to be less than 1 | F-22 |
