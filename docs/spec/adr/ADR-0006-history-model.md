# ADR-0006 — Branching History and Snapshots

- **Status:** Accepted
- **Decision:** Persist project changes as a typed command journal with periodic immutable snapshots, branching history, named snapshots, full-project A/B comparison, and forks from historical state.
- **Drivers:** effectively unlimited undo/redo, crash recovery, experimentation, provenance, deterministic command replay where appropriate.
- **Constraints:** external side effects are recorded as provenance but never falsely represented as undoable; retained media remains reachable until explicit purge/compaction.
- **Related requirements:** `REQ-STOR-101`, `REQ-STOR-193` through `REQ-STOR-200`.
