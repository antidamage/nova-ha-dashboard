# Lounge climate control

Nova controls the Gree through one server thermostat. `Auto` chooses heat or
cool; `Manual` is a fixed-direction thermostat; `Off` relinquishes Nova output.
The Gree's own `current_temperature` remains the permanent Lounge source.

The sensor is noisy because it sits in the indoor unit. Nova therefore uses
the fresh raw value for conservative stopping and the median of the five most
recent fresh reports for starts and Auto direction selection.

- Heat stops immediately at or above target.
- Cool stops immediately at or below target.
- At shutdown Nova records the reading and original Heat/Cool direction.
- After the 10-minute compressor dwell, Nova may resume that same direction
  early when the reading has moved in the expected direction and a first-order
  extrapolation says the unchanged target will still be missed. The displayed
  one-degree restart threshold is retained; the extrapolation tests the least
  favourable temperatures within both readings' +/-0.5 C quantisation bands.
- Flat, opposite, missing, or otherwise ambiguous traces wait for the
  conservative 30-minute settling fallback.
- Auto may choose a direction only while resting.
- Fan-only Manual is continuous and sensor-independent.
- Every start still observes the 10-minute compressor off-dwell.
- Heating and cooling have no starts-per-hour cap.
- Auto direction changes observe a 30-minute hold and require a 3 C error.
- No guard may delay a stop or permit a direct heat-to-cool reversal.

The predictor uses a 10-minute time constant. Home Assistant history across the
recent Heat shutdowns shows the first whole-degree correction after 2-11
minutes (median about 6.5) and the second after 6-30 minutes (median about
15.5). Hayashi et al. measured low-airflow time constants of roughly 9-11
minutes for common enclosed HVAC room sensors (DOI 10.18948/shase.27.84_31).
The model is the standard first-order thermal response and solves it for the
eventual equilibrium. Thirty minutes remains the fallback because a first-order
sensor is approximately 95% settled after three time constants.

The estimate never changes the requested temperature. It only answers whether
the sensor's projected equilibrium still misses that same target badly enough
to resume the original Heat or Cool cycle.

Auto may wait two minutes for a usable temperature. Timeout turns the unit off,
clears Auto, and requires a later Nova action. It does not retry forever.

The public contract is `POST /api/climate-control`; current ownership, phase,
direction, sensor report time, grace deadline, and stop reason are returned as
`climateControl.lounge` from `/api/state`. Legacy `/api/entity` and timer calls
are compatibility adapters through the same controller.

Run `npm run test:aircon`, `npm run test:unit`, and `npm run build` after any
behavioral change.
