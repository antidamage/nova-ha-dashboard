<!-- START HERE, never here alone: read C:\workspace\AGENTS.md, then this repo's specs/README.md (the suite, in order). This file is one part of it. -->
# Private reminders

Reminders belong to one home user. Each user sees and sets only their own.
alex, 2026-11-21: *"now that we have multi-user setups, reminders can be
personalised and private as well. each user can only see and set their own
reminders."*, *"move all of the existing reminders under alex"*, *"washing
notifications can be global. everyone should see the status orb activity for a
washing machine load"*, *"the kiosk belongs to alex, which was indicated by her
claiming it at login. the apple tv control is also owned by alex and not
shared. once toggled, chiming should stay on for that user or off for that user
in the future"*, *"we also do want some reminders to be set as 'household' in the
future, so put that functionality in but don't use it yet"*, and *"task count and
the link to the tasks site should only be for alex. turn this into a module
rather than a built-in feature"*.

Ticket 887667. Plan that produced this spec: Claude Code session, 2026-11-21.
Related: `specs/home-users.md` (identity), `specs/tasks-panel.md` (reminders),
`specs/module-system.md` (the daily tasks module).

## 1. What "private" means here

Identity is the home user a device has chosen (`specs/home-users.md` §3). It is
**not a login**: anyone at a device can pick another name. The guarantee is
device-scoped, not authenticated:

- Another user's reminders are **never sent** to a device that chose a different
  user: not in a list response, not on a stream, not in the icon roster, not as
  an alert.
- A write that names another user's reminder is refused.
- Someone who picks another person's name on a device gets that person's
  reminders. Real accounts are a separate piece of work. The reminders panel does
  not claim more than this: it never says "secure" or "protected".

**Devices belong to whoever claimed them.** The kiosk is alex's because she
chose herself on it; the Apple TV is alex's too, and neither is a shared
screen. So a device never needs a "shared screen" mode: it shows the reminders of
the user it is set to. A kiosk stays on its user until someone logs out, and after a log-out the
chooser (which cannot be dismissed) asks who is there; there is no idle return to
the claimant. Accepted consequence, stated plainly: while the kiosk is on another
user, alex's reminders do not show or chime on it. An idle return would change
how Home Users identity behaves and is a separate decision.

## 2. The viewer

Every browser request carries the device's choice in the cookie `nova-viewer`.

| Cookie value | Meaning |
|---|---|
| a home user's id | that user's view |
| `household` | the everyone view: only household and washing reminders |
| absent | the device has not chosen: same as `household` |

A cookie, not a header or query string, because it rides on every `fetch` and on
the `EventSource` connections with no call-site change. The client writes it
whenever the device's home user changes (`homeUserSetting.ts`: write and log
out), `Path=/`, `SameSite=Lax`, one year. **It is also written before anything
else runs on a page load**: a small inline script in the root layout copies the
stored user into the cookie synchronously, so the first `fetch` and the first
`EventSource` already carry it. Until the stored user has been read, the
Reminders panel and bar hold a neutral loading state, so "Choose who you are"
shows only for a device that really has no user.

**Other clients** send the header `X-Nova-Viewer`, with the same values as the
cookie, plus `system`:

| Client | How it declares the viewer |
|---|---|
| Web dashboard (every screen, kiosk) | the `nova-viewer` cookie |
| Apple TV app | a device binding to alex (below); later `X-Nova-Viewer: <person id>` from its own settings |
| iPhone app | the web view's cookie, or a device binding, or the header if native |
| Agents, MCP tools, scripts, the voice server | `X-Nova-Viewer: system` |

A client that sends nothing reads as `household`: the server **fails closed** for
every unidentified client.

**Device bindings** give a client that cannot choose a user one of its own. The
Apple TV is alex's, so on day one, without changing the tvOS app, the setting
`dashboard.reminders.clientViewers` lists `{ userAgentContains, user }` pairs: a
request with no viewer whose `User-Agent` contains the text is read as that
home user. Default empty. The values are household data, set in the household
package and never in this repo. A tvOS or iPhone app that later sends its own
`X-Nova-Viewer` takes precedence over a binding. This is self-declared like
everything else here.

**System callers** see every reminder with its owner and must name one to add
one. Like the cookie, the header is self-declared, as section 1 says.

