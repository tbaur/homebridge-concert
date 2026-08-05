# homebridge-concert

[![Tests](https://github.com/tbaur/homebridge-concert/actions/workflows/test.yml/badge.svg)](https://github.com/tbaur/homebridge-concert/actions/workflows/test.yml)
[![npm version](https://img.shields.io/npm/v/homebridge-concert?style=flat-square)](https://www.npmjs.com/package/homebridge-concert)
[![npm downloads](https://img.shields.io/npm/dt/homebridge-concert?label=downloads&style=flat-square)](https://www.npmjs.com/package/homebridge-concert)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-green)](https://nodejs.org)
[![verified-by-homebridge](https://img.shields.io/badge/homebridge-verified-blueviolet?color=%23491F59&style=flat)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
[![Homebridge](https://img.shields.io/badge/homebridge-%3E%3D1.6.0%20%7C%7C%202.x-purple)](https://homebridge.io)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

Control your **AudioControl Concert XR** receiver (e.g. XR-8S) in Apple HomeKit through Homebridge — power/standby, volume presets, and input/source presets as HomeKit Switches.

## Features

### Device Support
- **Power Switch** — On powers the zone; Off puts it into standby
- **Volume preset Switch** — On when volume equals a configured level (0–99); set On sets that level; set Off is a no-op
- **Source / input preset Switch** — On when the zone is on a configured input (e.g. CD); set On selects it; set Off is a no-op
- **Multi-accessory** — As many switches as you need on one receiver
- **Zone targeting** — Zone 1 (main) or Zone 2 per accessory
- **Accessory Information** — Manufacturer (AudioControl), model from config, the plugin version as firmware revision, and a stable auto-generated serial number

### Reliability
- **LAN IP control** — TCP port `50000`, AudioControl X/XR automation protocol
- **State polling** — Configurable interval (default 90s; below 5s falls back to 90s, above 86400s is clamped); power before volume/source; presets polled together so same-zone queries share one request; overlapping ticks coalesce; volume/source polls skip in standby
- **Serialized TCP** — One in-flight command at a time (short-lived sockets)
- **Bounded timeouts** — Connect/request timeouts; capped response buffers; every set bounded end to end, including post-ack verification
- **Answers HomeKit promptly** — A set replies inside HomeKit's ~9s write window and finishes a slow wake in the background, pushing the real value when it lands
- **Resilient polling** — One retry on silent power/volume/source queries; failures keep last known On; first warn, then debug until recovery
- **Backs off when unreachable** — After repeated failures, polling pauses instead of dialing an absent receiver every tick; HomeKit-initiated sets always still try
- **Wake-aware volume / source set** — Retries every 2s for up to 60s on not-ready errors so Shortcuts need no fixed Wait. HomeKit is answered immediately and the switch updates when the receiver accepts the command
- **Honest state** — A switch reports “No Response” until the receiver has actually been read, and again after repeated poll failures, rather than asserting a value it cannot confirm
- **Presets follow the receiver** — Volume/source presets report Off in standby; a successful set immediately re-reads the other switches so two levels or inputs are never both On
- **Startup validation** — Bad host/accessories is fatal; existing switches stay registered and report “No Response” so HomeKit keeps your rooms, scenes, and automations. Bad port/refreshRate warn and fall back/clamp

### Quality
- **Strict TypeScript** — `strict` mode
- **Tested** — Jest with ≥80% coverage gate
- **CI** — Build, lint (warnings are failures), type-check, test on Node 20/22/24; a job against the oldest supported Homebridge; dependency audit and OSV scanning
- **No Analytics** — Zero tracking or data collection

## Quick Start

### 1. Install

**Homebridge UI** (recommended): Plugins → Search `homebridge-concert` → Install

```bash
npm install -g homebridge-concert
```

### 2. Prepare the receiver

1. Set **Control** to **IP** (General Settings)
2. Set **Standby Mode** to **IP and HDMI ON**
3. Prefer a static IP / DHCP reservation

### 3. Configure

**Homebridge UI** (recommended): set **Host / IP Address**, add accessories (power, volume presets, source presets).

Or in `config.json`:

```json
{
  "platforms": [
    {
      "platform": "Concert",
      "name": "Concert",
      "host": "192.168.1.50",
      "port": 50000,
      "model": "AudioControl Concert XR-8S",
      "accessories": [
        {
          "type": "power",
          "name": "XR-8S Power",
          "zone": 1
        },
        {
          "type": "volumePreset",
          "name": "XR-8S Volume",
          "zone": 1,
          "volume": 57
        },
        {
          "type": "sourcePreset",
          "name": "XR-8S Source",
          "zone": 1,
          "source": "CD"
        }
      ],
      "options": {
        "refreshRate": 90
      }
    }
  ]
}
```

### 4. Restart Homebridge

Switches appear in the Home app after restart.

### Example: Apple Shortcuts

Typical listen shortcut:

1. If **XR-8S Power** is Off → turn On
2. If **XR-8S Source** is Off → turn On (selects CD; retries while waking)
3. If **XR-8S Volume** is Off → turn On (sets volume to 57; retries while waking)
4. Start your playlist on the source

Shutdown: turn **XR-8S Power** Off (standby).

### Example logs

```text
[Concert] Initializing Concert platform
[Concert] homebridge-concert v0.1.11 → 192.168.1.50:50000 (AudioControl Concert XR-8S)
[Concert] Registering accessory "XR-8S Power" (z1:power) at 192.168.1.50:50000
[Concert] Registering accessory "XR-8S Volume" (z1:vol:57) at 192.168.1.50:50000
[Concert] Registering accessory "XR-8S Source" (z1:src:cd) at 192.168.1.50:50000
[Concert] Polling accessory state every 90s
```

After a listen Shortcut:

```text
[Concert] XR-8S Power: ON
[Concert] XR-8S Source: SET CD
[Concert] XR-8S Volume: SET 57
```

External change (remote / front panel):

```text
[Concert] XR-8S Power: STANDBY (external)
[Concert] XR-8S Source: OFF (source BD, external)
```

## Supported Devices

| Type | Description |
|------|-------------|
| **AudioControl Concert XR** | XR-series with IP automation on TCP 50000 (tested: XR-8S) |

## Configuration Options

Only one `Concert` platform block is supported (`singular` in the Homebridge UI schema), so one receiver per Homebridge instance.

| Option | Required | Description |
|--------|:--------:|-------------|
| `name` | ✓ (UI) | Plugin instance name in the Homebridge log. Required by the Homebridge UI form; a hand-edited `config.json` that omits it falls back to `Concert` |
| `host` | ✓ | IP or hostname of the receiver |
| `accessories` | ✓ | Non-empty list of HomeKit switches |
| `port` | | TCP control port (default: 50000) |
| `model` | | Accessory Information model (default: `AudioControl Concert XR-8S`) |
| `options.refreshRate` | | Poll interval seconds (default: 90; below 5 falls back to 90, above 86400 is clamped) |

### `accessories[]` entries

| Field | Required | Description |
|-------|:--------:|-------------|
| `type` | ✓ | `power`, `volumePreset`, or `sourcePreset` |
| `name` | ✓ | HomeKit display name |
| `zone` | | `1` (main, default) or `2` |
| `volume` | for `volumePreset` | Absolute level `0`–`99` |
| `source` | for `sourcePreset` | `CD`, `BD`, `AV`, `SAT`, `PVR`, `UHD`, `AUX`, `DISPLAY`, `FM`, `DAB`, `NET`, `STB`, `GAME`, `BT` (case-insensitive; the Homebridge UI offers the uppercase form) |

Duplicate identity (same type + zone + volume/source) is rejected at startup. `DISPLAY` is Zone 1 only. Zone 2 can also report “follow Zone 1”, in which case the plugin resolves the effective input from Zone 1 automatically.

An accessory's identity is its type + zone + volume/source — deliberately *not* the receiver's address, so changing `host` or `port` (say, after a DHCP lease moves) keeps your existing switches intact. Upgrading from a version that did include the address is handled for you: existing switches are adopted rather than replaced, so rooms, scenes, and automations survive.

Changing a preset's `volume` or `source` does create a **new** HomeKit accessory and remove the old one, so it loses its room assignment, scenes, and automations. Rename freely — renaming is applied in place — but change preset values only when you are ready to re-add them in the Home app.

Serial numbers shown in Accessory Information are opaque values generated once per accessory and stored in the Homebridge accessory cache. Clearing that cache issues new ones.

## Not Working?

1. **Control** must be **IP** (not RS232)
2. **Standby Mode** must be **IP and HDMI ON**
3. Confirm host/port (`50000`) in the Network menu
4. Volume/source presets report Off while the receiver is in standby — power on first
5. Match `source` to the front-panel name (e.g. `CD`)
6. Restart Homebridge after config changes
7. All switches showing “No Response”? Check the log for `Invalid configuration; plugin will not start until it is corrected.` — the plugin stays inert until the reported problem is fixed, then recovers on the next restart with rooms and automations intact
8. Switches showing “No Response” right after a restart is normal until the first poll completes — the plugin reports unknown state rather than guessing
9. Polling goes quiet after repeated failures on purpose: it backs off rather than dialing an absent receiver every tick, and resumes as soon as one query or any HomeKit action succeeds

## Security

Talks only to the configured LAN IP — no cloud credentials. Anyone who can reach the receiver on your LAN can send the same commands; secure the Homebridge host. Prefer a static IP. Volume presets jump to an absolute level. See [`SECURITY.md`](SECURITY.md).

## Requirements

- Homebridge 1.6.0+ or 2.0+
- Node.js 20+ (Homebridge 2.x itself requires Node 22+, so the Node 20 floor applies to Homebridge 1.x hosts)
- An AudioControl Concert XR receiver with IP control enabled

## More Info

- [Features](https://github.com/tbaur/homebridge-concert/blob/main/docs/FEATURES.md)
- [Protocol reference](https://github.com/tbaur/homebridge-concert/blob/main/docs/PROTOCOL.md)
- [Development](https://github.com/tbaur/homebridge-concert/blob/main/DEVELOPMENT.md)
- [Report Issues](https://github.com/tbaur/homebridge-concert/issues)
- [Changelog](https://github.com/tbaur/homebridge-concert/blob/main/CHANGELOG.md)

## License

Copyright 2026 tbaur

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) file for details.
