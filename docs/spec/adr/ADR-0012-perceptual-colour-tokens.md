# ADR-0012 — Perceptual Colour Tokens with Computed Contrast

- **Status:** Accepted
- **Decision:** Every chrome colour is derived in OKLCH from one base surface lightness, and the text, border and accent tokens are solved by binary search against a WCAG contrast target rather than chosen by hand. Brightness moves the single base number within a safe band; the derived tokens are recomputed.
- **Drivers:** a theme whose contrast holds across the whole brightness range, both themes, every accent and both contrast levels, rather than at the settings the designer happened to try.
- **Constraints:** a component may not hard-code a colour or bypass the semantic tokens. A uniform lightness offset is not acceptable: it flattens the palette and collapses the surfaces at the ends of the range. The tests assert the computed ratio across the whole matrix of theme, accent, brightness step and contrast level, and an accessibility audit checks the rendered result.
- **Related requirements:** `REQ-UX-070`, `REQ-UX-005`, `REQ-UX-071`.