**Voice** ("remind me to ..."): the voice server is a system caller and passes the
identified speaker's person id as `owner`; with no confident speaker it passes
nothing and the add is refused with `owner-required`, which the assistant reads
back as "who is this reminder for?". Voice is offline for now, so this is the
contract, not code in this change.

The viewer is read in `lib/tasks/viewer.ts` (`viewerFromRequest`), which returns
`{ kind: "system" } | { kind: "household" } | { kind: "user", id }`. A user id
that does not name a current home user reads as `household`.

## 3. Ownership and the Household flag

`Task.owner?: string` is a home user's person id. `Task.household?: boolean`
makes a reminder visible to everyone.

- A **private reminder** has an `owner` and no `household`. Visible to that user
  only.
- A **household reminder** (`household: true`) is visible to every device,
  household view included, and any user may complete, dismiss or edit it. Its
  `owner` is the person who made it, kept as a record. Alerts and chimes reach
  every device that has chimes on. **The capability exists and nothing uses it**:
  no reminder is household unless someone ticks the editor's "Household" box, and
  the migration sets none.
- **Washing reminders** (`washReminder(task)`) are household by rule, with no flag
  needed, because *"everyone should see the status orb activity for a washing
  machine load"*.
- A task with neither an owner nor either of those is **legacy**. It is read as
  owned by `dashboard.reminders.legacyOwner` (a person id, default empty) when
  that is set, so no one else sees it in the window before the move in section 8;
  when it is unset it is visible only to system callers (fail closed). iCloud mirrors are left as they
  are (alex: that feature is no longer used), so they are legacy.
- A reminder whose owner is no longer a home user is visible to system callers
  only; the assign script (section 8) can move it.

`canSeeTask(task, viewer)` and `canWriteTask(task, viewer)` are the only two
rules, in `lib/tasks/ownership.ts`, with unit tests. `canSeeTask`: system sees
all; household and washing reminders are seen by all; a user sees
`owner === id`; the household view sees only household reminders. `canWriteTask`
is the same, so a household reminder is writable by any user viewer.

## 4. Reads

- `GET /api/tasks?command=list` returns only visible tasks.
- The two streams, `GET /api/events` and `GET /api/tasks?command=listen`, record
  each connection's viewer when it opens. Task events are built **per
  connection**: `tasks` (snapshot and every update), `task-alert`.
  A connection never receives an event about a task it cannot see. (`task-dismiss`
  carries only a task id, no content, and goes to every connection.) The server keeps the latest task list and filters at send time, caching
  one JSON string per viewer.
- Changing the device's user first **clears the tasks and roster held in the
  page**, then reconnects the shared event stream (`sharedDashboardEvents.ts`
  reopens on `HOME_USER_CHANGE_EVENT`), so the previous user's reminders are
  never drawn for the new one while the new stream lands.
- `GET /api/reminders/icons` and the `reminder-icons` event return only roster
  entries whose name matches a task the viewer can see. A name used by two users
  shares one icon (the roster is keyed on the normalised name); accepted.
- The status orb's reminder source and the reminder icon bar read the filtered
  feed, so they need no rule of their own. Washing reminders arrive for everyone,
  so every device shows the washing machine's orb activity.

## 5. Writes

`POST /api/tasks` (add), the update, remove and bulk commands, and the routes
`/api/tasks/[id]`, `.../complete`, `.../uncomplete`, `.../dismiss`,
`.../chimed`:

- **add**: a user viewer creates the reminder with `owner` set to themselves;
  any `owner` in the body is ignored. `household: true` in the body is honoured.
  A household or undecided viewer is refused with 403 `choose-a-user`. A system
  caller must pass `owner` (a home user id) or `household: true`; neither is a
  400 `owner-required`.
- **update, remove, complete, uncomplete, dismiss, chimed, bulk**: the viewer
  must pass `canWriteTask`. A reminder the viewer cannot see is answered **404**,
  the same as a missing id, so existence is not revealed. A user viewer may set
  `household` on their own reminders; `owner` cannot be changed by a user viewer,
  a system caller may set it.
