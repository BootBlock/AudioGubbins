# ADR-0007 — Browser Runtime Capability Tiers

- **Status:** Accepted
- **Decision:** Maintain one application codebase with a Standard Web Runtime that works on GitHub Pages and an Enhanced Web Runtime that opportunistically uses capabilities such as cross-origin-isolated shared memory/threaded WASM when hosting/browser support permits.
- **Drivers:** GitHub Pages deployment, broad browser support, maximum capability without lowest-common-denominator architecture.
- **Constraints:** degradation is transparent and should affect performance/integration convenience rather than core feature availability when a viable fallback exists.
- **Related requirements:** `REQ-PWA-076`, `REQ-PWA-077`, `REQ-PWA-078`.
