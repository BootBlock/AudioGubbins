# Requirement Writing Standard

- Requirement identifiers are immutable after production implementation begins.
- One requirement group may contain multiple tightly related behaviours when they share one owning phase and verification domain.
- `CURRENT` and `PLANNED` blocks are normative.
- `DEFERRED` blocks constrain architecture but do not authorise user-facing implementation now.
- `EXCLUDED` blocks prohibit implementation until superseded.
- Requirements name observable behaviour and invariants; implementation details belong in Phase Packets or ADRs unless the detail itself is a product/compatibility contract.
- Ambiguous phrases such as “where possible” require an explicit capability/error rule or a deviation record when they affect acceptance.
- Examples illustrate requirements but do not reduce them.
- Requirement text uses British English.