- **complete, uncomplete, dismiss, chimed** use a looser rule than edit and delete: the
  household view (and an undecided device) may also act on the household and
  washing reminders it is shown, so a wash-done alert can be dismissed on a device
  with no chosen user. It never edits or deletes them and never touches a private one
  (`canActOnTask` in `lib/tasks/ownership.ts`).
- Bulk and import reject the whole request if any item fails the check. A user
  import is that user's; a system import names the `owner` in the request body.
- The icon roster routes answer a name the viewer cannot see with the same 404
  whether it belongs to another user or to nobody.
- `follows` may only name an anchor the viewer can write.

## 6. Alerts and chimes

`task-alert` goes only to connections that can see the task, so
a private reminder's pop-up and chime play only on its owner's devices. The
once-per-occurrence chime claim (`alertChimedFor`) is unchanged. Household and
washing alerts go to every connection. Module events (`reminder.due`) and the
household event spool carry `owner` and `household`, so a module such as the
Discord bot can route by it; nothing is withheld from them.

**Chime on or off is remembered per user.** It covers reminder chimes and the
completion chime that timers and washing loads share (`playUxSound("timerAlert")`).
It sits beside, not in place of, the theme's sound assignment: the theme decides
*which* sound `timerAlert` makes (or None) for everyone, this switch decides
*whether* this user's devices play any, and either one off means silence. It is
a per-user setting, so it cannot live in the theme. `data/reminder-user-prefs.json`
holds `{ [personId]: { chime: boolean } }`, default `true`. `GET` and `PUT`
`/api/reminders/prefs` read and write the viewer's own entry (a user viewer
only; household viewers get `chime: true` and cannot write). The client reads it
at load and when the user changes, and a screen set to a user whose chime is off
plays no reminder chime and no timer or wash completion chime, though the
pop-up and tiles still show. The toggle is in the Reminders panel's Advanced
area, labelled "Chimes for this user". Turning it on or off persists
for that user on every device, with the existing slide switch from the control
inventory and immediate feedback. **Whose preference applies is the device's
user**: the kiosk and Apple TV play by alex's, a phone by its user's. That
holds for every chime on that device, a household or washing one included: a
device whose user has chime off stays silent for it too, while the pop-up and
orb activity still show.

## 7. The surface

- **Reminders panel and icon bar**: unchanged in layout; they show whatever the
  feed holds. The icon bar's clusters and tiles are built from the filtered list.
- **Who am I**: identity is the existing home-user chooser and log-out button
  (`app/components/home-users/HomeUserChooser.tsx`, `LogoutButton.tsx`); no second
  picker or name chip is added. On the kiosk, another household member reaches
  their own reminders in one touch through that log-out button and the chooser.
- **Empty states**: a device with no chosen user, or set to Household, shows in
  the Reminders panel "Household reminders only. Choose who you are to see
  yours". A user with no reminders sees the existing empty panel.
- **Household view**: shows household and washing reminders only. The editor's
  *Add* is disabled with "Choose who you are to add reminders".
- **Editor**: a "Household" checkbox sets `household`. It is **hidden** unless
  `dashboard.reminders.allowHousehold` is true (default false), so the capability
  is built, tested and reachable by API, and not offered until someone turns it
  on. A new reminder is always the creating user's; nothing becomes household
  by accident. There is no owner picker.
- **Config page reminders list**: lists only the viewer's visible reminders.
- No lock icon or owner label is drawn.

## 8. Existing reminders

All current reminders move under alex, private to her (she chose private).
Mechanism: after the release is live, `scripts/assign-reminder-owner.mjs` (a
system caller) does:

1. `--dry-run` lists what would move and writes nothing.
2. Otherwise writes the whole task list, as fetched, to the file named by
   `--backup` (outside any repository) first.
3. Reads `/api/home-users`, finds the person whose name is the argument, and
   updates every task that has no owner, no `household`, and is not a washing
   reminder, with `owner` set to that id. It also takes reminders whose owner is
   no longer a home user when `--reclaim` is passed.
4. Reports the count and ids moved. Safe to repeat.

It holds no household value: the person's name is an argument. Until it runs,
legacy reminders are read as the `legacyOwner`'s (section 3), set to alex's id
in the household package straight after the release, so nothing leaks to another
user in between, and nothing disappears for alex once it is set.

## 9. The daily tasks module

