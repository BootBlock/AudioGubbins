# AudioGubbins: the working agreement

AudioGubbins edits people's audio in their browser and keeps their projects on their own machine, so
its failure mode is silent, irreversible loss of work. The specification pack under `docs/spec/`
decides _what_ to build and wins over this file on that. This file decides _how_. Read the governing
requirement blocks before you change behaviour. Every rule here is mandatory. Where one names a
_memory note_, open it before that kind of work.

Start from the contracts in [docs/spec/contracts/](docs/spec/contracts/): the agent-execution
contract, the architecture invariants and the decision rules. This file never restates them.

## G6: work in a git worktree

Several agents work here at once, and a shared checkout loses edits without any error
(`REQ-REPO-182.1`). Before your first edit, run `git worktree add ../AudioGubbins-<topic> -b <topic>`
and work only there. The primary checkout is for reading and integrating, and you never switch its
branch.

- One worktree, one branch, one task. Never adopt or remove another agent's tree.
- Edit through absolute paths inside your tree. The Bash tool's working directory drifts.
- Keep trees beside the repository, never inside it, where `pnpm` and test discovery see them.
- Never run `git clean -ffdx`. The second `-f` lets git descend into a nested repository.
- Memory notes: _A commit in a checkout another session shares can take its branch and its hunks_,
  _Verify worktrees idle before removing_.

## G1: one responsibility per module and per file

A module that needs "and" to describe it is two modules. A new effect, codec or storage backend is a
new implementation of the published contract, never another arm of a switch. A domain package takes
its I/O through an injected port, never a browser or Node global: that inversion is what makes the
invariants testable. The invariants set the cohesion and dependency-direction limits. Past one, look
for the seam.

## G2: no god objects

No module that "manages", "handles" or "processes" the application, no universal store or event bus,
and nothing that both decides policy and performs I/O. A mutation of authoritative project state goes
through the typed command layer, and UI code never writes it directly.

## G3: no AI-trope or junior-engineer code

- No comment that restates the code. Explain _why_, or name the non-obvious constraint.
- No interface with one implementation and no test seam, factory that only calls a constructor, or
  wrapper that forwards every member.
- No `catch` that swallows an error or rethrows it unchanged. Catch what you expect, and say why.
  No Rust `unwrap` on a fallible path.
- No `any`, `as unknown as`, `!` or `@ts-expect-error` to quiet the checker. Fix the type.
- No null check on a value that cannot be null, or re-validation of an argument validated one frame
  up.
- No knob, type parameter or extension point for a scenario that does not exist yet.
- No stringly-typed state where a union or a discriminated record belongs.
- No barrel that only re-exports, `Manager`/`Helper`/`Utils` module, or "part 2" file.

## G4: performance, caching and object reuse

- Iterate lazily. Never materialise a buffer, file tree or sample range to measure it.
- Bound concurrency explicitly. Never fan out with an unbounded `Promise.all` over files, workers or
  decodes.
- Keep heavy work off the UI thread. Cache anything derived from a worker, a WASM call or the
  filesystem for the operation's life.
- Pass an `AbortSignal` down every async path.
- Use `ReadonlyArray<T>` for anything consumed twice, and a typed-array view instead of a copy.
- Update a bound list in place, never clear and refill. Memory note: _A live list is updated in
  place, never rebuilt_.

## G5: do not recreate objects unnecessarily

A stateless collaborator is one instance, injected once. A compiled regex, lookup set, `Intl`
formatter, comparer or FFT plan is a module-level `const`. Never re-measure what planning measured,
or re-decode what the cache already holds. A record is a value: never clone one to carry what
should be mutable state.

## G7: use sub-agents where they apply

Send fan-out work to parallel sub-agents with the context they need: the review lenses, package
sweeps, API research. Keep the synthesis and the final judgement in the main thread. Memory note:
_Commit before running review agents_.

## G8: what "verified" means

Verified means observed, not compiled. Run `pnpm run verify:commit` every time and read the output,
and `pnpm run spec:verify` after any edit under `docs/spec/`. The browser suite and mutation
harnesses are not gates for now. Memory note: _AudioGubbins runs light gates until the application
is much more developed_.

- A behaviour change needs a test that fails without it, for the right reason. Prove a test written
  after the code by mutating the code. Memory note: _Prove a regression test against the old code_.
