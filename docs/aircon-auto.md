# Dashboard Air-Con Auto

Nova dashboard Auto is a dashboard-managed thermostat loop, not the Gree or Home Assistant HVAC `auto` mode.

## Rule That Must Not Change

The planner uses this signed delta:

```text
delta = measuredRoomTemperature - selectedTargetTemperature
```

If `delta > 0`, the room is hotter than the target and the action must be `cool`.
If `delta < 0`, the room is colder than the target and the action must be `heat`.

This rule is covered by `npm run test:aircon`.

## Ownership

`lib/aircon-control.ts` owns:

- climate temperature parsing
- dashboard Auto state
- heat/cool choice
- fan step mapping
- quiet and turbo switch actions
- Home Assistant action payloads

`app/components/Dashboard.tsx` should only render controls, pass current entities/preferences into the planner, and apply the returned actions.

## Idle Behavior

When the room reaches the target band, Auto does **not** switch the unit off. It parks the aircon on `fan_only` at the lowest fan speed. This keeps the dashboard's off state unambiguous: the unit only ever reads off when the user (or Home Assistant) actually turned it off, never as a side effect of Auto reaching the setpoint. The fan-idle actions are idempotent — once the unit is already idling, the planner returns no actions, so the 1s loop does not keep re-sending commands.

## Slow Sensor Behavior

Auto measures with the aircon's own temperature sensor. That reading updates slowly, so after Auto parks the unit on fan idle, the planner waits before starting active heating/cooling again. It resumes when either:

- the measured sensor value changes and is outside the target band
- the selected target temperature changes and the current reading is outside the new target band

The target-temperature condition is important. Without it, changing from a cold target to a warm target, or the reverse, can be ignored until the sensor refreshes.

## Changing This Code

Before changing Auto behavior:

1. Update or add a case in `lib/aircon-control.test.ts`.
2. Run `npm run test:aircon`.
3. Run `npm run build`.
4. Check that heat/cool actions include both `set_hvac_mode` and a `set_temperature` payload with the same `hvac_mode` when the mode changes.
