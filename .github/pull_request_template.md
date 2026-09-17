<!-- What does this change do, and why? Describe the what and the why, never the plumbing. -->

> **AudioGubbins does not accept external pull requests.** One opened by anybody who is not a
> collaborator is closed automatically. Please
> [open an issue](https://github.com/BootBlock/AudioGubbins/issues/new/choose) instead, and see
> [CONTRIBUTING.md](https://github.com/BootBlock/AudioGubbins/blob/main/CONTRIBUTING.md).

## Summary

## Verification

<!-- G8: "verified" means observed, not compiled. Say what you ran and what you saw. -->

## Checklist

- [ ] `pnpm run verify:commit` passes, and I read the output.
- [ ] Where this touches the app, a worker or the build, `pnpm run verify:integration` passes too.
- [ ] The behaviour change has a test that **failed before the fix**, for the right reason.
- [ ] The tests run through the injected ports and deterministic fixtures, not the real machine.
- [ ] Where the change has a runtime surface, I drove the built app in a browser and observed it.
- [ ] Every requirement this claims to satisfy is named by ID, and the phase packet covers the
      scope.
- [ ] Where this changes the specification pack, `pnpm run spec:verify` passes.
- [ ] No secrets, real filesystem paths, user names or machine names in the diff, self-audited with
      `git diff`. Any screenshot is cropped or synthetic, and any audio fixture is synthetic.
- [ ] The engineering gates hold: one responsibility per module (G1), no god objects (G2), no
      AI-trope code (G3), lazy iteration and bounded concurrency (G4), collaborators and
      module-level lookups reused (G5).
