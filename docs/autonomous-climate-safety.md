# Autonomous climate input safety

This is a non-negotiable rule for every Nova-controlled heating or cooling
device:

> Auto mode cannot start or continue without a fresh, real input from the
> temperature source assigned to that controller.

An input is usable only when it is numeric, its source is available, and its
newest Home Assistant report timestamp is no more than 30 minutes old. Missing
timestamps, empty values, invalid values, `unknown`, `unavailable`, and readings
older than 30 minutes all fail closed.

On failure, the controller must:

1. attempt to turn the heating or cooling output off;
2. persist Auto as off and clear any pending off timer;
3. display the measured room temperature as `--`;
4. disable the Auto control while input remains unusable; and
5. reject stale clients and direct API requests that try to arm Auto.

Fresh telemetry only removes the lockout. It must not silently restore the old
Auto session; a person or a later valid schedule edge must choose Auto again.

This input interlock is distinct from behavioural guards. Any explicit user
setpoint change clears Auto's direction hold, compressor dwell, and hourly-start
history, allowing the next decision to swap heating and cooling immediately.
Changing a setpoint cannot clear the input interlock because it does not create
a temperature measurement.

The shared validator is `lib/autonomous-climate-safety.ts`. The Bedroom heater
enforces it in its server thermostat and API. Lounge/Gree enforces it in the
browser controller, the generic climate action boundary, and a server watchdog
that remains active when dashboard browsers are hidden or closed.
