# Features

**homebridge-concert**

## Core Features

- ✅ Multi-accessory platform: configure one or more HomeKit Switches per receiver
- ✅ Power on / standby (`type: power`)
- ✅ Volume preset Switch (`type: volumePreset`) — On when volume equals a configured 0–99 level; set On sets that level (retries politely for up to 60s while waking; not-ready log after 30s); set Off is a no-op
- ✅ Per-accessory zone targeting (Zone 1 or Zone 2)
- ✅ LAN IP control over TCP port 50000 (AudioControl X/XR automation protocol)
- ✅ Configurable state polling (90s default, 5s–86400s clamp)
- ✅ Bounded connect and request timeouts with a capped response buffer
- ✅ Short-lived TCP connections per command (no sticky idle sockets)
- ✅ Serialized TCP commands (one in-flight socket) so standby does not see overlapping sessions
- ✅ Startup config validation (fatal host/accessories errors; warn-and-default for port/refreshRate)
- ✅ Stale-accessory cleanup when accessories are removed or identity changes; cached accessories cleared on invalid config
- ✅ Set/poll race protection and single-flight refresh per accessory
- ✅ Sequential poll ticks (power before volume); overlapping ticks coalesce; volume polls skip while the zone is last known standby
- ✅ Poll failures keep last known On (volume matches power); no fake “(external)” flip on timeout recover
- ✅ One automatic retry on transient power-query timeouts
- ✅ Quiet consecutive poll failures after the first warn
- ✅ Homebridge UI settings form via `config.schema.json`
- ✅ Homebridge v1.6.0+ and v2.0+ support
- ✅ Node.js 20+ support

## Supported Devices

| Type | HomeKit services |
|------|------------------|
| **AudioControl Concert XR** (e.g. XR-8S) | Switch (power), Switch (volume preset) |

## Protocol surface

Full automation command catalog (including capabilities not yet exposed in HomeKit): [PROTOCOL.md](PROTOCOL.md).

## Architecture

See [DEVELOPMENT.md](../DEVELOPMENT.md) for the source layout and design principles.
