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

## Editing-latency baseline

Recorded on 2026-10-16 from the unchanged application, before any Phase 16 change to a surface:
three runs of `pnpm test:e2e:latency`, in [evidence/latency-baseline](evidence/latency-baseline).
`tools/compare-latency.mjs` compares a later set of runs against them.
