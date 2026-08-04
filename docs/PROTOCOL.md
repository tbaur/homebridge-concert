# AudioControl X/XR automation protocol

Reference for the binary IP/RS232 control surface used by AudioControl Concert XR (and related X-series) units. This plugin implements a subset; the rest is catalogued so future HomeKit accessories can be added without re-hunting vendor PDFs.

## Provenance

- **Source of truth:** AudioControl’s official serial/IP protocol document (linked from Concert XR product pages at [audiocontrol.com](https://www.audiocontrol.com)).
- **Family framing:** The same `0x21 … 0x0D` request/response layout appears on sibling Harman/Arcam-class receivers. Many command codes below are documented from that family and **must be verified on Concert XR** before shipping new HomeKit features.
- Rows marked **Verified** have been exercised against Concert hardware in this plugin (currently power query + RC5 power on/off). Rows marked **Family** come from the shared framing family and **must be verified on Concert XR** before relying on them in production (volume `0x0D` is implemented in code but still Family until confirmed on-unit).

## Transport

| Item | Value |
|------|--------|
| Framing | Identical over RS232 and TCP |
| IP port | `50000` |
| Receiver setup | **Control → IP**; **Standby Mode → IP and HDMI ON** so the unit answers while in standby |

This plugin opens a **short-lived TCP connection per command** (connect → one request → one matching response → close).

## Wire format

**Request:** `St Zn Cc Dl Data… Et`  
**Response:** `St Zn Cc Ac Dl Data… Et`

| Field | Byte | Notes |
|-------|------|--------|
| St | `0x21` (`!`) | Start |
| Zn | `0x01` or `0x02` | Zone 1 (main) / Zone 2 |
| Cc | command | See catalog |
| Ac | answer (responses only) | `0x00` = OK |
| Dl | data length | Number of Data bytes |
| Data | 0–255 bytes | Parameters / status |
| Et | `0x0D` | End (CR) |

### Answer codes

| Code | Meaning |
|------|---------|
| `0x00` | OK / status update |
| `0x82` | Incorrect zone |
| `0x83` | Incorrect command |
| `0x84` | Incorrect parameter |
| `0x85` | Invalid command in current state (common in standby) |
| `0x86` | Incorrect data length |

Many status commands use data `0xF0` as a **query sentinel**.

## Plugin mapping

| Protocol capability | Plugin status | HomeKit `accessories[].type` |
|---------------------|---------------|------------------------------|
| Power query (`0x00`) + RC5 Power On/Off | Implemented | `power` |
| Volume query/set (`0x0D`) | Implemented | `volumePreset` (On = at configured level) |
| Source query (`0x1D`) + RC5 source keys | Implemented | `sourcePreset` (On = on configured input) |
| Mute (`0x0E` / RC5 mute) | Not implemented | — |
| Video select only (`0x0A`) | Not implemented | — (use source preset / RC5) |
| Tone / trim / balance | Not implemented | — |
| Tuner / network extras | Not implemented | — |

## Command catalog

Status: **Impl** = implemented in this plugin; **No** = not implemented (catalog only).

### System (`0x00`–`0x09`)

| Cc | Name | Data / notes | Status | Provenance |
|----|------|--------------|--------|------------|
| `0x00` | Power state | Query `0xF0`; status `0x00` standby / `0x01` on. Direct set may be ignored — use RC5. | Impl (query) | Verified |
| `0x01` | Display brightness | Query `0xF0` | No | Family |
| `0x02` | Headphones connected | Query `0xF0` | No | Family |
| `0x03` | FM programme type | Query `0xF0` | No | Family |
| `0x04` | Software version | Subsystem `0xF0`–`0xF5` | No | Family |
| `0x05` | Factory defaults | `0xAA 0xAA` | No | Family |
| `0x06` | Save/restore secure settings | Op + PIN | No | Family |
| `0x08` | Simulate RC5 IR | `system`, `command` (2 data bytes) | Impl (power on/off + source select) | Verified (power); Family (source) |
| `0x09` | Display information type | Mode / query `0xF0` | No | Family |

### Input / routing (`0x0A`–`0x0C`, `0x1D`)

| Cc | Name | Data / notes | Status | Provenance |
|----|------|--------------|--------|------------|
| `0x0A` | Video selection | `0x00` BD … `0x06` STB; `0xF0` query | No | Family |
| `0x0B` | Analogue / digital / HDMI audio | `0x00`/`0x01`/`0x02`; `0xF0` query | No | Family |
| `0x0C` | IMAX Enhanced | Auto/On/Off / query | No | Family |
| `0x1D` | Current source | Query `0xF0`; status `0x01` CD, `0x02` BD, `0x03` AV, `0x04` SAT, `0x05` PVR, `0x06` UHD, `0x08` AUX, `0x09` DISPLAY, `0x0B` FM, `0x0C` DAB, `0x0E` NET, `0x10` STB, `0x11` GAME, `0x12` BT; `0x00` = Follow Z1 (client resolves via Zone 1 query) | Impl (query) | Family |

### Output / volume (`0x0D`–`0x14`)

| Cc | Name | Data / notes | Status | Provenance |
|----|------|--------------|--------|------------|
| `0x0D` | Volume | Set `0x00`–`0x63` (0–99); query `0xF0` | Impl | Family → verify on unit |
| `0x0E` | Mute status | Query `0xF0`; `0x00` muted / `0x01` unmuted | No | Family |
| `0x0F` | Direct mode | Query `0xF0` | No | Family |
| `0x10` | Decode mode (2ch) | Query `0xF0` | No | Family |
| `0x11` | Decode mode (multi) | Query `0xF0` | No | Family |
| `0x12` | RDS information | Query `0xF0` | No | Family |
| `0x13` | Video output resolution | Query `0xF0` | No | Family |
| `0x14` | Open menu status | Query `0xF0` | No | Family |

### Tuner / radio (selection)

| Cc | Name | Data / notes | Status | Provenance |
|----|------|--------------|--------|------------|
| `0x15` | Tuner preset | `0x01`–`0x32` or query `0xF0` | No | Family |
| `0x16` | Tune FM | Inc/dec / query | No | Family |
| `0x18` | DAB station | Query `0xF0` | No | Family |
| `0x19` | DAB programme type | Query `0xF0` | No | Family |

### Setup adjustments (tone / trim)

| Cc | Name | Notes | Status | Provenance |
|----|------|-------|--------|------------|
| `0x35` | Treble | Set/query style levels | No | Family |
| `0x36` | Bass | Set/query style levels | No | Family |
| `0x3B` | Balance | Set/query | No | Family |
| other `0x35`–`0x41` | Trims / sync / sub, etc. | See official protocol PDF | No | Family |

Exact encodings for signed dB values differ by command; use the vendor table when implementing.

## Simulate RC5 (`0x08`)

Request data: `[system, command]`.

| Zone | RC5 system |
|------|------------|
| Zone 1 | `0x10` (16) |
| Zone 2 | `0x17` (23) |

### Common RC5 commands (system `0x10` / `0x17`)

| Function | Command | Status |
|----------|---------|--------|
| Standby (toggle-style on some tables) | `0x0C` | No (we use discrete off) |
| Volume + | `0x10` | No |
| Volume − | `0x11` | No |
| Mute | `0x0D` | No |
| Mute On (discrete) | `0x1A` | No |
| Mute Off (discrete) | `0x78` | No |
| **Power On (discrete)** | **`0x7B`** | **Impl** |
| **Power Off (discrete)** | **`0x7C`** | **Impl** |
| **Source: CD** | **`0x76`** (Z1) / **`0x06`** (Z2) | **Impl** |
| Source keys (BD, SAT, NET, …) | see `src/api/sources.ts` | Impl |

Catalogued HomeKit inputs and RC5 bytes: `src/api/sources.ts`. Full vendor tables remain in the official AudioControl / family protocol docs.

## Example frames

Power query (zone 1):

```text
21 01 00 01 F0 0D
```

RC5 Power On (zone 1):

```text
21 01 08 02 10 7B 0D
```

Volume set 57 / `0x39` (zone 1):

```text
21 01 0D 01 39 0D
```

Volume query (zone 1):

```text
21 01 0D 01 F0 0D
```

Source query (zone 1):

```text
21 01 1D 01 F0 0D
```

RC5 Source CD (zone 1):

```text
21 01 08 02 10 76 0D
```

## Extending the plugin

1. Confirm the command against the official protocol doc (and preferably a live XR unit).
2. Add builders/parsers in `src/api/protocol.ts`.
3. Expose methods on `ConcertClient`.
4. Add a HomeKit handler under `src/devices/` and a new `accessories[].type` (schema + validators).
5. Update this file’s **Plugin mapping** and catalog **Status** columns.
6. Add unit tests.

See [DEVELOPMENT.md](../DEVELOPMENT.md).
