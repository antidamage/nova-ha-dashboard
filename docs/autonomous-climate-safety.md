# Nova climate safety and ownership

`lib/climate-control.ts` is the only active thermostat loop. It runs in the
Next.js server, so closing a browser or sleeping the kiosk does not stop room
control. The former browser Auto hook, stale-input watchdog, and separate
Bedroom loop were removed.

## Missing temperature

Auto may be selected before a sensor report exists. Lounge starts only in its
remembered direction; Bedroom may heat blind. If a usable reading still has
not arrived after two minutes, the controller turns the actuator off, clears
Auto and its timer, records `sensor-timeout`, and does not retry. A later user
selection or eligible Bedroom schedule edge may start a new session.

The Bedroom puck is the sole Bedroom control source. The plug's onboard
temperature is never a fallback. Missing, nonnumeric, `unknown`, `unavailable`,
or older-than-30-minute data is not usable.

## Device ownership

Nova persists the last observed actuator fingerprint and compares power, HVAC
mode, target, fan, and accessory states on every tick. Temperature and report
timestamps are excluded. Nova commands are correlated inside a bounded settle
window and the actuator is re-read before every autonomous command.

An unmatched physical-remote, Tuya-app, or direct-Home-Assistant change sets
the room owner to `external`. Nova sends no corrective command, cancels its
authority, and suppresses Bedroom schedule edges. The dashboard shows Manual
and a device-override warning. Only an explicit Nova Auto, Manual/direction, or
Off selection reclaims the room; editing a target or schedule alone does not.

Actuator unavailability is a fault, not an external interaction. It blocks
commands without rewriting the user's selected mode.

## Hardware guards

Stopping at target is immediate. Starts retain the 10-minute off-dwell and the
Lounge three-starts-per-hour cap. Auto retains its 30-minute direction hold.
A setpoint edit reopens the comfort decision but never erases hardware history
or permits a direct heat-to-cool reversal.
