# homebridge-concert

[![Tests](https://github.com/tbaur/homebridge-concert/actions/workflows/test.yml/badge.svg)](https://github.com/tbaur/homebridge-concert/actions/workflows/test.yml)
[![npm version](https://img.shields.io/npm/v/homebridge-concert?style=flat-square)](https://www.npmjs.com/package/homebridge-concert)
[![npm downloads](https://img.shields.io/npm/dt/homebridge-concert?label=downloads&style=flat-square)](https://www.npmjs.com/package/homebridge-concert)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-green)](https://nodejs.org)
[![Homebridge](https://img.shields.io/badge/homebridge-%3E%3D1.6.0%20%7C%7C%202.x-purple)](https://homebridge.io)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

Control power on your **AudioControl Concert XR** receiver (e.g. XR-8S) in Apple HomeKit through Homebridge.

## Features

### Device Support
- **Power Switch** — HomeKit Switch that powers the receiver on or puts it into standby
- **Zone targeting** — Control Zone 1 (main) or Zone 2
- **Accessory Information** — Manufacturer, model, and serial derived from your config

### Reliability
- **LAN IP control** — Talks to the unit over TCP port `50000` using the AudioControl X/XR automation protocol
- **State polling** — Refreshes On/Off from the receiver on a configurable interval (default every 30s; clamped 5s–86400s)
- **Bounded timeouts** — Connect and request timeouts so a stalled receiver cannot hang Homebridge; response buffers are capped
- **Readable logs** — Power transitions log once; the first poll failure warns, then further failures demote to debug until recovery; frame dumps stay at debug
- **Startup config validation** — A missing/invalid host is fatal (cached accessories are cleared); out-of-range port/zone/refreshRate warn and fall back/clamp

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

**Homebridge UI** (recommended): open this plugin's settings and set at least **Host / IP Address**. The form is generated from `config.schema.json` (name, host, port, accessory name, zone, model, refresh rate).

Or add the platform to your `config.json`:

```json
{
  "platforms": [
    {
      "platform": "Concert",
      "name": "Concert",
      "host": "192.168.1.50",
      "port": 50000,
      "accessoryName": "Theater AVR",
      "zone": 1,
      "model": "Concert XR-8S",
      "options": {
        "refreshRate": 30
      }
    }
  ]
}
```

### 4. Restart Homebridge

The power switch appears in the Home app after restart. Toggle it on to power the receiver; toggle it off for standby.

## Supported Devices

| Type | Description |
|------|-------------|
| **AudioControl Concert XR** | Concert XR-series receivers/processors with IP automation control on TCP port 50000 (tested target: XR-8S) |

## Configuration Options

| Option | Required | Description |
|--------|:--------:|-------------|
| `name` | ✓ | Plugin instance name shown in the Homebridge log (required by the schema; pre-filled with `Concert`) |
| `host` | ✓ | IP address or hostname of the receiver |
| `port` | | TCP control port (default: 50000) |
| `accessoryName` | | HomeKit display name for the power switch (defaults to the platform `name`) |
| `zone` | | Zone to control: `1` (main, default) or `2` |
| `model` | | Model shown in Accessory Information (default: `Concert XR-8S`) |
| `options.refreshRate` | | Seconds between power-state polls (default: 30, minimum: 5, maximum: 86400). Below-minimum / non-numeric values fall back to the default; above-maximum values are clamped. |

## Not Working?

1. **Check Control mode** — General Settings → Control must be **IP** (not RS232)
2. **Check Standby Mode** — Must be **IP and HDMI ON**, or the unit will not answer while in standby
3. **Check host/port** — Confirm the IP in the receiver's Network menu; control is on port `50000`
4. **Restart Homebridge** — Required after any config change

## Security

This plugin talks only to the LAN IP you configure. It stores no cloud credentials — only the host/port (and optional display options) in Homebridge's `config.json`.

- **Secure the Homebridge host.** Anyone who can reach the receiver on your LAN can send the same power commands.
- **Prefer a static IP / DHCP reservation** so the configured host does not drift.

The plugin never collects analytics. See [`SECURITY.md`](SECURITY.md).

## Requirements

- Homebridge 1.6.0+ or 2.0+
- Node.js 20+
- An AudioControl Concert XR receiver with IP control enabled

## More Info

- [Report Issues](https://github.com/tbaur/homebridge-concert/issues)
- [Changelog](CHANGELOG.md)

## License

Copyright 2026 tbaur

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) file for details.
