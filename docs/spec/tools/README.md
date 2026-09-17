# Specification Tooling

Run from the specification-pack root:

```bash
python tools/spec_status.py
python tools/spec_lint.py
python tools/build_spec.py
python tools/build_spec.py --check
python tools/build_phase_contexts.py
python tools/build_phase_contexts.py --check
python tools/verify_hardening.py
```

`spec_status.py` is a read-only operator helper that reports ledger status, READY phases, and per-phase details. It never advances phases or modifies traceability state.

`spec_lint.py` validates requirement IDs, register ownership, phase packet completeness, readiness/dependencies, the phase DAG, and stale pre-hardening markers.

`build_spec.py` deterministically compiles canonical modules into `generated/AudioGubbins_Implementation_Specification.md`.

`verify_hardening.py` executes the lint/build checks plus hardening-specific assertions.

`build_phase_contexts.py` deterministically creates bounded agent context packs under `generated/context/`.
