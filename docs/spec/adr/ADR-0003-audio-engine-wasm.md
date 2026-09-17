# ADR-0003 — Canonical Audio Engine and WASM Strategy

- **Status:** Accepted
- **Decision:** Use Web Audio/AudioWorklet for real-time browser I/O and a typed processing graph, with Rust as the default language for new performance/safety-critical canonical DSP compiled to WebAssembly. Mature C/C++/other libraries may be used when objectively superior and licence-compatible.
- **Drivers:** deterministic rendering, performance, numerical correctness, local processing, portability.
- **Constraints:** SharedArrayBuffer/threaded WASM is an enhancement, not a GitHub Pages hard dependency. Final render defaults to maximum quality.
- **Related requirements:** `REQ-ARCH-036`, `REQ-ARCH-049`, `REQ-ARCH-081`, `REQ-ARCH-140`, `REQ-ARCH-141`, `REQ-ARCH-144`.
