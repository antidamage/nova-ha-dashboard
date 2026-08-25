# Bedroom heater — control integrity

Owner: Adeline. Written 2026-08-25 after the heater was found running at a
target she had not set, for what she reports is not the first morning.

This spec covers who is allowed to change the bedroom heater's mode and target,
what the card is allowed to display, and what the server must record when a
change happens. It supersedes nothing; it sits alongside the existing rule that
**the heater has no clock schedule** (auto-on/auto-off window removed
2026-08-19) and the room-puck sensor rules.

## 1. The incident this comes from

Server preference history (`data/history/preferences/log.jsonl`), NZST:

```
2026-08-24 21:10:10   mode -> "auto", temperature -> 21
2026-08-25 01:46:14   temperature -> 22
2026-08-25 05:26:27   temperature -> 20
2026-08-25 07:44:23   mode -> "off"
```

Adeline's account: the card was set to Off at target 20, and the heater was
found on at 22. The heater was in `auto` continuously from 21:10 to 07:44.

### Ruled out, with evidence

| Suspect | Why it's out |
|---|---|
| The removed clock schedule | Running build is post-2026-08-19; `autoOnMinutes`/`autoOffMinutes`/schedule-edge strings absent from the compiled `.next` bundle. Bind mount `/opt/nova-ha-dashboard` → `/app`, `BUILD_ID` mtime 2026-08-24 12:15 NZST. |
| HA automations / scenes / scripts | No automation, script or scene references the heater entity. |
| Sensor-grace fail-safe | `sensor.tuya_mobile_bedroom_sensor_temperature` had zero `unavailable` readings all week. |
| Preferences defaults wipe | Defaults are target 18 / mode `off` (`lib/bedroom-heater-control.ts:60,161-163`), not 22 / auto. |
| A second Tuya bridge | One bridge process; `kogan-smarterhome-bridge.service` disabled/dead. |
| Retained MQTT command | Nothing retained on the heater's `/set` topic; only state/availability/discovery topics retain. |
| `/api/entity` `switch.turn_on` | No `entity-action` event for that entity since 2026-08-10. |
| Voice pipeline | `nova-voice.service` `ExecMainExitTimestamp = 2026-08-19 15:29:13 NZST` — dead five days before the incident. |
| Host/container restart | Host uptime 21 days; container up continuously across the whole window. |

### Not established

Which request wrote those four values. `/api/bedroom-heater` is the only live
writer remaining, and **it records nothing** — no log line, no dashboard event,
no caller identity. That silence is itself a defect and is fixed here.

## 2. The card may not display a state the server has not acknowledged

**Decision (Adeline, 2026-08-25): confirm before showing.**

The heater card is currently optimistic: `chooseMode` and `changeTarget` apply
local state before the network call resolves, `saveBedroomHeater`'s `fetch` has
no timeout, and both catch paths revert silently with no error surfaced. A POST
that hangs — a sleeping Tailscale link on the phone is the obvious way — leaves
the card reading "Off / 20" indefinitely while the server holds `auto / 22` and
the heater keeps cycling. The sync effect cannot correct it, because it only
re-seeds when the server value *changes*, and the server value never moved.

Required behaviour:

- Every heater save carries a **timeout of 8 seconds**. A save that does not
  complete in that window is treated as failed.
- Between the tap and the server's acknowledgement the control shows a
  **pending** state. It must be visually distinct from both the old and the new
  value — the user must be able to tell that nothing is confirmed yet.
- On success the card shows the server's value, not the locally chosen one.
- On failure or timeout the card **reverts to the last server-confirmed value
  and shows a visible error**. Silent reversion is not acceptable.
- Error presentation reuses the existing toast path already used by
  `onEntityActions` in the same file. No new notification mechanism.
- On success the card adopts the value from the **server's response body**
  (`/api/bedroom-heater` returns `{bedroomHeater}`), not the value that was
  tapped. The two agree on a normal save and diverge when the server clamps.
- **Last request wins, not last response.** Mode saves carry a monotonic
  sequence number; only the newest tap may write `mode`. Without it, two quick
  taps (Auto then Off) whose replies arrive out of order would leave the card
  showing Auto over a server holding Off — reintroducing the exact defect this
  section exists to remove.
- A save that times out is reported as **unconfirmed**, not as "nothing was
  changed": the request may well have reached the server. The card re-syncs
  rather than asserting either outcome.
- "Done" for this section: with the network blackholed mid-tap, the card ends
  up showing the server's real state and an error, never the tapped state.

## 3. A queued save may not outlive the page

The 2s debounce in `changeTarget` survives page suspension — iOS suspends a
standalone web app rather than unmounting it, so the cleanup effect never runs
and the pending timer fires on resume, potentially hours later, POSTing a stale
target over whatever the server holds by then.

