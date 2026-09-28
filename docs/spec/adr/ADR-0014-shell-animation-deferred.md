# ADR-0014 — Shell Animation Deferred Until a Consumer Exists

- **Status:** Accepted
- **Supersedes:** the animation clause of `ADR-0001`, which names Motion for React for application-shell animation. Everything else in `ADR-0001` stands.
- **Decision:** AudioGubbins does not declare or install an animation library until a component imports one. The motion levels `REQ-UX-069` requires are carried by CSS transitions over the design system's motion tokens, which is sufficient for the shell's transitions and reaches the docking engine's own animation through the minimal-motion guard. Motion for React remains the chosen library for the first requirement that CSS cannot meet.
- **Drivers:** a dependency nothing imports is an install cost, a supply-chain surface and a licence obligation for no return; the reduced-motion policy must apply to third-party animation as well as to AudioGubbins' own, which a stylesheet rule does and a library call does not.
- **Constraints:** the decision is recorded rather than left implicit, because `ADR-0001` is the architecture record a later agent reads, and a library named there and absent from the manifests reads as an oversight. When an animation requirement arrives, it arrives with this ADR superseded rather than with a library added quietly.
- **Related requirements:** `REQ-UX-069`, `REQ-ARCH-034`, `REQ-ARCH-151`, `REQ-EXEC-169`.
