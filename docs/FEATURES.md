# Features

**homebridge-concert**

## Core Features

- ✅ Power on / standby exposed as a HomeKit Switch
- ✅ Zone 1 (main) or Zone 2 targeting
- ✅ LAN IP control over TCP port 50000 (AudioControl X/XR automation protocol)
- ✅ Configurable power-state polling (90s default, 5s–86400s clamp)
- ✅ Bounded connect and request timeouts with a capped response buffer
- ✅ Short-lived TCP connections per command (no sticky idle sockets)
- ✅ Startup config validation (fatal host errors; warn-and-default for port/zone/refreshRate)
- ✅ Stale-accessory cleanup when host/port/zone changes; cached accessories cleared on invalid config
- ✅ Set/poll race protection and single-flight refresh
- ✅ Quiet consecutive poll failures after the first warn
- ✅ Homebridge UI settings form via `config.schema.json`
- ✅ Homebridge v1.6.0+ and v2.0+ support
- ✅ Node.js 20+ support

## Supported Devices

| Type | HomeKit services |
|------|------------------|
| **AudioControl Concert XR** (e.g. XR-8S) | Switch (power) |

## Architecture

See [DEVELOPMENT.md](../DEVELOPMENT.md) for the source layout and design principles.