Required behaviour:

- A pending debounced save is **discarded** when the page is hidden or frozen,
  not replayed on resume. Hook `visibilitychange` (and `pagehide`/`freeze`
  where available), not just unmount.
- `pagehide` gets its **own unconditional handler**. Gating it behind
  `visibilityState === "hidden"` makes it dead code on exactly the path it
  exists for — Safari can fire `pagehide` (bfcache, app quit) with no preceding
  visibility transition, and that is the suspension that strands a queued save.
- On resume the card re-syncs from the server rather than sending anything.
- A save is only ever sent as a direct consequence of a user gesture in the
  foreground.

## 4. Every heater write is attributable

**Decision (Adeline, 2026-08-25): log route, caller and payload.**

`/api/bedroom-heater` and `/api/climate-control` must emit a dashboard event
via `emitDashboardEvent`, matching the pattern `/api/entity` already uses
(`app/api/entity/route.ts:126-139`).

Each event records:

- the route that handled it,
- the **source IP and user agent** of the caller,
- the **exact payload** received,
- the resolved instance id and the resulting mode/target.

This flows to the existing NATS → VictoriaLogs → Grafana path. The purpose is
narrow and specific: the next time the heater changes on its own, the answer to
"what sent this" must be one query, not a day of forensics.

## 5. A generic switch toggle may not arm Auto

`lib/climate-control.ts:774-776` — `handleLegacyClimateAction`'s `turn_on`
branch sets `mode: "auto"` unconditionally for **any** caller that issues
`switch.turn_on` against an entity in `bedroomHeater.switchEntityIds`. A zone
"everything on" control, a scene, an MCP tool call, or anything else that
doesn't know the switch is climate-managed silently promotes the heater to Auto.

Required behaviour:

- A generic `switch.turn_on` energises the switch. It does **not** change the
  stored mode.
- Arming Auto requires an explicit climate intent — the heater card, or
  `/api/climate-control` with `mode: "auto"`.
- `turn_off` may continue to set `mode: "off"`: failing closed on a heater is
  safe, failing open is not.

## 6. Voice must not route the panel heater to the bedroom heater

`nova-voice/src/nova_voice/providers/nova/provider.py:45-53` maps
`panel_heater` → room `"bedroom"`. `app/api/climate-control/route.ts:13`
accepts `room` as `"lounge" | "bedroom"` and nothing else, and
`lib/climate-instances.ts:33` gives this household's only heater instance the
id `"bedroom"` — the **Tuya bedroom heater switch**. The Panel Heater is a
different physical device and is not a dashboard climate instance at all.

**Corrected 2026-08-25 after checking the call site.** The exploit path does
not exist today: `provider.py:1420` already excludes the panel heater from the
climate-intent branch —

```python
is_aircon = (target.domain or "").casefold() == "climate" and not _PANEL_HEATER_RE.search(target_text)
```

— so panel-heater commands go to `entity_action`, not `/api/climate-control`,
and `handleLegacyClimateAction` does not match them either (the panel heater is
not in `switchEntityIds`, and the `looksLikeAircon` regex does not match it).
The dashboard also reports the physical panel heater as dead since August 2026
(`ClimateControls.tsx:1489-1490`), its card off unless a unit is reinstated.

What remains is a **trap, not a live bug**: `logical_entity_room()` still
returns `"bedroom"` for `panel_heater`, and `room` is the entire routing key at
`app/api/climate-control/route.ts:13`. Any future caller that reuses that helper
without replicating the `is_aircon` guard drives the Tuya bedroom heater.

Required behaviour:

- `logical_entity_room()` carries an explicit warning that its `panel_heater` →
  `"bedroom"` result is an organisational room name, **not** a climate-instance
  id, and must not be fed to `/api/climate-control`.
- Server-side, `/api/climate-control` clamps `temperature` to the heater's
  `BEDROOM_HEATER_MIN_TARGET_C`..`MAX` range. The card clamped client-side; the
  endpoint did not, so any non-card caller could set an out-of-range target.
  **Done** — `app/api/climate-control/route.ts`.
- If a second heater is ever configured, routing moves to instance ids and an
  intent that cannot be resolved to a configured instance is rejected rather
  than applied to whatever shares the room name.

## 7. Out of scope

- The heater's clock schedule stays deleted. Nothing in this spec reintroduces
  a time-of-day trigger, and nothing may turn the heater on or off because a
  time of day arrived.
- The sleep timer (`offTimerEndsAt`) is unchanged — it is a deliberate user act
  and still fires server-side with every client asleep.
- The thermostat band, 10-minute min-cycle dwell and 2-minute sensor grace are
  unchanged.
