# homebridge-concert

[![Tests](https://github.com/tbaur/homebridge-concert/actions/workflows/test.yml/badge.svg)](https://github.com/tbaur/homebridge-concert/actions/workflows/test.yml)
[![npm version](https://img.shields.io/npm/v/homebridge-concert?style=flat-square)](https://www.npmjs.com/package/homebridge-concert)
[![npm downloads](https://img.shields.io/npm/dt/homebridge-concert?label=downloads&style=flat-square)](https://www.npmjs.com/package/homebridge-concert)
[![Node.js](https://img.shields.io/badge/node-22%20%7C%7C%2024%20%7C%7C%2026-green)](https://nodejs.org)
[![verified-by-homebridge](https://img.shields.io/badge/homebridge-verified-blueviolet?color=%23491F59&style=flat)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
[![Homebridge](https://img.shields.io/badge/homebridge-2.x-purple)](https://homebridge.io)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

Control your **AudioControl Concert XR** receiver (e.g. XR-8S) in Apple HomeKit through Homebridge: power/standby, volume presets, and input/source presets as HomeKit Switches.

## Features

### Device Support
- **Power switch:** On powers the zone; Off puts it into standby
- **Volume preset switch:** On when volume equals a configured step (0–99, the same number the receiver shows). Set On jumps to that step. Set Off does nothing
- **Source preset switch:** On when the zone is on a configured input (for example CD). Set On selects it. Set Off does nothing
- **As many switches as you need** on one receiver, each aimed at Zone 1 or Zone 2

### Reliability
- **LAN control** on TCP port 50000
- **Polling** (default every 90s) that backs off when the receiver is unreachable
- **Wake retries** on volume and source, so a Shortcut does not need a fixed wait
- **No Response** until the receiver has been read, and again after repeated poll failures
- **Bad config keeps your switches.** A bad host or accessory list leaves them registered so rooms, scenes, and automations survive
- **PagerDuty** *(optional, off by default):* page when the receiver has been unreachable for 3 polls in a row. Needs Node 22.13 or later. On an older Node 22 the plugin still runs and skips the page. See [PagerDuty](docs/README-DETAILED.md#pagerduty)

### Quality
- **Strict TypeScript** and a Jest suite with an 80% coverage gate
- **No analytics**

Every option, log line, and troubleshooting step is in [Detailed documentation](docs/README-DETAILED.md).

## Quick Start

### 1. Install

**Homebridge UI** (recommended): Plugins → Search `homebridge-concert` → Install

```bash
npm install -g homebridge-concert
```

### 2. Prepare the receiver

1. Set **Control** to **IP** (General Settings)
2. Set **Standby Mode** to **IP and HDMI ON**
3. Prefer a static IP or a DHCP reservation

### 3. Configure

**Homebridge UI** (recommended): set **Host / IP Address**, then add power, volume, and source switches.

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
        { "type": "power", "name": "XR-8S Power", "zone": 1 },
        { "type": "volumePreset", "name": "XR-8S Volume", "zone": 1, "volume": 57 },
        { "type": "sourcePreset", "name": "XR-8S Source", "zone": 1, "source": "CD" }
      ],
      "options": {
        "refreshRate": 90
      }
    }
  ]
}
```

### 4. Restart Homebridge

Switches appear in the Home app after restart. A listen Shortcut and the log lines it produces are in the [detailed documentation](docs/README-DETAILED.md#example-shortcut).

## Supported Devices

| Type | Description |
|------|-------------|
| **AudioControl Concert XR** | XR-series with IP automation on TCP 50000 (tested: XR-8S) |

## Configuration Options

Only one `Concert` platform block is supported, so one receiver per Homebridge instance. A second receiver needs its own Homebridge.

| Option | Required | Description |
|--------|:--------:|-------------|
| `name` | ✓ (UI) | Plugin instance name in the Homebridge log. A hand-edited config that omits it falls back to `Concert` |
| `host` | ✓ | IP or hostname of the receiver. Do not include a port; use `port` |
| `accessories` | ✓ | Non-empty list of HomeKit switches |
| `port` | | TCP control port (default 50000) |
| `model` | | Accessory Information model (default `AudioControl Concert XR-8S`) |
| `options.refreshRate` | | Poll interval in seconds (default 90; below 5 falls back to 90, above 86400 is clamped) |
| `options.pagerdutySignals` | | Page through homebridge-pagerduty. Off until turned on. See [PagerDuty](docs/README-DETAILED.md#pagerduty). |

Accessory fields, input names, and what happens when you rename a switch or change its volume are in the [detailed documentation](docs/README-DETAILED.md#full-configuration-reference).

## Not Working?

1. **Control** must be **IP**, and **Standby Mode** must be **IP and HDMI ON**.
2. Confirm the host and port `50000` in the receiver's Network menu.
3. **No Response** right after a restart is normal until the first poll.
4. If the log says the configuration is invalid, the plugin has not started. The switches stay in their rooms and show No Response until the config is fixed and Homebridge is restarted.
5. **Restart Homebridge** after any config change.

The [full troubleshooting list](docs/README-DETAILED.md#troubleshooting) covers presets in standby, a moved IP address, and polling that goes quiet on purpose.

## Security

The plugin talks only to the configured LAN address. There are no cloud credentials. Anyone who can reach the receiver on your LAN can send the same commands. Prefer a static IP. Volume presets jump to an absolute level. See [SECURITY.md](SECURITY.md).

## Requirements

- Homebridge 2.x
- Node.js 22, 24, or 26. PagerDuty signals need 22.13 or later; the rest of the plugin does not
- An AudioControl Concert XR receiver with IP control enabled

## More Info

- [Detailed documentation](docs/README-DETAILED.md)
- [Features](docs/FEATURES.md)
- [Protocol reference](docs/PROTOCOL.md)
- [Development](DEVELOPMENT.md)
- [Report Issues](https://github.com/tbaur/homebridge-concert/issues)
- [Changelog](CHANGELOG.md)

## Trademarks

homebridge-concert is an independent project. It is not affiliated with or endorsed by AudioControl. AudioControl and Concert XR are trademarks of AAMP of Florida, Inc.

## License

Copyright 2026 tbaur

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) file for details.
