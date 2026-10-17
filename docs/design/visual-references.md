# Visual references and sign-off record

The product owner's decisions on the appearance of AudioGubbins, as `REQ-UX-221` and the Visual
Design lens of `docs/spec/contracts/review-gates.md` require. Each entry records what was shown,
the date, the decision and the reference it makes. A surface is built only from an approved
reference, and accepted only when the owner signs off its rendering against that reference.

The mock-ups are drawn with the colour tokens the design system computes (`ADR-0012`), the Lucide
icon set, and Inter and JetBrains Mono, so what is approved is what the tokens can produce.

## Decisions

### 2026-10-16: the direction of the design language

Shown: the Editing workspace in the dark theme at the comfortable density, in three directions.

| Direction   | Reference                                                                |
| ----------- | ------------------------------------------------------------------------ |
| A. Layered  | [direction-a-layered.png](references/language/direction-a-layered.png)   |
| B. Console  | [direction-b-console.png](references/language/direction-b-console.png)   |
| C. Luminous | [direction-c-luminous.png](references/language/direction-c-luminous.png) |

Decision: **C. Luminous**: translucent, blurred panels over a coloured backdrop, a gradient accent,
and glows on the live, selected and primary elements. The owner's reasons: translucent, blurred and
frosted areas and glows are wanted, and "lots of flashy visual flair fits this application very
well". Finding returned with it: the glyphs in the processors' power buttons are not centred.

### 2026-10-16: the editing display in the light theme

Shown: direction C in the light theme, with the waveform display light, and with it kept as a dark
well inside the light chrome, as the tokens drew it until now.

| Option            | Reference                                                                          |
| ----------------- | ---------------------------------------------------------------------------------- |
| Light display     | [light-theme-light-display.png](references/language/light-theme-light-display.png) |
| Dark display well | [light-theme-dark-well.png](references/language/light-theme-dark-well.png)         |

Decision: **Light display**. The light theme gets its own audio presentation palette for the
waveform, the ruler, the selection, the meters and the spectrogram.

### 2026-10-16: the Editing workspace, approved as a reference

Shown: the Editing workspace in direction C, in both themes and both densities, walked through one
rendering at a time and returned with findings until each was approved.

| Theme and density  | Approved reference                                                |
| ------------------ | ----------------------------------------------------------------- |
| Dark, comfortable  | [dark-comfortable.png](references/editing/dark-comfortable.png)   |
| Light, comfortable | [light-comfortable.png](references/editing/light-comfortable.png) |
| Dark, compact      | [dark-compact.png](references/editing/dark-compact.png)           |
| Light, compact     | [light-compact.png](references/editing/light-compact.png)         |

