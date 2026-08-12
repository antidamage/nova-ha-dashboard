# Lounge climate control

Nova controls the Gree through one server thermostat. `Auto` chooses heat or
cool; `Manual` is a fixed-direction thermostat; `Off` relinquishes Nova output.
The Gree's own `current_temperature` remains the permanent Lounge source.

The sensor is noisy because it sits in the indoor unit. Nova therefore uses
the fresh raw value for conservative stopping and the median of the five most
recent fresh reports for starts and Auto direction selection.

- Heat stops immediately at or above target.
- Cool stops immediately at or below target.
- A stopped unit waits 30 minutes for its low-airflow sensor to settle.
- Heat then resumes heat, and Cool resumes cool, on the first whole-degree
  error (the sensor reports only whole degrees).
- Auto may choose a direction only while resting.
- Fan-only Manual is continuous and sensor-independent.
- Starts still observe a 10-minute compressor off-dwell, including explicit
  user requests made before the longer sensor-settling window expires.
- Heating and cooling have no starts-per-hour cap. The 30-minute sensor gate
  bounds autonomous cycling without delaying later valid calls for the same
  direction.
- Auto direction changes observe a 30-minute hold and require a 3 C error.
- No guard may delay a stop or permit a direct heat-to-cool reversal.

The 30-minute estimate is based on both this unit and published sensor physics.
Home Assistant history on 2026-08-11 shows the Gree reading still moving 14-21
minutes after heat stopped. Hayashi et al. measured low-airflow cooling time
constants of roughly 9-11 minutes for common enclosed HVAC room sensors
(DOI 10.18948/shase.27.84_31); a first-order sensor is approximately 95%
settled after three time constants. Thirty minutes is therefore conservative
without retaining the former 1-3 hour comfort lockout.

Auto may wait two minutes for a usable temperature. Timeout turns the unit off,
clears Auto, and requires a later Nova action. It does not retry forever.

The public contract is `POST /api/climate-control`; current ownership, phase,
direction, sensor report time, grace deadline, and stop reason are returned as
`climateControl.lounge` from `/api/state`. Legacy `/api/entity` and timer calls
are compatibility adapters through the same controller.

Run `npm run test:aircon`, `npm run test:unit`, and `npm run build` after any
behavioral change.
