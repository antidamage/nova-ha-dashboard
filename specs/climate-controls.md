# Climate Controls

Climate controls are composed from entities detected in the selected climate
zone.

Recognized lounge aircon components:

- Main climate entity.
- Fresh air switch.
- Quiet mode switch.
- Turbo mode switch.

Recognized panel heater components:

- Main climate entity.

Panel heater UI:

- Target temperature stepper.
- Power state buttons: On, Off.
- Off timer row using the configured climate off-timer increment.
- Current source code uses whole-degree target steps.
- Temperature and timer controls are enabled only when the heater is on.
- The timer counts down in real time, can be cleared from the timer row, and
  turns the panel heater off when it expires.
- Timer state is persisted in dashboard preferences as
  `panelHeater.offTimerEndsAt`.

Air conditioner UI:

- Target temperature stepper.
- Power state buttons: Auto, Manual, Off.
- Off timer row using the configured climate off-timer increment.
- Manual HVAC mode buttons: Heat, Cool, Fan.
- Current source code uses whole-degree target steps.
- Fan speed control across quiet, low, medium low, medium, medium high, high,
  and turbo. The fan speed slider previews the step locally while dragging and
  sends the command only when the slider is released.
- Fresh air switch.
- The timer counts down in real time, can be cleared from the timer row, and
  turns the air conditioner off when it expires.
- Quiet and turbo fan endpoints coordinate with dedicated quiet/turbo switches.
- Manual turn-on reapplies remembered mode, temperature, fan, quiet/turbo, and
  fresh air preferences where available.
