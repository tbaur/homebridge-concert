# homebridge-concert

[![Tests](https://github.com/tbaur/homebridge-concert/actions/workflows/test.yml/badge.svg)](https://github.com/tbaur/homebridge-concert/actions/workflows/test.yml)
[![npm version](https://img.shields.io/npm/v/homebridge-concert?style=flat-square)](https://www.npmjs.com/package/homebridge-concert)
[![npm downloads](https://img.shields.io/npm/dt/homebridge-concert?label=downloads&style=flat-square)](https://www.npmjs.com/package/homebridge-concert)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-green)](https://nodejs.org)
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
- **Accessory Information** — Manufacturer, model, and serial from config

### Reliability
- **LAN IP control** — TCP port `50000`, AudioControl X/XR automation protocol
- **State polling** — Configurable interval (default 90s, 5s–86400s); power before volume/source; overlapping ticks coalesce; volume/source polls skip in standby
- **Serialized TCP** — One in-flight command at a time (short-lived sockets)
- **Bounded timeouts** — Connect/request timeouts; capped response buffers
- **Resilient polling** — One retry on silent power queries; failures keep last known On; first warn, then debug until recovery
- **Wake-aware volume / source set** — Retries every 2s for up to 60s on not-ready errors so Shortcuts need no fixed Wait; “not ready” log deferred 30s
- **Startup validation** — Bad host/accessories is fatal (clears cached accessories); bad port/refreshRate warn and fall back/clamp

### Quality
- **Strict TypeScript** — `strict` mode
- **Tested** — Jest with ≥80% coverage gate
- **CI** — Build, lint, test on Node 20/22/24; dependency audit
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
          "name": "XR-8S CD",
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
2. If **XR-8S CD** is Off → turn On (selects CD; retries while waking)
3. If **XR-8S Volume** is Off → turn On (sets volume to 57; retries while waking)
4. Start your playlist

Shutdown: turn **XR-8S Power** Off (standby).

### Example logs

```text
[Concert] Registering accessory "XR-8S Power" (z1:power) at 192.168.1.50:50000
[Concert] Registering accessory "XR-8S Volume" (z1:vol:57) at 192.168.1.50:50000
[Concert] Registering accessory "XR-8S CD" (z1:src:cd) at 192.168.1.50:50000
[Concert] Polling accessory state every 90s
```

After a listen Shortcut:

```text
[Concert] XR-8S Power: ON
[Concert] XR-8S CD: SET CD
[Concert] XR-8S Volume: SET 57
```

External change (remote / front panel):

```text
[Concert] XR-8S Power: STANDBY (external)
[Concert] XR-8S CD: OFF (source BD, external)
```

## Supported Devices

| Type | Description |
|------|-------------|
| **AudioControl Concert XR** | XR-series with IP automation on TCP 50000 (tested: XR-8S) |

## Configuration Options

| Option | Required | Description |
|--------|:--------:|-------------|
| `name` | ✓ | Plugin instance name in the Homebridge log |
| `host` | ✓ | IP or hostname of the receiver |
| `accessories` | ✓ | Non-empty list of HomeKit switches |
| `port` | | TCP control port (default: 50000) |
| `model` | | Accessory Information model (default: `AudioControl Concert XR-8S`) |
| `options.refreshRate` | | Poll interval seconds (default: 90, min: 5, max: 86400) |

### `accessories[]` entries

| Field | Required | Description |
|-------|:--------:|-------------|
| `type` | ✓ | `power`, `volumePreset`, or `sourcePreset` |
| `name` | ✓ | HomeKit display name |
| `zone` | | `1` (main, default) or `2` |
| `volume` | for `volumePreset` | Absolute level `0`–`99` |
| `source` | for `sourcePreset` | `CD`, `BD`, `AV`, `SAT`, `PVR`, `UHD`, `AUX`, `DISPLAY`, `FM`, `DAB`, `NET`, `STB`, `GAME`, `BT` |

Duplicate identity (same type + zone + volume/source) is rejected at startup. `DISPLAY` is Zone 1 only.

## Not Working?

1. **Control** must be **IP** (not RS232)
2. **Standby Mode** must be **IP and HDMI ON**
3. Confirm host/port (`50000`) in the Network menu
4. Volume/source presets may stay Off in standby — power on first
5. Match `source` to the front-panel name (e.g. `CD`)
6. Restart Homebridge after config changes

## Security

Talks only to the configured LAN IP — no cloud credentials. Anyone who can reach the receiver on your LAN can send the same commands; secure the Homebridge host. Prefer a static IP. Volume presets jump to an absolute level. See [`SECURITY.md`](SECURITY.md).

## Requirements

- Homebridge 1.6.0+ or 2.0+
- Node.js 20+
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
