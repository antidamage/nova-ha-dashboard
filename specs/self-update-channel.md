# Self-update channel

Where the dashboard looks for a new version, who decides it, and which
configuration layer is allowed to say so.

Produced by the plan `2026-09-17-nova-update-channel-local-repo.md`. Related:
`configuration-model.md` (the layering rule this spec is an exception to),
`deployment-and-operations.md` (how a build reaches the host), `ops/README.md`
(the host-side runbook).

## Two halves that do not share a value

The self-update path is split, deliberately, and a change to one half does not
move the other:

- **Detection — in the app.** `lib/update/github-check.ts` asks the channel's API
  for the branch head commit and caches the answer in
  `data/update/check.json`. The app only ever *detects* and *requests*; it never
  fetches, builds or restarts anything.
- **Apply — on the host.** `ops/nova-release` fetches its own git clone,
  builds the new version out-of-line, repoints the releases symlink farm and
  health-gates the switch. It reads a control request from
  `data/update/control/` and writes `data/update/state.json`.

The app must never be able to tell the host where to fetch from. The host-side
repo URL decides what source gets built and run as the app owner, so wiring it
to `dashboard-config` would make a config file into arbitrary code execution.
`NOVA_REPO_URL` is a host environment variable and stays one.

## Configuration

`update` in `dashboard-config`:

| Key | Meaning |
|---|---|
| `repo` | `owner/repo` slug on the channel's host. Default `antidamage/nova-ha-dashboard`. |
| `branch` | Branch whose head counts as the latest available version. |
| `apiBase` | API root of the host named in `repo`. Default `https://api.github.com`. For a Forgejo/Gitea instance this is `<origin>/api/v1`. |
| `autoUpdate` | Default for the auto-update switch; the live toggle is a preference. |
| `checkHourLocal` | Local hour (0-23, in `power.timeZone`) for the once-a-day check. |

`repo` and `apiBase` are separate on purpose. `repo` stays a slug so it is
readable and so the same value means the same thing on every host; `apiBase`
carries the host, and is what a non-GitHub install overrides. A full git URL in
`repo` would be neither.

### The channel is not a UI setting

`repo`, `branch` and `apiBase` are **channel identity**: they say where the
updater looks. They are not editable anywhere in `/config`, and no per-install
runtime state may pin them.

`lib/dashboard-config.ts` therefore treats them as an exception to the normal
merge order:

- The reader takes them from `mergeDeep(defaults, household)` — the shipped
  defaults, overlaid by the household package — and ignores whatever the runtime
  store holds.
- The writer strips them from the candidate before validating and persisting, so
  the runtime store can never come to hold a stale copy of a shipped default.

The exception exists because of a real failure. `writeDashboardConfig` persists
the *merged whole document*, and the runtime store merges **above** the
household layer. So a single `/config` save froze the then-current
`update.repo` into `data/dashboard-config.json`, after which a household
override of the channel silently lost, forever. The general form of that bug —
the runtime store pinning a shipped default — is still open for every other key;
`configuration-model.md` records it.

`autoUpdate` and `checkHourLocal` are ordinary settings and keep the normal
order: preference, then runtime store, then shipped default.

## One request shape for GitHub and Forgejo

The check issues exactly one request:

```
GET {apiBase}/repos/{repo}/commits?sha={branch}&per_page=1&limit=1
Authorization: Bearer {token}      # only when a token is configured
```

and reads `[0].sha`, `[0].commit.message` and `[0].commit.committer.date`.

That template and those three fields serve both hosts. This was probed live, not
assumed:

| | GitHub | Forgejo 10.0.3 (gitea 1.22) |
|---|---|---|
| `…/commits?sha={branch}&per_page=1&limit=1` | array of one | array of one |
| `…/commits/{branch}` (branch in the path) | works | **404** |
| `Authorization: Bearer <token>` | works | works |

Neither host honours the other's page-size parameter, so both are sent: probed
2026-09-17, GitHub with `limit=1` alone returns 30 and Forgejo with `per_page=1`
alone returns 30, while each honours its own. The head commit is first either
way, so the page size is an optimisation rather than a correctness requirement —
the parser takes element zero and never walks the list.

The parser also accepts a bare object, because that is what the branch-in-path
form returns and a future provider may insist on it. There is no provider enum
and must not be one: the two hosts differ in nothing the updater cares about.

### Token

`NOVA_UPDATE_TOKEN` is the token for whatever host `apiBase` names.
`NOVA_GITHUB_TOKEN` is still read as a fallback, for installs that set it before
this spec existed. Sent as `Bearer`, which both hosts accept. Absent token is a
supported state — a public channel needs none — and must not be sent as an empty
header.

An installation whose channel is private (a private Forgejo, for instance) is
the only reason the token exists. It is a secret: it lives in `.env.local`,
never in a repo.

### A failed check is not an update

Same rules as before: only a parseable head sha counts as a known latest
version, a non-OK response records the status code in `check.json` and leaves
`updateAvailable` false, and detection never applies anything without
`autoUpdate`.

## Which value this installation uses

The shipped default is GitHub (`antidamage/nova-ha-dashboard`), and it must stay
that way: the product is distributable, and another household cloning it should
track the upstream project without editing anything.

This house overrides the channel in `nova-household/dashboard-config.json` to
the local Forgejo (`https://ununhexium.tuatara-dory.ts.net:3300/api/v1`). That is
household configuration by the test in `nova-household/README.md`: delete the
package and a stranger cloning the product notices nothing missing. The Forgejo
hostname must never appear in `lib/` or `app/`;
`lib/no-household-data.test.ts` is what keeps it out.

The host half is separate and not configurable from here. Iridium's
`nova-release` clone fetches from its own `origin`, so moving the whole channel
means moving that too — see `ops/iridium/README.md`.

## What done means

- `/api/update` reports `channel.repo` and `channel.branch` from the effective
  config, and a check against the household's `apiBase` returns that host's
  branch head, not GitHub's.
- A household `update.apiBase` wins over a runtime store that pins another
  value, in both the async and sync readers.
- A `/config` save does not persist `update.repo`, `update.branch` or
  `update.apiBase`.
- The product still validates and builds with the household package absent, and
  the demo config still renders the shipped GitHub default.
