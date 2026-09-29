> **Status:** In progress. Phase 03 is being implemented on the branch
> `phase-03-audio-engine`, concurrently with Phase 02 on its own branch. The
> ledger keeps the phase `READY` until its gate passes.

# Phase 03 — Audio Engine Foundation

Resume note. It says where the work is and what is left. The packet is
`docs/spec/phases/phase-03-audio-engine-foundation.md`, and the decisions that
shape the work are `ADR-0030` to `ADR-0033`.

## Where the work is

|          |                                                             |
| -------- | ----------------------------------------------------------- |
| Worktree | `../AudioGubbins-phase-03`, beside the primary checkout     |
| Branch   | `phase-03-audio-engine`                                     |
| Shared   | Phase 02 takes `ADR-0020` to `ADR-0029`, Phase 03 from 0030 |

## Checking the state

```bash
pnpm run verify:commit
cargo test --workspace
pnpm test --filter audio-engine
pnpm test:audio-golden
pnpm test:audio-latency
pnpm test:worker-responsiveness
```

## Slices

1. Decisions: `ADR-0030` topology, `ADR-0031` WASM boundary, `ADR-0032`
   canonical arithmetic, `ADR-0033` channel layouts.
2. Channel layouts in `packages/domain` (WU-03.A).
3. Rust crates `dsp-core`, `resampling` and `wasm-bindings`, and the build of
   the WASM module (WU-03.C).
4. `packages/audio-graph`: descriptors, validation, latency and plans
   (WU-03.B, WU-03.D).
5. `packages/audio-engine`: blocks and streams, the DSP port, execution,
   smoothing, transport and clock, offline render, profiles and scheduling
   (WU-03.A to WU-03.E).
6. `packages/capabilities`: the audio runtime's capabilities and features.
7. `packages/audio-runtime`: the context, the worklet, the render worker and
   the source feed.
8. The application: the Audio engine panel, its commands, the security policy
   and the build.
9. Verification scripts, the evidence package, one review pass, its fixes, the
   ledger and the handoff.
