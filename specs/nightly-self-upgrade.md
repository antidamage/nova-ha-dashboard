<!-- START HERE, never here alone: read C:\workspace\AGENTS.md, then this repo's specs/README.md (the suite, in order). This file is one part of it. -->
# Nightly self-upgrade

A headless agent run that works on this dashboard every night. The nights
follow a three-night cycle: cleanup and bug fixing, then a new feature, then a
ticket from the agents' board. Each night it picks the item, has the choice
attacked before writing any code, ships it through the normal PR flow, deploys
it, verifies it live, and leaves a report.

Requested by alex on 2026-10-26: *"you'll be reviewing and picking one thing
to improve on the dashboard each night. these can be efficiency, technical debt
or adding features you think would be good. ensure that anything you do is able
to be rolled back."* Produced by the plan `make-a-plan-for-mossy-puzzle.md`.

This file is the authority for the job. The runner that launches it lives
outside every repository and only points here; nothing in it overrides this
spec.

## Cadence and budget

- Starts at **00:00** local, every night. Model: Sonnet 5.5, medium effort,
  headless (`claude -p`).
- **Hard stop at 02:30.** A separate nightly job starts at 03:00 and may touch
  the same repositories and hosts. The clock:
  - **01:00** — last time implementation of any step may start. A step not
    started by then ships nothing.
  - **02:00** — last time any change PR may start merging. A change PR not
    ready by then is abandoned. A no-change record PR may merge until 02:30.
  - **02:30** — everything is in one of the end states in
    [What done means](#what-done-means), and the report is published.
- **Abandon** means: close the PR with a comment saying why, delete its branch,
  finish the task-log entry with `--no-changes`, and report it. The proposal and
  its review verdict still reach `main` through the no-change record below.
- One run at a time. The runner holds a lock; a run that finds another one
  active exits without doing anything.

## What a night may work on: the three-night cycle

alex, 2026-10-26: *"tonight we're doing code cleanup and bug fixing. tomorrow
night YOU will design and implement a new feature for the dashboard, one of your
choosing. on the third night you'll pick up a task from the messageboard and
either advance it or complete it. from then on this cycle repeats every three
nights. if there are no bugs worth fixing or if the task is over too quickly
(PLEASE avoid churn) then you can skip forward to the next step in the cycle
that night, e.g. make a new feature."*

The nights run in a fixed order, repeating:

1. **Cleanup and bug fixing.**
   - Bugs come first: errors and warnings in the host's dashboard log, console
     errors and failed requests in the demo build, hydration errors, failing or
     flaky tests, type errors.
   - Then cleanup: build warnings, dead code with no callers, stale `TODO` /
     `FIXME` markers, wasted requests or renders, and other efficiency quick
     wins.
   - Splitting, size-ratchet work and refactor-only changes are debt. They wait
     for the [Debt gate](#debt-gate), and once it opens they come last on this
     night.
2. **A new feature of the agent's own choosing.** The agent designs and
   implements something good for the household: a clear, self-contained
   addition to an existing surface. Not a new area, not a new integration, and
   nothing that needs a credential or a hardware change. A feature too big for
   one night becomes a [Campaign](#campaign), and later feature nights work
   through it one step at a time. Each step obeys every rule here.
3. **A ticket from the board.** Pick up one ticket from the agents' ticket
   board (the `tickets` command, `skills/tickets` in the workspace) and either
   complete it or advance it. See [Ticket nights](#ticket-nights).

**Which step tonight is.** Each ledger entry records its `Step`, and the ledger
is newest first.

- Find the topmost entry dated 2026-10-27 or later. Tonight is the step after
  that entry's step, and step 3 wraps round to step 1.
- When there is no such entry, tonight is step 1. The first cycle night,
  2026-10-27, is step 1.
- Entries dated before 2026-10-27 predate the cycle and do not count.
- A skipped step's entry counts like any other.

So a night that skipped forward moves the whole cycle with it: the following
night picks up after the step that night actually reached.

**Skipping forward, and avoiding churn.** A night may move to the next step
when:

- its step has nothing worth doing, such as no bug worth fixing and no cleanup
  that would be more than churn; or
- its step finished early, with time left on the clock.

Two rules limit this:

- **Never invent work to fill a step.** A trivial change made only so the
  night ships something is churn. Skipping is the right answer, and the ledger
  records the step as `skipped` with the evidence that nothing was worth doing.
- **At most two steps a night.** The second step needs its own pre-execution
  review, its own PR and its own ledger entry, and it obeys the same clock: no
  implementation starts after 01:00.

### Ticket nights

- **Choosing.** Run `tickets list` and choose by list, in this order:
  - `Ready`;
  - an unclaimed ticket that is `In progress`;
  - `Inbox`, then `Needs plan`.

  Never choose any of these:
  - a ticket someone else has claimed (`tickets claim` exits 3);
  - a ticket in `Done`;
  - the board's own how-to card;
  - a ticket labelled `needs-human` or `blocked` whose questions have no answer
    in a comment from alex posted after them;
  - a `Needs plan` ticket whose plan comment is still awaiting her answers.

  Prefer a ticket that can be completed tonight; failing that, prefer the one
  this night can move furthest. The size cap and the rule against operating
  real devices apply on any board. A ticket in another repository follows that
  repository's own rules and specs as well as this one's.
- **Claiming.** Read the whole ticket and every comment with `tickets show`,
  then `tickets claim` it, as the skill says.
- **What completing means.** A `Ready` ticket whose work fits the size cap and
  the clock is implemented and delivered under that repo's normal rules: a
  branch and PR, or a direct commit where the repo policy says so. The night's
  pre-execution review, rollback contract and off-limits list still apply. The
  dashboard is force-updated as in [Delivery](#delivery). Then:
  - when the PR opens, comment `DONE <PR link>` on the ticket and move it to
    `In review` (in a direct-commit repo, `DONE <commit>` once pushed);
  - once the PR is merged and verified, leave a `SUMMARY:` comment and move the
    ticket to `Done`.
- **What advancing means.** For anything else, the night does the next useful
  piece and records it on the ticket.
  - For an `Inbox` or `Needs plan` ticket, that piece is the plan:
    - research what the ticket asks;
    - post a `STATUS` comment with a proposed scope, an approach, the files
      or systems involved, and the open questions only alex can answer;
    - move the ticket to `Needs plan`.

    An unspecified ticket gets no code; the interview that AGENTS.md requires
    before a plan happens with alex, not at night.
  - For a ticket too big for one night, the piece is one deliverable step,
    taken through its PR. Then post a `STATUS` comment saying what is left.
  - When the night ends without the ticket done, run `tickets release` with a
    note of what is left, and always name the list with `--to`, because a bare
    `release` puts the ticket back in `Ready`:
    - a planned ticket goes to `--to "Needs plan"`;
    - a ticket waiting on alex goes to the list it was in before the night
      claimed it;
    - only a ticket that is genuinely specified and ready to build goes to
      `--to Ready`.
- **What never happens at night.** The night does not complete a ticket that
  needs any of these:
  - a deploy other than the dashboard's force-update;
  - a hardware action;
  - a credential;
  - an answer from alex.

  It advances that ticket as far as it can, adds the `needs-human` label
  with a `QUESTION` comment, and lists it at the top of the report. It sends
  no attention ping (see [Discord](#discord-previews-nothing-else)).
- **When nothing can be picked.** If no ticket can be picked or moved forward,
  the night skips forward to step 1.

### Size cap

At most about **300 changed lines and 10 files**, not counting tests and spec
text. A larger item is either split into a campaign or skipped.

### Off limits

Not to be touched by this job, in code or in verification:

- Climate and heater control logic: the aircon planner and thermostat,
  heater command integrity, its route gates and sensor grace windows.
- Managed-computer sleep and wake, and system power actions.
- Face auth, the login surface, sessions and OAuth.
- Code changes to the update and release pipeline: `lib/update/`, `ops/`, the
  update API routes. *Calling* that pipeline is part of the job and allowed
  only in two places: the force-update and status check in Delivery step 10, and
  the release rollback in [When live verification fails](#when-live-verification-fails).
- The household package and any household configuration value.
- Anything whose verification would operate a real device (lights, climate,
  power, media). Verify against the demo build and read-only live checks.
- Changes the token-footprint ratchet would fail, and any splitting or
  refactor-only change while the debt gate is closed.

The standing rules still apply in full: `maintenance-rule.md` (no
machine-specific code, experience-mode parity, hydration), the UI-reuse
convention (`docs/control-inventory.md`), no popups on the climate card, no
write without a user gesture, the entered value is authoritative.

## Choosing the item

Before choosing, gather evidence, cheaply:

- the dashboard's recent errors and warnings on the host (read-only);
- console errors, failed requests and slow steps in a demo-mode e2e run;
- bundle and route sizes from a production build;
- `TODO` / `FIXME` markers in `app/` and `lib/`;
- flaky or slow tests;
- this file's [Backlog](#backlog), [Rejected](#rejected) and
  [Ledger](#ledger).

Never repeat a Rejected item. Never redo what a Ledger entry shipped. A
candidate that came from evidence beats one that came from taste.

## Pre-execution adversarial review

No code is written until the choice has been attacked.

1. Write the **proposal** into [Ledger](#ledger) on the night's branch: what,
   why (the evidence), the files it touches, the risks, how it rolls back, and
   how it will be verified.
2. A **separate sub-agent** that did not write the proposal reads it, the files
   it names and this spec, and argues against it: off-limits areas, hidden
   coupling, experience-mode parity, data compatibility, whether the evidence
   holds, whether it fits the size cap and the clock. Its verdict is one of
   **APPROVE**, **REVISE** (with the concrete change needed) or **REJECT**
   (with the reason), recorded in the ledger entry.
3. REVISE: revise once and resubmit. A second REVISE counts as REJECT.
4. REJECT: move the item to [Rejected](#rejected) with the reason, pick the next
   candidate. After **two** rejected candidates the step ends with no change
   (a step merged earlier that night stands), and the report says why.
5. Only an APPROVE starts implementation. The implementation must stay inside
   what was approved; a material change goes back to step 2.

### The no-change record

A step that ships nothing still owes `main` its record. That covers a skipped
step, a rejected step and an abandoned step, including a second step after a
first that merged. Its ledger entry, with the reviewer's verdicts, and any new
Rejected items reach `main` in one of two ways:

- inside the other step's change PR, if that PR has not merged yet;
- otherwise, in a **docs-only PR** to this file, taken through the same
  `pr-review.ps1` review and `merge-worker.ps1` merge.

If even that cannot merge before 02:30,
the report carries the entry and the Rejected items verbatim, and the next night
lands them first, before choosing anything. Each night reads the last three
reports as well as this file, so nothing rejected is proposed again in between.

## Delivery

AGENTS.md governs; this is the order for this job.

1. Open a task-log entry (`Dashboard`). Give each step a ticket on the board,
   as the AGENTS.md ticket rule requires: on the `Web` board for cleanup and
   feature steps, and the picked ticket itself on a ticket night. An issue found
   but not fixed gets its own ticket, as well as a [Backlog](#backlog) line.
2. Create a worktree branch with `pi-agent/scripts/start-branch.ps1`.
3. Pre-execution review, above. On APPROVE, send the night's Discord preview
   ([Discord](#discord-previews-nothing-else)).
4. Implement. Update the owning area spec in place with the behaviour change
   (one spec per area); this file holds only the ledger entry.
5. Test per `testing.md`, throttled per AGENTS.md (a quarter of the cores,
   `BelowNormal`, orphaned test processes cleaned up first). Production build
   must pass.
6. Screenshots of the affected surface in the demo build, before (from `main`)
   and after (from the branch).
7. Open the PR (`open-pr.ps1`). The body carries the ledger entry and the
   rollback instructions.
8. Independent adversarial PR review through `pr-review.ps1`; fix what it finds;
   re-review when the fixes pass the `reReview` threshold.
9. Merge `main` into the branch, verify, push; then merge with
   `merge-worker.ps1`.
10. Force the dashboard update through the update-force endpoint and confirm the
    live `/api/update` reports the merged commit and the dashboard answers
    healthily.
11. Screenshot the affected surface live, headless. Never open a window and
    never touch an existing browser tab on any screen.
12. Finish the task-log entry. Leave a `SUMMARY:` comment on the step's ticket
    and move it to `Done`, or release it with what is left. The ledger entry is completed on the branch
    before the merge (outcome "merged; live verification in the report"); the
    merge commit and the live result are recorded in the report, never in a
    direct commit to `main`.

### When live verification fails

Request a release rollback at once (it is instant and is never left past
02:30), confirm the previous release is serving and healthy, then open a revert
PR of the squash commit and take it through the same review and merge. A revert
PR still unmerged at 02:30 is left open, named in the report's first line, and
finished first the next night, before anything new is chosen. Until then `main`
holds a commit the host is not running, so every night starts by comparing the
live `/api/update` commit with `main` and reporting any difference. A rollback night is a finished night.

## Rollback contract

Every step's change must be removable in two ways, and the report names both:

- **Instant:** the host updater's rollback, which repoints to the previous
  release with no rebuild. On a two-step night, a rollback after the second
  deploy returns to the first step's release.
- **Permanent:** a revert PR of that step's squash commit.

So:

- One step, one change PR, one squash commit, and at most two steps a night.
  A revert or record PR carried over from the night before is finished first
  and does not count against it. A change spans nights only as a campaign or as
  a ticket worked over several nights, and each step of either is its own
  commit.
- **No irreversible data change.** Anything persisted under `data/`, in
  preferences or in dashboard-config must stay readable by the previous
  release: add fields, never rename or remove them, never rewrite stored
  documents into a new shape.
- A new user-visible behaviour sits behind a preference toggle where one is a
  natural fit, defaulting to the behaviour that ships.
- No dependency major-version bumps, no new runtime dependencies without the
  review naming why.

## Debt gate

Technical-debt paydown is closed to this job while the existing debt effort is
running: Claude Code session `3b61ead0-47ca-4c89-bc80-fefd490fee8b`, executing
the `dashboard-debt-and-size-burndown.md` plan.

**State: CLOSED.**

It opens when alex changes the state above to OPEN, or when both of these
hold, checked at the start of each night:

- the transcript file named for that session id, in the local Claude Code
  projects store, has had no writes for 7 days; and
- no open task-log entry has a summary, area or reference naming
  `dashboard-debt-and-size-burndown`, the burn-down, or that session id.

A night that finds both true writes OPEN here inside that night's own PR (or
its no-change record) and says so in the report. While CLOSED: no file splitting, no size-ratchet work, no refactor-only
change. When OPEN, debt work belongs to the cleanup night and comes last on
it, after bugs and cleanup.

## Discord: previews, nothing else

alex, 2026-10-26: *"You SHOULD message me on discord with a brief overview of
your planned improvement each night before beginning. the peripheral goal for
this process is to generate dopamine in my brain with free, fun new things to a
core system I use every day, so feel free to upsell it and make it exciting."*

**One message per approved step: the preview.** That is at most two a night,
and usually one. Each preview is sent once the pre-execution review has
approved that step's item, and before any code is written, with

```
notify.ps1 -Kind preview -Summary "<the pitch>"
```

It arrives as ✨ **Tonight on Nova**, never stamped *Needs you*. Write it as a
pitch, not a status line: what she gets, why it is a treat, what she will notice
tomorrow — enthusiastic, concrete and true. If the night then fails to ship it,
the report's first line says so. Two to four sentences, at most 800
characters. Sell the real change; do not promise anything the approved proposal
does not deliver, and do not invent numbers. A no-change night sends no preview.

**No other Discord message**, including the attention ping AGENTS.md otherwise
requires before stopping. The runner sets `NOVA_ATTENTION_SUPPRESS`, which makes
an attention ping record instead of send (previews are never suppressed).
Anything that would have been a ping goes at the top of the night's report.

The dashboard's own Discord module can post on its own (reminders, events).
That is not this job's ping and is not suppressed by it; a deploy-triggered post
found while verifying is recorded in [Backlog](#backlog) as a candidate, not
fixed in the same night.

## Report

Every night publishes its report as a private **Claude Doc** (a claude.ai
artifact) titled `Nova nightly YYYY-MM-DD`, through the Claude Docs tools, and
keeps a local copy beside the runner. A headless run has the Docs tools but not
the Artifact page publisher or its image upload (probed 2026-10-26), so the
screenshots are attached to the night's PR as a comment on the forge and the doc
links to that comment. The report holds:

- what was chosen and why, with the evidence;
- the pre-execution and PR review verdicts;
- the PR number and merge commit;
- tests and build results;
- before / after demo screenshots, and the live screenshot;
- rollback instructions for both paths;
- anything left undone, with the exact reason, and anything that would have
  been a Discord ping.

A no-change night still publishes a short report. A single long-lived doc,
`Nova nightly log`, gets one new row per night (date, item, outcome, link to the
night's doc), newest first; its link is kept beside the runner so every night
updates the same doc rather than creating another. Reports contain no secrets
and no credential.

## What done means

A night is done when the report is published and every step the night took is
in one of these states:

- the change is merged, live, verified and its ledger entry complete; or
- a live failure was rolled back, the revert merged, and both verified; or
- a live failure was rolled back and verified, and the revert PR is still open,
  named in the report's first line for the next night to finish; or
- the step shipped nothing, its record is merged or carried in the report as
  [The no-change record](#the-no-change-record) says, and the report says
  exactly why.

## Backlog

Candidates noticed but not yet taken. Any night may add to it.

- React #418 hydration mismatch on a headless live load of `/` (seen 2026-10-26 and 2026-10-27, minified; does not reproduce in the demo build). Needs a live-data repro or a non-minified build against live data.
- `phonoscope-theme-state.alt-theme.test.ts` passes a `now` argument to `writePhonoscopeNowPlaying` that it ignores (TS2554 x3); decide whether the tests should control the clock. Also 1 in the heater-integrity test `no-unsolicited-target-write.test.tsx` and 7 type errors in `lib/update/update.test.ts` (off limits to this job) and 2 in `lib/preferences/preferences.test.ts` (aircon preferences).
- Turbopack warnings left after the 2026-10-26 pass (12 of 32): `lib/tasks/store.ts`, `lib/reminder-icons/store.ts`, `lib/camera/snapshots.ts` (4), `lib/camera/recorder/host.ts`, `lib/phonoscope-images/store.ts` (2), `lib/wallpaper-assets.ts` are computed paths below an already-marked root. `lib/climate-control/store.ts` (2) is off limits to this job.

## Campaign

A multi-night feature plan, if one is running. One step per feature night.

- _(none)_

## Rejected

Items a pre-execution review rejected, with the reason. Never retried.

- _(none)_

## Ledger

One entry per step, so one or two a night, newest first. On a two-step night
the second step's entry sits above the first's:

```
### YYYY-MM-DD — <item>
Step: 1 cleanup | 2 feature | 3 ticket <id> — or "<step> skipped: <evidence nothing was worth doing>"
Evidence: …
Proposal: what · files · risk · rollback · verification
Pre-execution review: APPROVE | REVISE → APPROVE | REJECT — <reviewer's points>
PR: #n · PR review: PASS | BLOCKING → PASS
Outcome: live and verified | rolled back | no change — <why>
```

### 2026-10-27 — Clear the type errors that `tsc --noEmit` reports in test and e2e files
Step: 1 cleanup
Evidence: `npx tsc --noEmit -p tsconfig.json` on main (1208916) reports 33 errors, all in `*.test.ts(x)` and `e2e/`; the production build excludes those files (`tsconfig.build.json`), so nothing in `app/` or `lib/` runtime code is involved. The demo build in dev mode shows no console errors, so there is no runtime bug to take first. The React #418 hydration error seen on a headless live load on 2026-10-26 does not reproduce in the demo build (default and America/New_York timezone), so it stays a Backlog candidate: it needs live data to chase.
Proposal: fix 20 of the 33 errors with type-only edits in tests (typed mock signatures, narrowing casts on deliberately-invalid inputs, a complete driver fixture, a typed CDP event name) · files: `app/components/phonoscope/EffectGroupEntry.test.tsx`, `e2e/orb-dial.spec.ts`, `lib/adaptive-candlelight-transitions.test.ts`, `lib/companion-routes.test.ts`, `lib/companion-switches.test.ts`, `lib/managed-desktop-sync/managed-desktop-sync.clients.test.ts`, `lib/managed-desktop-sync/managed-desktop-sync.theme-actions.test.ts`, `lib/zone-light-rules-runner.test.ts` (8 files, test-only, outside the size cap; the managed-desktop-sync tests cover wallpaper and theme sync, not sleep, wake or power) · left alone: `app/components/dashboard/climate/no-unsolicited-target-write.test.tsx` (1, guards heater command integrity, off limits even for a type-only edit), `lib/update/update.test.ts` (7 errors, off-limits directory), `lib/preferences/preferences.test.ts` (2, aircon preferences, climate), `lib/phonoscope-theme-state/phonoscope-theme-state.alt-theme.test.ts` (3: the tests pass a second argument `writePhonoscopeNowPlaying` ignores, which may mean the tests do not test what they say; that needs a decision on intent, not a type edit, so it goes to Backlog) · risk: none at runtime, no production file changes; a test edit must not weaken an assertion, so each fix changes types only and the unit suite must keep the same count and pass · rollback: release rollback (nothing to roll back at runtime), or revert the squash commit · verification: `tsc --noEmit` error count 33 to 13, unit suite 345 files / 2576 tests unchanged, production build, size ratchet.
Pre-execution review: REVISE (drop the heater-integrity test file; count; state that managed-desktop-sync is not power work) → APPROVE (counts corrected to 20 fixed, 13 left; fixture file not edited, casts stay in the tests, no `!` or optional chaining on mock calls)
PR: #121 · PR review: PASS
Outcome: merged; live verification in the report. `tsc --noEmit` errors 33 to 13; unit suite 346 files / 2582 tests pass, production build passes.

### 2026-10-26 — Silence the Turbopack file-tracing warnings on the data-file paths
Category: quick win
Evidence: `npm run build` on main (31cbcec) prints 32 Turbopack warnings. 31 of them are "Dynamic filesystem access causes tracing of the whole project", across 16 files; 12 sites in 9 of those files are `path.join(process.cwd(), "data"|"config", ...)` roots this change marks, and one says the `lib/phonoscope-store/store.ts` pattern "matches 15316 files". The repo already marks the same root with `/*turbopackIgnore: true*/` in `lib/camera/config.ts`, `lib/dashboard-config/constants.ts`, `lib/dashboard-secrets.ts`, `lib/phonoscope-images/store.ts` and `lib/wallpaper-assets.ts`.
Proposal: add the `/*turbopackIgnore: true*/` marker inside `process.cwd()` call sites that build runtime data/config paths · files: `lib/phonoscope-store/store.ts`, `lib/appletv-command.ts` (2 sites), `lib/default-preferences.ts` (3), `lib/doorbell-secrets.ts`, `lib/light-event-state.ts`, `lib/notifications/store.ts`, `lib/orb-modules-disk.ts`, `lib/orb-timer.ts`, `lib/preferences/store.ts` · risk: a comment only, no runtime change; the paths resolve from `process.cwd()` at run time exactly as before. `lib/climate-control/store.ts` is left alone (climate is off limits); the expected warning count after the change is the before count minus the cleared sites, read from the build rather than predicted · rollback: release rollback, or revert the squash commit · verification: unit suite, tsc, production build with the warning count compared before/after, size ratchet, demo e2e smoke.
Pre-execution review: REVISE (drop lib/climate-control/store.ts as off limits; fix the warning count) → APPROVE
PR: #121 · PR review: PASS
Outcome: merged; live verification in the report. Build warnings 32 → 12; the "matches 15316 files" warning is gone.
