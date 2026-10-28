# AudioControl X/XR automation protocol

Reference for the binary IP/RS232 control surface used by AudioControl Concert XR (and related X-series) units. This plugin implements a subset; the rest is catalogued so future HomeKit accessories can be added without re-hunting vendor PDFs.

## Provenance

- **Source of truth:** AudioControl’s official serial/IP protocol document (linked from Concert XR product pages at [audiocontrol.com](https://www.audiocontrol.com)).
- **Owner’s manual:** [Concert XR series user manual](pdf/concert-xr-series-user-manual.pdf) ([original](https://archive.audiocontrol.com/downloads/home/current/concert-xr-series/concert-xr-series-user-manual.pdf)). Its *Automation Integration* section covers IP control on port 50000 and the RS232 settings (38,400 baud, 8N1, no flow control). The *General Setup* menu covers **Control** (IP or RS232) and **Standby Mode** (Low Power, or IP and HDMI ON). The command set itself is in the separate protocol document.
- **Full command reference:** [Arcam AVR5/AVR10/AVR20/AVR30/AV40 serial and IP protocol](pdf/arcam-avr5-10-20-30-av40-rs232-ip-protocol.pdf) (SH289E, 7 Oct 2021, [original](https://www.arcam.co.uk/ugc/tor/avr5/Custom%20Installation%20Notes/RS232_5_10_20_30_40_SH289E_E_07Oct21.pdf)). AudioControl does not publish its own copy; its product pages offer an Excel automation table instead. The Concert XR uses the same platform and framing, and the codes this plugin has verified on an XR-8S match this document: power `0x00`, RC5 `0x08`, volume `0x0D`, current source `0x1D`, and answer code `0x85`. It also documents the RC5 code set, AMX Duet discovery, and the note that an RC5 command usually triggers an extra status message.
- **Family framing:** The same `0x21 … 0x0D` request/response layout appears on sibling Harman/Arcam-class receivers. Many command codes below are documented from that family and **must be verified on Concert XR** before shipping new HomeKit features.
- Rows marked **Verified** have been exercised against Concert hardware in this plugin (power, volume, and source — the paths HomeKit uses today). Rows marked **Family** come from the shared framing family and still need Concert XR confirmation before relying on them in production.

## Transport

| Item | Value |
|------|--------|
| Framing | Identical over RS232 and TCP |
| IP port | `50000` |
| Receiver setup | **Control → IP**; **Standby Mode → IP and HDMI ON** so the unit answers while in standby |

This plugin keeps **one TCP connection** and sends each command on it. Replies normally arrive in about 130 ms. The receiver drops about one request in a hundred without replying, and a resend on the same connection is answered normally. So the plugin sends a request again if it gets no reply after 1 second. The socket stays open until the receiver closes it or nothing answers for 5 seconds; the next command connects again.

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

Codes that do not appear in the catalog below are not part of this page. Treat a gap as unknown, and confirm it against the vendor document before using it.

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
| `0x05` | Factory defaults | `0xAA 0xAA`. Do not expose this in HomeKit. It can wipe the receiver | No | Family |
| `0x06` | Save/restore secure settings | Op + PIN. Do not expose this in HomeKit | No | Family |
| `0x08` | Simulate RC5 IR | `system`, `command` (2 data bytes) | Impl (power on/off + source select) | Verified |
| `0x09` | Display information type | Mode / query `0xF0` | No | Family |

### Input / routing (`0x0A`–`0x0C`, `0x1D`)

| Cc | Name | Data / notes | Status | Provenance |
|----|------|--------------|--------|------------|
| `0x0A` | Video selection | `0x00` BD … `0x06` STB; `0xF0` query | No | Family |
| `0x0B` | Analogue / digital / HDMI audio | `0x00`/`0x01`/`0x02`; `0xF0` query | No | Family |
| `0x0C` | IMAX Enhanced | Auto/On/Off / query | No | Family |
| `0x1D` | Current source | Query `0xF0`; status `0x01` CD, `0x02` BD, `0x03` AV, `0x04` SAT, `0x05` PVR, `0x06` UHD, `0x08` AUX, `0x09` DISPLAY, `0x0B` FM, `0x0C` DAB, `0x0E` NET, `0x10` STB, `0x11` GAME, `0x12` BT; `0x00` = Follow Z1 (client resolves via Zone 1 query) | Impl (query) | Verified |

### Output / volume (`0x0D`–`0x14`)

| Cc | Name | Data / notes | Status | Provenance |
|----|------|--------------|--------|------------|
| `0x0D` | Volume | Set `0x00`–`0x63` (0–99); query `0xF0` | Impl | Verified |
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

HomeKit inputs. `src/api/sources.ts` must match this table. Full vendor tables remain in the official AudioControl / family protocol docs.

| Input | Query `0x1D` | RC5 Zone 1 | RC5 Zone 2 | Status |
|-------|--------------|------------|------------|--------|
| CD | `0x01` | `0x76` | `0x06` | Impl |
| BD | `0x02` | `0x62` | `0x07` | Impl |
| AV | `0x03` | `0x5E` | `0x09` | Impl |
| SAT | `0x04` | `0x1B` | `0x14` | Impl |
| PVR | `0x05` | `0x60` | `0x0F` | Impl |
| UHD | `0x06` | `0x7D` | `0x17` | Impl |
| AUX | `0x08` | `0x63` | `0x0D` | Impl |
| DISPLAY | `0x09` | `0x3A` | none (Zone 1 only) | Impl |
| FM | `0x0B` | `0x1C` | `0x0E` | Impl |
| DAB | `0x0C` | `0x48` | `0x10` | Impl |
| NET | `0x0E` | `0x5C` | `0x13` | Impl |
| STB | `0x10` | `0x64` | `0x08` | Impl |
| GAME | `0x11` | `0x61` | `0x0B` | Impl |
| BT | `0x12` | `0x7A` | `0x16` | Impl |

## Example frames

Power query (zone 1):

```text
21 01 00 01 F0 0D
```

Power query response, zone 1, powered on. The byte after the command is the answer code (`0x00` = OK), then the data length, then the status (`0x01` = on, `0x00` = standby):

```text
21 01 00 00 01 01 0D
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

1. Confirm the command against the official protocol doc and a live XR unit. Try the query first. Debug logging prints the frames, and they contain no secrets. Do not add factory defaults (`0x05`) or PIN save/restore (`0x06`) as HomeKit accessories.
2. Add builders/parsers in `src/api/protocol.ts`.
3. Expose methods on `ConcertClient`.
4. Add a HomeKit handler under `src/devices/` and a new `accessories[].type` (schema + validators).
5. Update this file’s **Plugin mapping** and catalog **Status** columns.
6. Add unit tests.

See [DEVELOPMENT.md](../DEVELOPMENT.md).
