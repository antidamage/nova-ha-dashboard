# Lounge climate control

Nova controls the Gree through one server thermostat. `Auto` chooses heat or
cool; `Manual` is a fixed-direction thermostat; `Off` relinquishes Nova output.
The Gree's own `current_temperature` remains the permanent Lounge source.

The sensor is noisy because it sits in the indoor unit. Nova therefore uses
the fresh raw value for conservative stopping and the median of the five most
recent fresh reports for starts and Auto direction selection.

- Heat stops immediately at or above target.
- Cool stops immediately at or below target.
- Manual later resumes only its selected direction after a 3 °C drift.
- Auto may choose a direction only while resting.
- Fan-only Manual is continuous and sensor-independent.
- Starts observe a 10-minute off-dwell and three-starts-per-hour cap.
- Auto direction changes observe a 30-minute hold.
- No guard may delay a stop or permit direct heat↔cool reversal.

Auto may wait two minutes for a usable temperature. Timeout turns the unit off,
clears Auto, and requires a later Nova action. It does not retry forever.

The public contract is `POST /api/climate-control`; current ownership, phase,
direction, sensor report time, grace deadline, and stop reason are returned as
`climateControl.lounge` from `/api/state`. Legacy `/api/entity` and timer calls
are compatibility adapters through the same controller.

Run `npm run test:aircon`, `npm run test:unit`, and `npm run build` after any
behavioral change.
