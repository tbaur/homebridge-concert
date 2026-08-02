# homebridge-concert

[![Tests](https://github.com/tbaur/homebridge-concert/actions/workflows/test.yml/badge.svg)](https://github.com/tbaur/homebridge-concert/actions/workflows/test.yml)
[![npm version](https://img.shields.io/npm/v/homebridge-concert?style=flat-square)](https://www.npmjs.com/package/homebridge-concert)
[![npm downloads](https://img.shields.io/npm/dt/homebridge-concert?label=downloads&style=flat-square)](https://www.npmjs.com/package/homebridge-concert)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-green)](https://nodejs.org)
[![Homebridge](https://img.shields.io/badge/homebridge-%3E%3D1.6.0%20%7C%7C%202.x-purple)](https://homebridge.io)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

Control your **AudioControl Concert XR** receiver (e.g. XR-8S) in Apple HomeKit through Homebridge — power/standby and volume presets as HomeKit Switches.

## Features

### Device Support
- **Power Switch** — On powers the zone; Off puts it into standby
- **Volume preset Switch** — On when the zone volume equals a configured level (0–99); turning On sets that level; turning Off does nothing (Off only means “not at this level”)
- **Multi-accessory config** — Expose as many switches as you need on one receiver
- **Zone targeting** — Each accessory can target Zone 1 (main) or Zone 2
- **Accessory Information** — Manufacturer, model, and serial derived from your config

### Reliability
- **LAN IP control** — Talks to the unit over TCP port `50000` using the AudioControl X/XR automation protocol
- **State polling** — Refreshes accessory state on a configurable interval (default every 90s; clamped 5s–86400s)
- **Bounded timeouts** — Connect and request timeouts so a stalled receiver cannot hang Homebridge; response buffers are capped
- **Resilient polling** — One automatic retry on a silent/timed-out power query; the first poll failure warns briefly, then further failures demote to debug until recovery
- **Wake-aware volume set** — Volume-preset On retries every 2s for up to 60s on not-ready errors (`0x85` / timeouts), so Shortcuts can set volume after power-on without a fixed Wait. A “device is not ready” info log is deferred until 30s so a normal ~20s XR wake stays quiet
- **Startup config validation** — Missing/invalid host or accessories is fatal (cached accessories are cleared); out-of-range port/refreshRate warn and fall back/clamp

### Quality
- **Strict TypeScript** — `strict` mode (`noImplicitAny`, `strictNullChecks`, no unused locals/params, no implicit returns, and more)
- **Tested Core** — Jest suite with a ≥80% coverage gate across statements, branches, functions, and lines
- **CI on Every PR** — Build, lint, and test across Node 20/22/24, plus a dependency audit
- **No Analytics** — Zero tracking or data collection

## Quick Start

### 1. Install

**Homebridge UI** (recommended): Plugins → Search `homebridge-concert` → Install

**Command line:**
```bash
npm install -g homebridge-concert
```

### 2. Prepare the receiver

On the AudioControl unit:

1. Set **Control** to **IP** (General Settings)
2. Set **Standby Mode** to **IP and HDMI ON** (so the unit stays reachable while in standby)
3. Prefer a static IP / DHCP reservation

### 3. Configure

**Homebridge UI** (recommended): open this plugin's settings, set **Host / IP Address**, and add accessories (power and optional volume presets).

Or add the platform to your `config.json`:

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
2. Wait a few seconds for wake
3. If **XR-8S Volume** is Off → turn On (sets volume to 57)
4. Start your playlist

Shutdown shortcut: turn **XR-8S Power** Off (standby).

### Example logs

With the config above (host `192.168.1.50`), Homebridge looks like:

```text
[Concert] Initializing Concert platform
[Concert] Registering accessory "XR-8S Power" (z1:power) at 192.168.1.50:50000
[Concert] Registering accessory "XR-8S Volume" (z1:vol:57) at 192.168.1.50:50000
[Concert] Polling accessory state every 90s
[Concert] XR-8S Power: STANDBY (external)
[Concert] XR-8S Volume: poll failed: Timed out waiting for response
```

After a listen Shortcut (power on, then set volume 57):

```text
[Concert] XR-8S Power: ON
[Concert] XR-8S Volume: SET 57
```

External changes (remote / front panel):

```text
[Concert] XR-8S Power: STANDBY (external)
[Concert] XR-8S Volume: OFF (level 40, external)
```

Poll recovery after the receiver was unreachable:

```text
[Concert] XR-8S Power: poll recovered
[Concert] XR-8S Volume: poll recovered
[Concert] XR-8S Volume: ON (level 57, external)
```

Set failures:

```text
[Concert] XR-8S Power: set failed: Timed out waiting for response
[Concert] XR-8S Volume: set failed: volume set rejected: 0x85 (invalid command in current state)
```

## Supported Devices

| Type | Description |
|------|-------------|
| **AudioControl Concert XR** | Concert XR-series receivers/processors with IP automation control on TCP port 50000 (tested target: XR-8S) |

## Configuration Options

| Option | Required | Description |
|--------|:--------:|-------------|
| `name` | ✓ | Plugin instance name shown in the Homebridge log |
| `host` | ✓ | IP address or hostname of the receiver |
| `accessories` | ✓ | Non-empty list of HomeKit switches (see below) |
| `port` | | TCP control port (default: 50000) |
| `model` | | Model shown in Accessory Information (default: `AudioControl Concert XR-8S`) |
| `options.refreshRate` | | Seconds between state polls (default: 90, minimum: 5, maximum: 86400). Below-minimum / non-numeric values fall back to the default; above-maximum values are clamped. |

### `accessories[]` entries

| Field | Required | Description |
|-------|:--------:|-------------|
| `type` | ✓ | `power` or `volumePreset` |
| `name` | ✓ | HomeKit display name |
| `zone` | | `1` (main, default) or `2` |
| `volume` | for `volumePreset` | Absolute level `0`–`99` |

Duplicate identity (same type + zone + volume) is rejected at startup.

## Not Working?

1. **Check Control mode** — General Settings → Control must be **IP** (not RS232)
2. **Check Standby Mode** — Must be **IP and HDMI ON**, or the unit will not answer while in standby
3. **Check host/port** — Confirm the IP in the receiver's Network menu; control is on port `50000`
4. **Volume preset stays Off** — Volume query may fail while the unit is in standby; power on first
5. **Restart Homebridge** — Required after any config change

## Security

This plugin talks only to the LAN IP you configure. It stores no cloud credentials — only the host/port and accessory options in Homebridge's `config.json`.

- **Secure the Homebridge host.** Anyone who can reach the receiver on your LAN can send the same automation commands.
- **Prefer a static IP / DHCP reservation** so the configured host does not drift.
- **Volume presets are absolute.** A preset Switch only jumps to its configured level (not 100%), but choose levels carefully.

The plugin never collects analytics. See [`SECURITY.md`](SECURITY.md).

## Requirements

- Homebridge 1.6.0+ or 2.0+
- Node.js 20+
- An AudioControl Concert XR receiver with IP control enabled

## More Info

- [Features](https://github.com/tbaur/homebridge-concert/blob/main/docs/FEATURES.md)
- [Protocol reference](https://github.com/tbaur/homebridge-concert/blob/main/docs/PROTOCOL.md) (command catalog for contributors)
- [Development](https://github.com/tbaur/homebridge-concert/blob/main/DEVELOPMENT.md)
- [Report Issues](https://github.com/tbaur/homebridge-concert/issues)
- [Changelog](https://github.com/tbaur/homebridge-concert/blob/main/CHANGELOG.md)

## License

Copyright 2026 tbaur

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) file for details.
