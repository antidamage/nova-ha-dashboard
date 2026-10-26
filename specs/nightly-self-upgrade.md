<!-- START HERE, never here alone: read C:\workspace\AGENTS.md, then this repo's specs/README.md (the suite, in order). This file is one part of it. -->
# Nightly self-upgrade

A headless agent run that improves this dashboard by one thing every night:
it picks the item, has the choice attacked before writing any code, ships it
through the normal PR flow, deploys it, verifies it live, and leaves a report.

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
  - **01:00** — last time implementation may start. Later than that, the night
    is a no-change night.
  - **02:00** — last time the night's change PR may start merging. A change PR
    not ready by then is abandoned. A no-change record PR may merge until 02:30.
  - **02:30** — everything is in one of the end states in
    [What done means](#what-done-means), and the report is published.
- **Abandon** means: close the PR with a comment saying why, delete its branch,
  finish the task-log entry with `--no-changes`, and report it. The proposal and
  its review verdict still reach `main` through the no-change record below.
- One run at a time. The runner holds a lock; a run that finds another one
  active exits without doing anything.

## What a night may work on

In priority order. Prefer the cheapest item that is genuinely worth having.

1. **Quick wins — efficiency.** Bundle or route size, render cost, needless
   re-renders, polling cadence, API latency, slow or flaky tests, wasted network
   requests, console errors and warnings in the demo build.
2. **Small features** the agent judges good for the household: a clear,
   self-contained improvement to an existing surface. Not a new area, not a new
   integration, nothing that needs a credential or a hardware change.
3. **Campaign steps.** A night may instead write a multi-night plan into
   [Campaign](#campaign) below, and later nights work through it one step each.
   Each step is still one night's item and obeys every rule here. Early nights
   should prefer quick wins over starting a campaign.
4. **Technical debt — last, and gated.** See [Debt gate](#debt-gate).

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
   candidate. After **two** rejected candidates the night ends with no change
   and a report saying why.
5. Only an APPROVE starts implementation. The implementation must stay inside
   what was approved; a material change goes back to step 2.

### The no-change record

A night that ships nothing still owes `main` its record. The ledger entry (with
the reviewer's verdicts) and any new Rejected items go in a **docs-only PR** to
this file, taken through the same `pr-review.ps1` review and `merge-worker.ps1`
merge. That PR is the night's one PR. If even that cannot merge before 02:30,
the report carries the entry and the Rejected items verbatim, and the next night
lands them first, before choosing anything. Each night reads the last three
reports as well as this file, so nothing rejected is proposed again in between.

## Delivery

AGENTS.md governs; this is the order for this job.

1. Open a task-log entry (`Dashboard`).
2. Create a worktree branch with `pi-agent/scripts/start-branch.ps1`.
3. Pre-execution review, above. On APPROVE, send the night's Discord preview
   ([Discord](#discord-one-preview-nothing-else)).
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
12. Finish the task-log entry. The ledger entry is completed on the branch
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

Every night's change must be removable in two ways, and the report names both:

- **Instant:** the host updater's rollback, which repoints to the previous
  release with no rebuild.
- **Permanent:** a revert PR of the night's single squash commit.

So:

- One night, one change PR, one squash commit. A revert or record PR carried
  over from the night before is finished first and does not count against it. No change spans nights except through a
  campaign, and each campaign step is its own commit.
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
change. When OPEN, debt is still the last category, after quick wins, features
and campaign steps.

## Discord: one preview, nothing else

alex, 2026-10-26: *"You SHOULD message me on discord with a brief overview of
your planned improvement each night before beginning. the peripheral goal for
this process is to generate dopamine in my brain with free, fun new things to a
core system I use every day, so feel free to upsell it and make it exciting."*

**Exactly one message a night: the preview.** Sent once the pre-execution review
has approved the item and before any code is written, with

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

A night is done when one of these is true and the report is published:

- the change is merged, live, verified and its ledger entry complete; or
- a live failure was rolled back, the revert merged, and both verified; or
- a live failure was rolled back and verified, and the revert PR is still open,
  named in the report's first line for the next night to finish; or
- no change shipped, and the report says exactly why.

## Backlog

Candidates noticed but not yet taken. Any night may add to it.

- Turbopack warnings left after the 2026-10-26 pass (12 of 32): `lib/tasks/store.ts`, `lib/reminder-icons/store.ts`, `lib/camera/snapshots.ts` (4), `lib/camera/recorder/host.ts`, `lib/phonoscope-images/store.ts` (2), `lib/wallpaper-assets.ts` are computed paths below an already-marked root. `lib/climate-control/store.ts` (2) is off limits to this job.

## Campaign

A multi-night plan, if one is running. One step per night.

- _(none)_

## Rejected

Items a pre-execution review rejected, with the reason. Never retried.

- _(none)_

## Ledger

One entry per night, newest first:

```
### YYYY-MM-DD — <item>
Category: quick win | feature | campaign | debt
Evidence: …
Proposal: what · files · risk · rollback · verification
Pre-execution review: APPROVE | REVISE → APPROVE | REJECT — <reviewer's points>
PR: #n · PR review: PASS | BLOCKING → PASS
Outcome: live and verified | rolled back | no change — <why>
```

### 2026-10-26 — Silence the Turbopack file-tracing warnings on the data-file paths
Category: quick win
Evidence: `npm run build` on main (31cbcec) prints 32 Turbopack warnings. 31 of them are "Dynamic filesystem access causes tracing of the whole project", across 16 files; 12 sites in 9 of those files are `path.join(process.cwd(), "data"|"config", ...)` roots this change marks, and one says the `lib/phonoscope-store/store.ts` pattern "matches 15316 files". The repo already marks the same root with `/*turbopackIgnore: true*/` in `lib/camera/config.ts`, `lib/dashboard-config/constants.ts`, `lib/dashboard-secrets.ts`, `lib/phonoscope-images/store.ts` and `lib/wallpaper-assets.ts`.
Proposal: add the `/*turbopackIgnore: true*/` marker inside `process.cwd()` call sites that build runtime data/config paths · files: `lib/phonoscope-store/store.ts`, `lib/appletv-command.ts` (2 sites), `lib/default-preferences.ts` (3), `lib/doorbell-secrets.ts`, `lib/light-event-state.ts`, `lib/notifications/store.ts`, `lib/orb-modules-disk.ts`, `lib/orb-timer.ts`, `lib/preferences/store.ts` · risk: a comment only, no runtime change; the paths resolve from `process.cwd()` at run time exactly as before. `lib/climate-control/store.ts` is left alone (climate is off limits); the expected warning count after the change is the before count minus the cleared sites, read from the build rather than predicted · rollback: release rollback, or revert the squash commit · verification: unit suite, tsc, production build with the warning count compared before/after, size ratchet, demo e2e smoke.
Pre-execution review: REVISE (drop lib/climate-control/store.ts as off limits; fix the warning count) → APPROVE
PR: (pending) · PR review: (pending)
Outcome: merged; live verification in the report. Build warnings 32 → 12; the "matches 15316 files" warning is gone.
