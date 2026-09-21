#!/usr/bin/env bash
# Install the Nova Apple TV audio-outputs bridge into Home Assistant.
#
# Copies the component into HA's config directory and checks that it imports
# inside the HA container. It deliberately does NOT edit configuration.yaml and
# does NOT restart Home Assistant: the one-line key and the restart are a
# visible step, and a half-installed component that has already restarted HA is
# harder to reason about than one that has not. See README.md.
#
#   sudo ops/homeassistant/nova_appletv_outputs/install.sh [config dir]
set -euo pipefail

CONFIG_DIR="${1:-/var/lib/homectrl/homeassistant/config}"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPONENT_DIR="$CONFIG_DIR/custom_components"
TARGET="$COMPONENT_DIR/nova_appletv_outputs"

if [ ! -d "$CONFIG_DIR" ]; then
    echo "No Home Assistant config directory at $CONFIG_DIR" >&2
    exit 1
fi
if [ ! -d "$COMPONENT_DIR" ]; then
    echo "No custom_components directory under $CONFIG_DIR" >&2
    exit 1
fi

# Refuse a target outside the config directory: this script removes what it is
# about to replace, so the path is checked rather than trusted.
case "$TARGET" in
    "$COMPONENT_DIR"/*) ;;
    *)
        echo "Refusing to replace $TARGET" >&2
        exit 1
        ;;
esac

rm -rf "$TARGET"
mkdir -p "$TARGET"
cp -a "$SOURCE_DIR/nova_appletv_outputs/." "$TARGET/"
find "$TARGET" -name '__pycache__' -type d -prune -exec rm -rf {} +

echo "Installed $TARGET"

if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -qx homeassistant; then
    # An import inside the running container is the pre-flight the restart
    # deserves: it fails loudly here rather than silently in HA's log. The tests
    # run in the installed copy, not the repo's — the copy is what will load.
    docker exec homeassistant python3 -c "
import sys
sys.path.insert(0, '/config/custom_components')
import nova_appletv_outputs
print('imports inside Home Assistant:', nova_appletv_outputs.DOMAIN)
"
    docker exec homeassistant python3 -m unittest discover -s /config/custom_components/nova_appletv_outputs/tests
fi

echo
echo "Next, both deliberate:"
echo "  1. add 'nova_appletv_outputs:' to $CONFIG_DIR/configuration.yaml"
echo "  2. restart Home Assistant"
