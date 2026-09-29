> **Status:** In progress. 2026-09-29: the decisions are recorded
> (`ADR-0040` to `ADR-0047`); the packages, the editor surface, the review
> pass, the evidence, the ledger, the handoff and the landing remain.

# Phase 04 — Waveform and Timeline Foundation

Resume note. It says where the work is and what is left. The packet is
`docs/spec/phases/phase-04-waveform-and-timeline-foundation.md`, and the
decisions that shape the work are `ADR-0040` to `ADR-0047`.

## Where the work is

|        |                                                                   |
| ------ | ----------------------------------------------------------------- |
| Branch | `phase-04-waveform-timeline`                                      |
| Shared | Phase 02 takes `ADR-0020` to `ADR-0029`, Phase 04 from `ADR-0040` |

Phase 02 is not yet on `main`. Its branch also changes
`packages/capabilities`, `tools/sync-workspace-graph.mjs`,
`tests/architecture/public-contracts.txt`, the ledger and the root scripts;
whichever lands second merges `main` in and runs `verify:commit` first.

## Gates

Light gates (owner decision, 2026-09-28): whole Vitest, both tsc, lint
(`pnpm run verify:commit`), one review pass with every lens the packet names,
fix its findings, land. The packet's commands are root scripts:
`test:e2e:timeline`, `test:renderer-loss`, `test:touch-pen` and
`test:video-reference`.

## Slices

1. Decisions: `ADR-0040` topology, `ADR-0041` coordinates, `ADR-0042`
   selection set, `ADR-0043` peak pyramid, `ADR-0044` renderer backends,
   `ADR-0045` signal recipes, `ADR-0046` video binding, `ADR-0047` session
   markers.
2. `packages/timeline`: zoom, viewport, formats, ruler, selection set,
   snapping (WU-04.A). The domain's selection is removed.
3. Signal recipes in `packages/audio-engine` and `packages/audio-runtime`.
4. `packages/waveform`: pyramid, builder, codec, query, zero crossings,
   worker, host (WU-04.B).
5. `packages/renderer` and the graphics platform in `packages/capabilities`
   (WU-04.C).
6. `packages/editor-view`: view state, layout, tools, hit testing, frame
   composition (WU-04.D).
7. `packages/video-reference` and the picture panel (WU-04.E).
8. The application: test assets, editor panel, stores, commands, shortcuts,
   peak cache, playback of an asset, picture panel.
9. Browser suites, evidence, one review pass, its fixes, the ledger, the
   handoff and the landing.

## Progress

Nothing is committed beyond the decisions.
