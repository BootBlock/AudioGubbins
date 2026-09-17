# Privacy, Diagnostics, and Provenance Requirements

> **Authority:** Canonical normative requirements. The generated full specification is derived from these files and MUST NOT be edited directly.
>
> **Modality rule:** Within `CURRENT` and `PLANNED` requirement blocks, `must`/`shall` are mandatory. Legacy wording using `should` is interpreted as a mandatory design target unless the block explicitly states `DEFERRED`, `EXCLUDED`, `optional`, `where practical`, or invokes the formal deviation protocol. An implementation agent MUST NOT downgrade a requirement merely because the source prose used `should`.
>
> **Requirement groups:** Each `REQ-*` identifier owns the complete requirement block beneath it. Every bullet and invariant in the block is part of that requirement group unless explicitly marked otherwise.

## Requirement Index

- `REQ-PRIV-161` — Diagnostic Submission and Consent Policy — owner Phase 01 — scope `CURRENT`
- `REQ-PRIV-162` — Usage Analytics Policy — owner Phase 01 — scope `CURRENT`
- `REQ-PRIV-163` — Collaboration Scope Exclusion — owner Phase 00 — scope `EXCLUDED`
- `REQ-PRIV-164` — Language and Localisation Policy — owner Phase 01 — scope `CURRENT`
- `REQ-PRIV-165` — Structured Diagnostic Logging — owner Phase 01 — scope `CURRENT`

---

## REQ-PRIV-161 — Diagnostic Submission and Consent Policy

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 161 of the pre-hardening baseline

AudioGubbins must never transmit diagnostic information, crash data, logs, capability information, project metadata, file metadata, source media, rendered audio, or any other user/project information without the user's express permission.

There must be no silent crash reporting, background error reporting, or automatic diagnostic upload.

The application may provide an explicit diagnostic-sharing workflow that allows the user to review and submit a sanitised diagnostic bundle. The bundle may include, where useful and non-sensitive:

- AudioGubbins version/build identifier
- Browser and operating-system information
- Runtime capability matrix
- Relevant feature flags and degraded-capability state
- Sanitised stack traces
- Structured application logs
- Performance timings and resource statistics
- Processor/plugin/model version identifiers
- Project/schema version numbers without project content
- Reproduction metadata explicitly selected by the user

By default, diagnostic bundles must exclude:

- Raw or rendered audio
- Project files or project contents
- Source filenames where they may reveal sensitive information
- Full local filesystem paths
- Credentials, access tokens, API keys, cookies, or authentication data
- User-entered free-form content unless deliberately included
- Cloud-provider data
- Private Godot project contents

The diagnostic-bundle UI must show the user what will be included before submission or export.

A user may explicitly opt into a remembered diagnostic-sharing preference so that AudioGubbins does not repeatedly present the same consent dialogue for equivalent diagnostic submissions. This opt-in must be:

- Explicit
- Revocable
- Easy to inspect and change
- Narrowly scoped to diagnostic sharing
- Never interpreted as permission to send analytics, audio, project content, or unrelated data

Even with remembered consent, AudioGubbins must not silently expand the categories of information being transmitted. Materially new data categories require renewed explicit consent.

Where automatic submission is later supported after opt-in, the user must be able to disable it immediately and inspect locally retained submission history where practical.

---

## REQ-PRIV-162 — Usage Analytics Policy

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 162 of the pre-hardening baseline

AudioGubbins shall not implement usage analytics.

This prohibition includes, unless a future specification explicitly reverses it:

- Behavioural analytics
- Feature-usage tracking
- Session analytics
- User profiling
- Engagement metrics
- Advertising identifiers
- Marketing telemetry
- Hidden product instrumentation
- Third-party analytics SDKs

Normal local diagnostic logging is not analytics and remains subject to the privacy and retention requirements defined elsewhere in this specification.

Build tooling and third-party dependencies must be reviewed to ensure that analytics or telemetry are not introduced transitively without deliberate approval.

---

## REQ-PRIV-163 — Collaboration Scope Exclusion

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `EXCLUDED`
- **Legacy source:** section 163 of the pre-hardening baseline

> **Execution rule:** This is an explicit exclusion. Do not implement the excluded capability unless a future approved specification change supersedes this requirement.

Real-time or asynchronous multi-user collaborative project editing is not a current AudioGubbins requirement.

The implementation must not introduce CRDTs, operational transforms, collaborative presence, shared cursors, remote locking protocols, collaboration servers, or similar infrastructure speculatively.

Team workflows may instead use normal project files, portable/unpacked project representations, Git, shared repositories, external storage, and future cloud-provider integrations.

The single-writer local-project ownership model remains authoritative for concurrent AudioGubbins instances unless a future collaboration specification deliberately replaces it.

---

## REQ-PRIV-164 — Language and Localisation Policy

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 164 of the pre-hardening baseline

AudioGubbins shall use British English for all first-party user-facing text, documentation, comments, examples, diagnostic descriptions, help content, and implementation terminology where natural-language spelling differs.

Examples include:

- colour rather than color in prose and user-facing labels
- normalise rather than normalize
- behaviour rather than behavior
- artefact rather than artifact in prose, except where an external API, package, protocol, schema key, or established technical identifier uses another spelling

Internationalisation and translated UI support are not current requirements.

The implementation must not add a localisation framework solely for hypothetical future translation support unless a later requirement introduces it.

However, domain logic should still avoid depending on presentation strings as identifiers. Stable typed identifiers, enums, commands, schema keys, and machine-readable values must remain independent from visible British-English labels.

External standards, browser APIs, third-party library APIs, file-format field names, CSS properties, and source-code identifiers required by their ecosystems must retain their canonical spellings.

---

## REQ-PRIV-165 — Structured Diagnostic Logging

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 165 of the pre-hardening baseline

AudioGubbins shall provide a configurable structured local logging system suitable for diagnosing complex audio, rendering, storage, browser-capability, PWA, Godot-integration, DSP, and recovery failures.

Supported severity levels should include at least:

- Error
- Warning
- Info
- Debug
- Trace

Logging should support:

- Subsystem/category filtering
- Correlation/operation identifiers
- Typed structured fields where practical
- Time stamps
- Bounded retention
- User-configurable verbosity
- Temporary diagnostic mode
- Export/download of logs
- Redaction/sanitisation before sharing
- Clear indication when diagnostic mode is active
- Performance-event logging without behavioural analytics

Diagnostic mode may collect richer execution metadata for a limited period but must not silently collect prohibited sensitive content.

Logs must not contain by default:

- Raw audio samples
- Encoded audio payloads
- Entire project documents
- Credentials or secrets
- Browser cookies
- Authentication tokens
- User passwords
- Full external file contents
- Sensitive cloud-provider data

Local file paths and filenames should be sanitised or redacted in shareable diagnostic bundles unless the user deliberately chooses to include them.

Log retention must be bounded and storage-aware. Users must be able to clear logs and inspect approximate log-storage usage.

---