The unfinished-task count and the link to the daily tasks site stop being a
built-in feature. They become an installable module, `daily-tasks`, shown only to
the person it is configured for. The tasks site itself (`daily-tasks` repo) is not
part of the module.

- **Package**: its own repository `nova-module-daily-tasks` (private forge
  remote, ignored by the workspace root like `nova-module-discord`), with
  `module.json`, a server half and a client half, built with esbuild to ESM per
  `specs/module-system.md` §1. It is installed from its zip like any module.
- **Slot**: the dashboard gains one slot, `reminder.bar.end`, rendered after the
  last reminder tile, context `{ viewer }` (the device's home user id or
  `household`). It is added to the hook list, the slot table in
  `specs/module-system.md` §3.1, and `ReminderIconBar.tsx` in place of
  `DailyTasksTile`.
- **Config** (the module's `configSchema`): `siteUrl` (http or https), and
  `showForUser` (a person id). Both are household values, so they live in the
  module's installed `config.json`, never in a repo.
- **Server half**: `GET /api/modules/daily-tasks/count`, which answers
  `{ configured, unfinished, url }` fetched from `<siteUrl>/api/count` with a 3 s
  timeout, **only when the request's viewer equals `showForUser`**; any other
  viewer gets `{ configured: false }`. So the count and link are not served to
  anyone else, not merely hidden.
- **Client half**: registers `reminder.bar.end`. It renders nothing unless
  `ctx.viewer === showForUser`; otherwise the same tile as before (check glyph
  over the count, a link to the site, dim dash when unreadable), with its few
  styles inline in the slot because a module ships no global stylesheet.
- **Removed from the dashboard**: `DailyTasksTile.tsx`, `lib/daily-tasks/`,
  `app/api/daily-tasks/`, `app/styles/reminders/daily-tasks-tile.css` and its
  import, the `dashboard.reminders.dailyTasksUrl` setting (schema, default, bar
  settings, `DailyTasksAddressField`, the Reminders config row), and the "Daily
  tasks count" section of `specs/tasks-panel.md`, replaced by a pointer here.
- **No gap**: the slot reserves no space; for anyone but the configured user it
  renders nothing and the tiles sit as if it did not exist.
- **Live cutover**: the old `siteUrl` is read from the live config before the
  release. The release removes the built-in tile and adds the slot; the module is
  installed immediately after, with that `siteUrl` and `showForUser` set to
  alex's person id. The tile is absent for the minutes between the two; if the
  install fails it stays absent and the failure is reported, nothing else breaks.

## 10. Not in scope, and follow-ups

Real accounts or authentication; per-user iCloud accounts; sharing a reminder
with one named other user; removing the household event spool's copy of names.
Follow-up tickets: the Apple TV and iPhone apps sending their own viewer
(their own repos and CI), at which point `clientViewers` is removed: it is a
temporary bridge, shared by every device with the same `User-Agent`, and is not
authentication. The Discord module echoing only reminders its owner may see: it
relays every `reminder.due` to one account, alex's own DM, and that is
accepted for now; a second user's private reminder text would reach her DM until
the module filters by `owner` (it is a separate repository and release).

## 11. Done means

- `lib/tasks/ownership.test.ts`: both rules over system, household view, user,
  household flag, washing, legacy and removed-owner cases.
- `lib/tasks/viewer.test.ts`: cookie and header parsing, the system/household
  split, an unknown user id.
- Route tests: list filtered; each write route 404s a foreign reminder; add sets
  the owner; household add is 403; a system add needs an owner; a household
  reminder is writable by another user.
- Stream test: two connections with different viewers receive different `tasks`
  and `task-alert` events, a washing alert and a household alert reach both.
- Prefs: chime off for a user silences chimes on a device set to that user and on
  no other.
- Module: `reminder.bar.end` renders in the bar; the module's count route refuses
  another viewer; the dashboard has no reference to `dailyTasksUrl`; the module
  zip installs and the unit tests in its repo pass.
- Assign script: dry run writes nothing; a run writes the backup and moves the
  right set; a second run moves nothing.
- Live check after release: a device set to a user that owns nothing shows an
  empty list; set to alex every existing reminder is present and the daily
  tasks tile shows; set to anyone else the tile is absent; a washing load shows in
  the orb for both.
