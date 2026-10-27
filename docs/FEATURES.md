# Features

**homebridge-concert**

A checklist of what is built. What a Home app user sees, including every log line, is in the [detailed documentation](README-DETAILED.md). The command catalog, including commands this plugin does not expose, is in [PROTOCOL.md](PROTOCOL.md).

## Built

### Switches

- ✅ Power on / standby (`type: power`). On powers the zone. Off puts it into standby
- ✅ Volume preset (`type: volumePreset`). On when the zone's volume equals a configured step, 0–99, the same number the receiver shows. Set On jumps to that step. Set Off leaves the level alone
- ✅ Source preset (`type: sourcePreset`). On when the zone is on a configured input (for example CD). Set On selects it. Set Off leaves the input alone
- ✅ As many switches as you need on one receiver, each aimed at Zone 1 or Zone 2
- ✅ Zone 2 "follow Zone 1" is read through Zone 1, so a Zone 2 source switch still tracks the input you hear
- ✅ `DISPLAY` is Zone 1 only. The plugin rejects it on Zone 2 and will not start
- ✅ One receiver per Homebridge. A second receiver needs its own Homebridge

### Reliability

- ✅ LAN control on TCP port 50000. One connection stays open and is reused. It is dropped if the receiver closes it or a request times out
- ✅ Commands run one at a time, so standby does not see overlapping sessions
- ✅ Polling, default every 90 seconds. Below 5 seconds falls back to 90. Above 86400 seconds is clamped. Connect and response waits are 5 seconds each
- ✅ A volume or source On shows On in HomeKit immediately and keeps trying for up to 60 seconds while the receiver wakes. The "receiver is not ready" log waits until that wake has already taken 30 seconds
- ✅ The switch stays On only after a later read agrees with the set. An acknowledgement on its own is not enough
- ✅ A host that refuses the connection, or cannot be resolved, fails the set immediately instead of using up the 60 second wake window
- ✅ No Response until the receiver has been read, and again after three failed polls. One failure keeps the last known state
- ✅ Volume and source presets report Off while the zone is in standby
- ✅ Turning one preset On re-reads the others, so two volume levels or two inputs are never both On
- ✅ A bad config leaves cached switches registered, so rooms, scenes, and automations survive a typo
- ✅ Identity is the switch type, zone, and volume or source. The receiver's address is not part of it, so an IP change keeps the switches. Accessories cached under the older address-based identity are adopted on upgrade
- ✅ Renaming a switch stays in place. Changing a preset's volume or source creates a new accessory and drops that switch's room and automations
- ✅ After repeated connection failures, polling pauses. The pause starts at 30 seconds and doubles, up to 10 minutes. A HomeKit set still tries
- ✅ The first poll failure in a streak is a warning. Later ones stay at debug for an hour, then warn again
- ✅ Optional PagerDuty (`options.pagerdutySignals`, off by default): `receiver-offline` after 3 poll cycles that dialed the receiver and got no reply. A rejected command or a standby reply clears it. A paused poll does not count. Needs Node 22.13 or later. On an older Node 22 the plugin still runs and skips the page. See [PagerDuty](README-DETAILED.md#pagerduty)
- ✅ A missing host, an empty accessory list, a name longer than 64 characters, or a duplicate identity is fatal. A bad port or refresh rate warns and uses the default or the clamp

### Quality

- ✅ Strict TypeScript, plus `noUncheckedIndexedAccess` and `noImplicitOverride`
- ✅ Jest suite with an 80% coverage gate
- ✅ No analytics
- ✅ No runtime dependencies. The plugin uses Node's `net` module
- ✅ Homebridge UI settings form via `config.schema.json`
- ✅ Homebridge v2.0+ support
- ✅ Node.js 22, 24, and 26 support

## Out of scope

- ❌ Factory defaults (`0x05`) and PIN save/restore (`0x06`). Those commands can wipe or unlock the receiver. They stay out of HomeKit

Mute, tone, tuner, and the rest of the family command catalog are listed in [PROTOCOL.md](PROTOCOL.md). A row there marked **No** is not a commitment to build it.

## Accessories

| Type | HomeKit service |
|------|-----------------|
| **AudioControl Concert XR** (tested: XR-8S) | Switch (power), Switch (volume preset), Switch (source preset) |

## Protocol surface

Full automation command catalog, including capabilities not exposed in HomeKit: [PROTOCOL.md](PROTOCOL.md).

## Architecture

See [DEVELOPMENT.md](../DEVELOPMENT.md) for the source layout, the design principles, and how to run a build against a receiver.
