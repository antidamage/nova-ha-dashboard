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

## Slow Sensor Behavior

The lounge temperature sensor updates slowly, so after Auto tails off and turns the unit off, the planner waits before starting again. It resumes when either:

- the measured sensor value changes and is outside the target band
- the selected target temperature changes and the current reading is outside the new target band

The target-temperature condition is important. Without it, changing from a cold target to a warm target, or the reverse, can be ignored until the sensor refreshes.

## Changing This Code

Before changing Auto behavior:

1. Update or add a case in `lib/aircon-control.test.ts`.
2. Run `npm run test:aircon`.
3. Run `npm run build`.
4. Check that heat/cool actions include both `set_hvac_mode` and a `set_temperature` payload with the same `hvac_mode` when the mode changes.
