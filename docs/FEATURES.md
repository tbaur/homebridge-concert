# Features

**homebridge-concert**

## Core Features

- ✅ Multi-accessory platform: configure one or more HomeKit Switches per receiver
- ✅ Power on / standby (`type: power`)
- ✅ Volume preset Switch (`type: volumePreset`) — On when volume equals a configured 0–99 level; set On sets that level (retries politely for up to 60s while waking; not-ready log after 30s); set Off is a no-op
- ✅ Source / input preset Switch (`type: sourcePreset`) — On when the zone is on a configured input (e.g. CD); set On selects that input via RC5 (same wake retries as volume); set Off is a no-op
- ✅ Per-accessory zone targeting (Zone 1 or Zone 2), including transparent resolution of Zone 2 "follow Zone 1"
- ✅ LAN IP control over TCP port 50000 (AudioControl X/XR automation protocol)
- ✅ Configurable state polling (90s default; below 5s falls back to the default, above 86400s is clamped)
- ✅ Bounded connect and request timeouts with a capped response buffer
- ✅ Whole-operation timeout budget on every set, covering post-ack verification
- ✅ Sets answer inside HomeKit's ~9s write window and finish a slow wake in the background, pushing the real value when it lands
- ✅ A set is only treated as confirmed by a reply that agrees with it, never by answer code alone
- ✅ Short-lived TCP connections per command (no sticky idle sockets)
- ✅ Serialized TCP commands (one in-flight socket) so standby does not see overlapping sessions
- ✅ Startup config validation (fatal host/accessories errors; warn-and-default for port/refreshRate)
- ✅ Stale-accessory cleanup when accessories are removed or identity changes; cached accessories are kept registered on invalid config so HomeKit rooms, scenes, and automations survive a typo
- ✅ Accessory identity is independent of the receiver's address, so an IP change keeps your switches; accessories cached under the older address-based identity are adopted on upgrade rather than replaced
- ✅ Set/poll race protection and single-flight refresh per accessory
- ✅ Power polled before volume/source; presets polled together so same-zone queries share one request; overlapping ticks coalesce; volume and source polls skip while the zone is last known standby
- ✅ Poll failures keep last known On (volume and source match power); no fake “(external)” flip on timeout recover
- ✅ One automatic retry on transient power-, volume-, and source-query timeouts
- ✅ Circuit breaker pauses polling of an unreachable receiver, escalating per cool-off rather than per query; HomeKit-initiated sets always still try
- ✅ A refused or unresolvable host fails fast instead of consuming the wake-retry window
- ✅ Reports HomeKit “No Response” until real state has been observed, and again after repeated poll failures, instead of asserting an unconfirmed value
- ✅ Presets report Off while the zone is in standby, and a successful set re-reads sibling switches so two levels or inputs are never both On
- ✅ A HomeKit On write is only skipped as redundant while the cached reading is still fresh
- ✅ Quiet consecutive poll failures after the first warn
- ✅ Clean shutdown: in-flight requests fail immediately rather than running out their timeouts
- ✅ Homebridge UI settings form via `config.schema.json`
- ✅ Homebridge v1.6.0+ and v2.0+ support
- ✅ Node.js 20+ support

## Supported Devices

| Type | HomeKit services |
|------|------------------|
| **AudioControl Concert XR** (e.g. XR-8S) | Switch (power), Switch (volume preset), Switch (source preset) |

## Protocol surface

Full automation command catalog (including capabilities not yet exposed in HomeKit): [PROTOCOL.md](PROTOCOL.md).

## Architecture

See [DEVELOPMENT.md](../DEVELOPMENT.md) for the source layout and design principles.