- Test through the injected ports and deterministic fixtures, never the real machine.
- Drive the built app in a real browser before you report that a UI change works.
- Never weaken, widen, skip or delete a test to reach green. If a test is wrong, say so and why.
- Report failures with their output, and skipped steps with the reason. Memory note: _Verify
  everything, never guess_.

## Do the whole fix, never the cheap one

Take the root-cause fix, never the approach that is quick or touches fewer files. Fix every instance
at the level the cause lives: if one codec mishandles a channel layout, fix the seam. Update every
call site, test and document it implies, and delete what it supersedes. Complete is measured against
the defect, not everything nearby. If the right fix is too large or needs someone else's decision,
say so and leave the defect documented. Memory note: _Prefer the correct design over the easy one_.

## Work is not done until it has landed

The session that does the work lands it before it reports done, without being asked. Make atomic
commits with the _why_ in the message (`REQ-REPO-182.3`). This repository merges straight into `main`
and raises no pull request.

```
git status --short                  # every ?? line is work too
git add -A && git diff --cached     # the secrets self-audit
git commit -F <message-file>        # multi-line text goes through a file
# then from the primary checkout
git merge --no-ff <topic> && git push origin main
git worktree remove ../AudioGubbins-<topic> && git branch -d <topic>   # -d, never -D
```

- If `main` moved, merge it into your branch and run `verify:commit` there before merging back.
- A removal that refuses has found uncommitted work. Look at it, and never use `--force`.
- If the work cannot land, leave the tree and say so, naming the branch and the blocker.

## No secrets or personal data

This repository is public, and a pushed commit is permanent. The usual leak here is a _path_: logs,
fixtures, diagnostic bundles and screenshots are full of real usernames and machine names.

- Never commit a real path, machine, domain or share name. Write `C:\Users\<user>\...`, or one of the
  fixtures' invented roots.
- Redact diagnostic and log output before you paste it anywhere, a commit message included. Keep ad
  hoc output outside the working tree.
- Never commit a key, token, password, certificate or connection string. Write `<YOUR_API_KEY>` for
  an example.
- Never commit a real name, private email or phone number. Use
  `BootBlock@users.noreply.github.com`, `@BootBlock`, `example.com`, `*.test` and `localhost`. Crop
  or re-capture a screenshot that shows any of these.
- Read `git diff --cached` before every commit. If in doubt, leave it out and ask.
- If a secret is committed, stop and report it. It must be revoked and scrubbed from history.

## Public-repository hygiene

Code, comments, commit messages, branch names and history are world-readable.

- Stay professional and neutral. No TODO that names or blames a person.
- No internal reference: a private ticket ID, an internal URL or host, or agent process such as
  worktrees and review mechanics. Describe what changed and why.
- Keep the Apache-2.0 licence and its attribution files current. Copy no code of unknown or
  incompatible licence. Vet a new dependency's licence, popularity and maintenance, and keep
  dependencies few.
- Add a build artefact, a local cache, or a file that could hold a real path to `.gitignore`.

## Actioning a GitHub issue

An issue URL, `#<id>` or "issue <id>" with no other instruction asks you to action it end to end:
implement it, run the review lenses its scope requires, land it and close it, with no pause for
approval. A message that only wants discussion gets an answer. Reconcile the whole label
set whenever you open, action, comment on or close an issue or pull request.

Everything you post or edit on GitHub ends with this, worded `actioned`, `opened` or `updated`, and
`pull request` for a PR. If in doubt, include it. A commit message carries none.

```markdown
---

This issue was actioned by an agent on behalf of @BootBlock.
```

## Plan docs carry a status

Every `.md` under `docs/todo/` opens with a `> **Status:**` banner, and a finished one moves to
`docs/todo/done/` in the same change. Never rewrite a past-tense record to match current practice.
Phase status belongs to `docs/spec/traceability/implementation-ledger.json`, never to prose.

## Keep this file small

This file loads into every session. It holds only rules that apply to every change, each in a few
lines. Put the detail for one kind of change in a memory note that a short rule names. Shorten or
replace a rule before you add one, and never append an explanation.
[AGENTS.md](AGENTS.md) stays a pointer to this file. `agent-guide-budget.test.ts` fails past 10,000
characters here, 1,200 in a section, or 600 in `AGENTS.md`. Never raise a budget without asking the
maintainer.
