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

## Editing-latency baseline

Recorded on 2026-10-16 from the unchanged application, before any Phase 16 change to a surface:
three runs of `pnpm test:e2e:latency`, in [evidence/latency-baseline](evidence/latency-baseline).
`tools/compare-latency.mjs` compares a later set of runs against them.
