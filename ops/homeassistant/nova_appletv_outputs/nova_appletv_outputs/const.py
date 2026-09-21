"""Names and vocabulary this bridge publishes.

The vocabulary is the contract with the dashboard: `on` and `off` are the
states `power.ampPowerControl.audioOutput.onStates` and `.offStates` name, and
anything else — `unavailable` included — is "no opinion" there, so it can never
switch the amplifier off (specs/amp-appletv-power.md §8.3).
"""

DOMAIN = "nova_appletv_outputs"

APPLE_TV_DOMAIN = "apple_tv"

# The built-in integration's own dispatcher signals, sent with the live pyatv
# object: homeassistant/components/apple_tv/const.py.
SIGNAL_CONNECTED = "apple_tv_connected"
SIGNAL_DISCONNECTED = "apple_tv_disconnected"

# Seconds between reads of the live connection's output list. The list arrives
# on pyatv's own device-info push, so this only has to catch a connection that
# came up without a dispatch — and it never attaches a listener, because that
# slot is Home Assistant's media player's, not this bridge's.
POLL_SECONDS = 15

STATE_ON = "on"
STATE_OFF = "off"
STATE_READ_UNAVAILABLE = "unavailable"
STATE_READ_UNKNOWN = "unknown"

# Suffixes, so the two published states read as one pair.
TV_SPEAKERS_SUFFIX = "tv_speakers"
AUDIO_OUTPUT_SUFFIX = "audio_output"

# The domain each suffix is published under.
ENTITY_DOMAINS = {TV_SPEAKERS_SUFFIX: "binary_sensor", AUDIO_OUTPUT_SUFFIX: "sensor"}

# tvOS labels the Apple TV's own local output "TV Speakers", and it is the name
# Adeline used when she asked for this. The identifier match is the primary one
# (the Apple TV reports the local output as itself); this label is matched as a
# second name for the same thing, and a household that sees a different spelling
# adds it to `tv_speakers_names` rather than waiting for a code change.
DEFAULT_TV_SPEAKERS_NAMES = ("tv speakers",)

# Configuration key, a bare `nova_appletv_outputs:` otherwise.
CONF_TV_SPEAKERS_NAMES = "tv_speakers_names"
