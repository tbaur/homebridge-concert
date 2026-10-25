# homebridge-concert detailed documentation

Install and a short options table live in the [README](../README.md). This page is the rest: every option, how the switches behave while the receiver wakes or drops off the LAN, and the log lines worth searching for.

## Table of Contents

- [Full configuration reference](#full-configuration-reference)
- [How switches work](#how-switches-work)
- [Zones and inputs](#zones-and-inputs)
- [Accessory identity](#accessory-identity)
- [Polling, wake, and No Response](#polling-wake-and-no-response)
- [Example shortcut](#example-shortcut)
- [Logs](#logs)
- [PagerDuty](#pagerduty)
- [Troubleshooting](#troubleshooting)
- [Related docs](#related-docs)

## Full configuration reference

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
        "refreshRate": 90,
        "pagerdutySignals": false
      }
    }
  ]
}
```

Only one `Concert` platform block is supported, so one receiver per Homebridge instance.

| Option | Required | Description |
|--------|:--------:|-------------|
| `name` | ✓ (UI) | Plugin instance name in the Homebridge log. Required by the Homebridge UI form. A hand-edited `config.json` that omits it falls back to `Concert`. |
| `host` | ✓ | IP address or hostname of the receiver. Prefer a static address or a DHCP reservation. |
| `accessories` | ✓ | Non-empty list of HomeKit switches. |
| `port` | | TCP control port. Default 50000. A value that is not a valid port logs a warning and falls back to 50000. |
| `model` | | String shown in HomeKit Accessory Information. Default `AudioControl Concert XR-8S`. Longer than 64 characters, HomeKit truncates it. |
| `options.refreshRate` | | Seconds between polls. Default 90. Below 5 falls back to 90. Above 86400 is clamped. A non-integer falls back to 90. |
| `options.pagerdutySignals` | | Write `receiver-offline` to homebridge-pagerduty. Off until turned on. See [PagerDuty](#pagerduty). Needs Node 22.13 or later. |

### `accessories[]` entries

| Field | Required | Description |
|-------|:--------:|-------------|
| `type` | ✓ | `power`, `volumePreset`, or `sourcePreset` |
| `name` | ✓ | HomeKit display name |
| `zone` | | `1` (main, default) or `2` |
| `volume` | for `volumePreset` | Absolute level `0`–`99` |
| `source` | for `sourcePreset` | An input name from the list below. Case-insensitive. The Homebridge UI offers the uppercase form. |

Source names: `CD`, `BD`, `AV`, `SAT`, `PVR`, `UHD`, `AUX`, `DISPLAY`, `FM`, `DAB`, `NET`, `STB`, `GAME`, `BT`.

Duplicate identity (same type, zone, and volume or source) is rejected at startup. A missing `host` or an empty `accessories` list is fatal. A bad port or refresh rate is not: the plugin warns and uses the default or the clamp.

## How switches work

| Switch | On means | Set On | Set Off |
|--------|----------|--------|---------|
| Power | The zone is powered | Power the zone on | Put the zone into standby |
| Volume preset | Volume equals the configured level | Set that level | Nothing. Off means "not at this level" |
| Source preset | The zone is on the configured input | Select that input | Nothing. Off means "not on this input" |

A volume or source set answers HomeKit immediately and finishes a slow wake in the background. The switch updates when the receiver accepts the command. A set counts only when a later read agrees with it. An acknowledgement code by itself is not enough.

Turning one preset On re-reads the others, so two volume levels or two inputs are never both On.

Accessory Information shows manufacturer AudioControl, the configured model, this plugin's version as the firmware revision, and a serial number generated once and stored in the Homebridge accessory cache. Clearing that cache issues new serial numbers.

## Zones and inputs

Each switch targets Zone 1 or Zone 2. Zone 1 is the default.

`DISPLAY` is Zone 1 only.

Zone 2 can report "follow Zone 1". The plugin reads Zone 1 and uses that input, so a Zone 2 source switch still tracks the input you hear.

Match `source` to the name on the front panel, for example `CD`.

## Accessory identity

A switch's identity is its type, zone, and volume or source. The receiver's address is not part of it. Changing `host` or `port` after a DHCP lease moves keeps the same HomeKit accessories, rooms, scenes, and automations. The log records the address change.

An older version of this plugin did include the address in the identity. Those cached switches are adopted on upgrade rather than replaced.

Renaming a switch is applied in place. Changing a preset's `volume` or `source` creates a new accessory and removes the old one, so that switch loses its room, scenes, and automations. Change a preset value only when you are ready to place it again in the Home app.

A fatal config error leaves cached switches registered. They report No Response until the config is valid and Homebridge is restarted. Unregistering them would drop rooms and automations that fixing a typo cannot restore.

## Polling, wake, and No Response

`refreshRate` is how often the plugin reads the receiver. Power is read first. Volume and source presets on the same zone share one request. A poll that is still running when the next tick fires is not started twice.

Volume and source polls are skipped while the zone was last seen in standby. That memory expires after 5 minutes, so a receiver that was unplugged in standby still reaches No Response instead of reporting Off forever.

Each query is tried once more if the receiver accepts the connection and then stays silent. That retry is part of the same poll.

Until the first successful read, a switch reports No Response rather than a guessed value. One failed poll keeps the last known state. Three failed polls in a row report No Response again. The first failure in a streak is a warning. Later ones stay at debug for an hour, then warn again, so a receiver that is down for days does not fill the log and does not disappear from it.

After repeated connection failures, polling pauses instead of dialing an absent receiver every tick. The pause starts at 30 seconds and doubles, up to 10 minutes. A HomeKit set still tries. The pause ends when a query or a set gets a reply.

A volume or source On retries every 2 seconds for up to 60 seconds while the receiver returns "invalid command in current state", which is normal for the first 15–20 seconds of a cold boot. If it is still refusing after 30 seconds, the log says the receiver is not ready and that retries continue. A Shortcut can turn the switches On without a fixed Wait.

Connect and response waits are 5 seconds each. A stalled receiver cannot hold the poll open past those limits.

## Example shortcut

Typical listen shortcut:

1. If **XR-8S Power** is Off, turn it On.
2. If **XR-8S Source** is Off, turn it On. That selects the configured input and retries while the receiver wakes.
3. If **XR-8S Volume** is Off, turn it On. That sets the configured level and retries while the receiver wakes.
4. Start playback on that source.

Shutdown: turn **XR-8S Power** Off. That is standby, not a fault. Volume and source presets then report Off.

## Logs

Startup:

```text
[Concert] Initializing Concert platform
[Concert] homebridge-concert v2.0.0 → 192.168.1.50:50000 (AudioControl Concert XR-8S)
[Concert] Registering accessory "XR-8S Power" (z1:power) at 192.168.1.50:50000
[Concert] Restored accessory "XR-8S Volume" (z1:vol:57) at 192.168.1.50:50000
[Concert] Polling accessory state every 90s
```

A listen shortcut:

```text
[Concert] XR-8S Power: ON
[Concert] XR-8S Source: SET CD
[Concert] XR-8S Volume: SET 57
```

The receiver changed from the remote or the front panel:

```text
[Concert] XR-8S Power: STANDBY (external)
[Concert] XR-8S Source: OFF (source BD, external)
[Concert] XR-8S Volume: OFF (level 40, external)
```

The first read after a restart says `(initial)` instead of `(external)`.

Still waking, 30 seconds after a volume or source On:

```text
[Concert] XR-8S Volume: receiver is not ready (check power); retrying in the background for up to 60s
```

The receiver is not answering. The first failure is a warning. On the third, the switch reports No Response. Once polling has backed off, later polls say they are paused:

```text
[Concert] XR-8S Power: poll failed: Timed out connecting to 192.168.1.50:50000
[Concert] XR-8S Power: state unknown after 3 failed polls; reporting No Response
[Concert] XR-8S Power: poll failed: 192.168.1.50:50000 unreachable for 3 consecutive queries; pausing polls for 30s
[Concert] XR-8S Power: poll recovered
```

A command the receiver rejected, which is not the same as unreachable:

```text
[Concert] XR-8S Volume: poll failed: volume query rejected: invalid command in current state
[Concert] XR-8S Volume: SET 57 did not complete: volume set rejected: invalid command in current state
```

Config that will not start:

```text
[Concert] host is required (IP address or hostname of the AudioControl Concert receiver).
[Concert] Invalid configuration; plugin will not start until it is corrected.
[Concert] 3 cached accessory(ies) will report No Response until the configuration is corrected.
```

The host in these lines is the one in your config. The examples use `192.168.1.50`.

## PagerDuty

This plugin can page through [homebridge-pagerduty](https://github.com/tbaur/homebridge-pagerduty) when the receiver cannot be reached. It needs Node 22.13 or later. The setting is off until you turn it on.

1. Turn on **Send Signals to PagerDuty** (`options.pagerdutySignals`) next to Refresh Rate.
2. Restart Homebridge.
3. In homebridge-pagerduty's settings, allow homebridge-concert to page, save, and restart Homebridge again. [Signals from other plugins](https://github.com/tbaur/homebridge-pagerduty/blob/main/docs/SIGNALS.md#let-a-plugin-page) explains each step and what else you can set for each signal.

| Signal | Severity | Active when |
| --- | --- | --- |
| `receiver-offline` | error | 3 poll cycles in a row dialed the receiver and got no reply |

A poll cycle counts once for the receiver, however many switches failed in it. The one automatic retry of a silent query is inside that cycle, so a single silent request does not page. A cycle that fails only because polling was already paused does not count.

Standby is a reply. A command the receiver rejects is a reply. Either one clears the page. The summary does not include the host or a switch name: "Homebridge has not reached the Concert receiver. Its switches may show No Response."

At startup the plugin logs one line, `homebridge-pagerduty support is enabled (receiver-offline)`, before the first poll. It is not logged when the setting is off or when startup validation failed. Shutdown closes the store and does not clear the signal.

## Troubleshooting

1. **Control** must be **IP**, not RS232.
2. **Standby Mode** must be **IP and HDMI ON**, or the receiver will not answer while it is in standby.
3. Confirm the host and port `50000` in the receiver's Network menu.
4. Volume and source presets report Off while the zone is in standby. Power on first.
5. Match `source` to the front-panel name, for example `CD`.
6. Restart Homebridge after any config change, including a new switch.
7. **No Response on every switch, with `Invalid configuration; plugin will not start until it is corrected.`** The log line above that one names the field. Fix it and restart. The switches stay in their rooms.
8. **No Response right after a restart, with no config error.** Normal until the first poll. The plugin does not guess a state.
9. **Polling goes quiet.** After repeated connection failures the plugin pauses instead of dialing an absent receiver every tick. A HomeKit set still tries. One success resumes polling. The pause line is `unreachable for N consecutive queries; pausing polls`.
10. **A Shortcut turns power On and the volume switch does not follow.** The receiver often refuses volume and input for 15–20 seconds after power-on. The plugin retries for 60 seconds. The `receiver is not ready` line means that wait is still running.
11. **The receiver's address changed.** Update `host`. Existing switches stay. The log says `receiver address changed`.
12. **A preset disappeared from its room after a config edit.** Changing `volume` or `source` publishes a new accessory. Renaming does not.

## Related docs

- [README](../README.md): install and the short options table
- [FEATURES.md](FEATURES.md): feature checklist
- [PROTOCOL.md](PROTOCOL.md): the automation command catalog, including commands this plugin does not expose
- [DEVELOPMENT.md](../DEVELOPMENT.md)
- [SECURITY.md](../SECURITY.md)

## License

Copyright 2026 tbaur

Licensed under the Apache License, Version 2.0. See [LICENSE](../LICENSE) file for details.