Decision: **approved**, with teal as the shipped default accent in place of blue ("we can fine tune
this later"). The findings returned on the way, each now a rule of the language:

- **One inset.** A container insets its content by one value on every side, 8 px comfortable and
  6 px compact, so a tab sits as far from its panel's top as from its left. Corners nest: a
  container's radius is its content's radius plus its inset.
- **The active tab** takes a translucent wash of the accent with a faint accent edge.
- **Controls look like hardware.** A knob has a printed tick scale on the panel, a glowing value
  ring, a dark skirt with its own pointer, a fluted grip and a brushed-metal cap whose index line
  turns; its shadow is deeper in the light theme. A fader follows a console's long-throw fader: a
  dark slot, a logarithmic dB scale on both sides with unity emphasised, and a tall ridged cap with
  a lit index line. A power switch is a backlit push button: a cutout, a chamfered bezel, a
  recessed domed cap with a gloss, and the glyph as an LED diffused through frosted plastic, lit
  when on and an unlit moulding when off. Level meters are LED segments with a peak hold.
- **Glyphs are centred by their ink.** The power glyph's ink box is centred to 0.02 px in its
  button, measured, with no optical shift.
- **The accent is the user's.** Every accent the settings offer is shown as a colour swatch, and
  each one's contrast is computed (`ADR-0012`).

### 2026-10-17: the shell's menus, overlays and states, approved as references

Shown: two boards in direction C, in both themes and both densities, walked through one rendering
at a time and returned with findings until each was approved. The menus board holds the menu bar
with the Edit menu open, the command palette, the editor's context menu, a tooltip, an unavailable
button with its reason, a hint, an open select and the keyboard focus ring on each kind of control.
The states board holds the status bar in its states, the project banner in each state, ordinary
and urgent notices, the too-narrow message and the panel and application failure screens.

| Theme and density  | Menus and overlays                                                          | States                                                                        |
| ------------------ | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Dark, comfortable  | [menus-dark-comfortable.png](references/shell/menus-dark-comfortable.png)   | [states-dark-comfortable.png](references/shell/states-dark-comfortable.png)   |
| Light, comfortable | [menus-light-comfortable.png](references/shell/menus-light-comfortable.png) | [states-light-comfortable.png](references/shell/states-light-comfortable.png) |
| Dark, compact      | [menus-dark-compact.png](references/shell/menus-dark-compact.png)           | [states-dark-compact.png](references/shell/states-dark-compact.png)           |
| Light, compact     | [menus-light-compact.png](references/shell/menus-light-compact.png)         | [states-light-compact.png](references/shell/states-light-compact.png)         |

Decision: **approved**. The findings returned on the way, each now a rule of the language:

- **A fill is a colour at a high translucency, never a solid colour**, so it takes up the backdrop:
  a status item is its own colour at about a fifth, with a translucent edge; a secondary button is a
  faint tint of the text colour over a blur. A call to action keeps a low translucency, never solid.
- **A call to action is lit from above** in both themes: a gloss over its top half, a bright top
  edge and a faint dark bottom edge.
- **Every overlay is frosted glass**, notices included: the backdrop shows blurred through it.
- **The highlighted row is a wash of accent light** from its leading edge, with a lit edge bar and
  a glowing icon.
- **Keyboard focus is one ring on every control**: a 2 px ring in the focus colour outside the
  control, following its radius, with a soft halo that pulses gently at the full motion level.
- **Animation and flourishes are wanted wherever they help**: the owner asks for as many as the
  application can carry, within the motion levels of `REQ-UX-222`.
- **An unavailable command keeps its reason**: a menu or palette row shows it under its name when
  highlighted; a button keeps its focus and opens its reason on hover or focus; a standing
  explanation becomes a hint behind an (i).
- **A notice's time bar** runs along its bottom edge inside the notice, clipped by its corners.

### 2026-10-17: Settings and the dock chrome, approved as references

Shown: two boards in direction C. The Settings board holds four of its ten pages (Appearance,
Accessibility, Shortcuts and Audio); the other pages are built from the same controls. The dock
board holds a floating panel, a splitter under the pointer, a tab dragged over a group with its drop
targets and landing area, an empty group, and the splitter and tab states. From this decision on,
the owner reviews the comfortable density only; the compact renderings are stored beside them.

| Theme and density  | Settings                                                                          | Dock chrome                                                               |
| ------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Dark, comfortable  | [settings-dark-comfortable.png](references/shell/settings-dark-comfortable.png)   | [dock-dark-comfortable.png](references/shell/dock-dark-comfortable.png)   |
| Light, comfortable | [settings-light-comfortable.png](references/shell/settings-light-comfortable.png) | [dock-light-comfortable.png](references/shell/dock-light-comfortable.png) |
| Dark, compact      | [settings-dark-compact.png](references/shell/settings-dark-compact.png)           | [dock-dark-compact.png](references/shell/dock-dark-compact.png)           |
| Light, compact     | [settings-light-compact.png](references/shell/settings-light-compact.png)         | [dock-light-compact.png](references/shell/dock-light-compact.png)         |

Decision: **approved**. The findings returned on the way, each now a rule of the language:

- **The lit edge.** A highlighted or chosen row (a menu or palette row, a navigation page, a list
  row, the history's chosen point) has no separate mark: its own outline is lit, bright at the
  leading side and fading round the row, over a wash that fades the same way. Chosen from four
  variants (pooled light, an indicator LED, the lit edge, raised glass); it replaces the leading
  line the menus board was first approved with, and the shell references are rendered with it.
- **A chosen segment is a translucent accent wash** with a faint accent edge, never a solid grey.
- **An accent swatch is a glass bead** of its colour with a subtle highlight; the chosen one gains a
  ring and a halo.
- **A drop target is drawn as the group it would make**: the group's outline with the part the
  panel would take filled, the lit one in the call-to-action gradient with a white diagram.
- **Nothing appears or leaves at once.** At the full motion level the drop-target compass springs
  in and out, the landing area grows out of its target and glows, a dragged tab floats in, a
  floating panel's halo breathes and a splitter under the pointer pulses.

### 2026-10-17: the editing and audio panels, approved as references

Shown: two boards in direction C, in both themes at the comfortable density. The editing board
holds Assets (an import under way, and an empty project), the Inspector on a region, History (a
chosen point, and two states compared) and the Editor's empty, loading and failed states. The audio
board holds the Editor showing the waveform above the spectrogram with a spectral marquee and the
brush, the Transport playing, Spectral, the Recorder recording a take, and Analysis.

| Theme and density  | Editing panels                                                                                 | Audio panels                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Dark, comfortable  | [editing-panels-dark-comfortable.png](references/panels/editing-panels-dark-comfortable.png)   | [audio-panels-dark-comfortable.png](references/panels/audio-panels-dark-comfortable.png)   |
| Light, comfortable | [editing-panels-light-comfortable.png](references/panels/editing-panels-light-comfortable.png) | [audio-panels-light-comfortable.png](references/panels/audio-panels-light-comfortable.png) |
| Dark, compact      | [editing-panels-dark-compact.png](references/panels/editing-panels-dark-compact.png)           | [audio-panels-dark-compact.png](references/panels/audio-panels-dark-compact.png)           |
| Light, compact     | [editing-panels-light-compact.png](references/panels/editing-panels-light-compact.png)         | [audio-panels-light-compact.png](references/panels/audio-panels-light-compact.png)         |

Decision: **approved**. The findings returned on the way, each now a rule of the language:

- **Meters move live, with their ballistics.** A level meter rises at once to a new peak and falls
  back at about 20 dB a second; its peak hold waits 1.2 s and then falls; its clip LED lights on an
  over and fades; a correlation pointer glides. This is the meter's own ballistics, which
  `REQ-UX-222` requires in place of an animation's easing.
- **A glow is never clipped**: a control that glows has the room round it to show the glow whole.
- **Every glyph is centred by its ink** in its button, the box of its geometry moved to its grid's
  centre, with no padding of the button's own; measured to within 0.25 px on every icon button.
- **A header's actions are full-size targets**, so their ink sits as far from the panel's side as
  from its top.
- **Switches, radios and checks are hardware.** A switch is a recessed track with a glossy bead
  whose LED lights in the accent when on. A radio is a panel lamp drawn as the power switch is: a
  brushed bezel, a recessed socket and a domed lens; lit, the LED glows inside the lens, never round
  the control.
- **The record button is a backlit red lamp with a Fresnel lens**, chosen from three refinements of
  the dome: a brushed bezel, and a smooth cap with the lens's concentric ridges moulded on its inner
  face, lit from behind by the LED, evenly round each ring and brighter at the centre. The room's
  light reflects once off the smooth front, softly.
- **A value is never cut short**: where it does not fit, it wraps.
- **The light display has its own spectrogram palette**: paper white for silence, deepening through
  violet and magenta to a dark ember for the loudest energy.

The shell references above are rendered again with these rules applied, with the lit edge chosen on
the same day.

### 2026-10-17: the processing and game-audio panels, approved as references

Shown: two boards in direction C, in both themes at the comfortable density. The processing board
holds the Effects rack with a parallel group, the parametric equaliser and the compressor selected,
the menu that adds a processor, Library, Storage with a cleanup planned, and Picture. The game-audio
board holds Asset groups with a group's members, loudness and export plan, the Inspector showing the
group's policy field by field, Loop with its checks and candidates, Game preview running, Model
packs, Diagnostics and Capabilities. Each board's every label, value and control is one the
application has, in its own wording; a rack meter and a gain-reduction reading, which the
application does not have, were left out.

| Theme and density  | Processing panels                                                                                    | Game-audio panels                                                                        |
| ------------------ | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Dark, comfortable  | [processing-panels-dark-comfortable.png](references/panels/processing-panels-dark-comfortable.png)   | [game-panels-dark-comfortable.png](references/panels/game-panels-dark-comfortable.png)   |
| Light, comfortable | [processing-panels-light-comfortable.png](references/panels/processing-panels-light-comfortable.png) | [game-panels-light-comfortable.png](references/panels/game-panels-light-comfortable.png) |
| Dark, compact      | [processing-panels-dark-compact.png](references/panels/processing-panels-dark-compact.png)           | [game-panels-dark-compact.png](references/panels/game-panels-dark-compact.png)           |
| Light, compact     | [processing-panels-light-compact.png](references/panels/processing-panels-light-compact.png)         | [game-panels-light-compact.png](references/panels/game-panels-light-compact.png)         |

Decision: **approved**. The finding returned on the way, now a rule of the language:

- **The light falls from one place on the page.** A knob's shadows and highlights never turn with
  it: its skirt, grip and cap stay still, and only what is printed or moulded on them turns, the
  skirt's pointer, the grip's ribs and the cap's index line.

The Editing workspace references are rendered again with this rule applied.

### 2026-10-17: the dialogues, approved as references

Shown: three boards in direction C, in both themes at the comfortable density. The projects and
export board holds the Projects dialogue (Open with a project that cannot be read and a deleted one,
New with its unavailable reason, This project exporting into a folder that holds another project),
the Export dialogue, a file exporting and the prompt for a name already taken. The workflows board
holds all six guided workflows and the template field's specimens. The third board holds the stored
data decision with its confirmation and its copy being saved, the linked files that changed, and
the diagnostic report.

| Theme and density  | Projects and Export                                                                               | Guided workflows                                                                      | Stored data, linked files, report                                             |
| ------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Dark, comfortable  | [projects-export-dark-comfortable.png](references/dialogs/projects-export-dark-comfortable.png)   | [workflows-dark-comfortable.png](references/dialogs/workflows-dark-comfortable.png)   | [other-dark-comfortable.png](references/dialogs/other-dark-comfortable.png)   |
| Light, comfortable | [projects-export-light-comfortable.png](references/dialogs/projects-export-light-comfortable.png) | [workflows-light-comfortable.png](references/dialogs/workflows-light-comfortable.png) | [other-light-comfortable.png](references/dialogs/other-light-comfortable.png) |
| Dark, compact      | [projects-export-dark-compact.png](references/dialogs/projects-export-dark-compact.png)           | [workflows-dark-compact.png](references/dialogs/workflows-dark-compact.png)           | [other-dark-compact.png](references/dialogs/other-dark-compact.png)           |
| Light, compact     | [projects-export-light-compact.png](references/dialogs/projects-export-light-compact.png)         | [workflows-light-compact.png](references/dialogs/workflows-light-compact.png)         | [other-light-compact.png](references/dialogs/other-light-compact.png)         |

Decision: **approved**. The findings returned on the way, each now a rule of the language:

- **Every word is natural British English**, written as a person would say it, plainly and kindly,
  with none of the tropes of machine writing.
- **A dialogue's title is terse**, a few words such as "File already exists"; its explanation is
  body text, never the title.
- **Button positions are the same everywhere**: the safe action first, and a destructive action
  last, at the trailing end, after Cancel or Keep.
- **A template field highlights its tokens.** Opt-in on the text field: each known token is drawn
  as an accent token at the text's own metrics, its modifier after the colon in the accent turned
  towards violet and a step quieter, and an unknown token in the danger colour with a wavy
  underline. A brace typed twice is one literal brace, drawn as plain text.
- **A template field lists and explains its tokens.** A braces button inside its trailing end opens
  the tokens its caller gives it, in two columns, the token and a short description; choosing one
  inserts it at the caret. The highlighted row, and any token in the field under the pointer, shows
  a rich tooltip with the full description and an example; an unknown token's tooltip says why it is
  red and how to write a brace itself.

The game-audio references are rendered again with the token rules applied to the Inspector's naming
template.

## Editing-latency baseline

Recorded on 2026-10-16 from the unchanged application, before any Phase 16 change to a surface:
three runs of `pnpm test:e2e:latency`, in [evidence/latency-baseline](evidence/latency-baseline).
`tools/compare-latency.mjs` compares a later set of runs against them.
