# Development

## Architecture

```
src/
  index.ts            Entry point; registers the dynamic platform.
  settings.ts         Constants (plugin/platform names, model default, port, timeouts, volume range).
  platform.ts         Accessory lifecycle, multi-accessory discovery, shared polling, stale cleanup.
  types/              Plugin config + accessory context types.
  errors/             Structured, typed error hierarchy.
  api/
    protocol.ts       X/XR automation frame builders and parsers.
    client.ts         Short-lived TCP client (injectable createConnection; zone per call).
    index.ts          Barrel exports.
  devices/
    power.ts          HomeKit Switch for power on/standby.
    volume-preset.ts  HomeKit Switch for a configured volume level.
    index.ts          Barrel exports.
  utils/
    validators.ts     Startup config validation, accessory resolution, resolvers.
    index.ts          Barrel exports.
config.schema.json    Homebridge UI settings form (platform config).
docs/
  FEATURES.md         Feature checklist.
  PROTOCOL.md         Full automation protocol catalog for contributors.
```

## Design principles

- **Dependency-light by design.** The Homebridge plugin runtime uses Node's native `net` and pulls in no third-party runtime dependencies. `homebridge` is a dev-only dependency (types) injected at runtime by the host, and `npm audit --omit=dev` reports zero advisories.
- **Dev-dependency hygiene.** Two `overrides` entries pin transitive dev dependencies away from known advisories: `js-yaml` to `^4.2.0`, and `brace-expansion` to `5.0.8`. Both are dev-only and never shipped.
- **Pure logic is isolated** in `api/protocol.ts` and `utils/` so it is trivially unit-testable; the TCP client accepts an injectable `createConnection` for testing.
- **Strict TypeScript** (`noImplicitAny`, `noUnusedLocals`, etc.).
- **Fail fast on bad config.** `validateConfig` runs in the platform constructor; fatal errors stop the plugin with an actionable message, non-fatal issues log a warning and fall back to defaults.
- **Multi-accessory first.** Platform config is a list of typed switches (`power`, `volumePreset`, …). New kinds share discovery, UUID identity, and the poll loop.

## Reliability & performance

This plugin talks to a **LAN TCP** control port, so its resilience focuses on making each request robust:

- **Short-lived connections** — each query/set opens a TCP socket, sends one frame, reads one response, and closes. That avoids sticky half-open sockets if the receiver drops idle clients in standby.
- **Bounded timeouts** — connect and request waits are capped so a stalled receiver cannot wedge Homebridge.
- **Polling cadence** — default 90s, configurable, clamped to 5s–86400s (prevents Node's `setInterval` overflow-to-1ms behavior). Shared timer refreshes every registered handler.
- **Set/poll isolation** — HomeKit sets own a `setGeneration`; a poll that started before a set is discarded so plugin-driven changes log cleanly. Overlapping poll ticks share one in-flight request per accessory (single-flight).
- **Query retry** — a timed-out / closed power query is retried once after a short delay before the poll is marked failed.
- **Quiet poll failures** — the first consecutive failure logs at warn; repeats demote to debug until a successful poll recovers. Volume polls that fail (e.g. standby) report the preset Switch as Off.

## Testing

- Unit tests live in `tests/unit/` and inject fakes (no real network). Platform and device accessories are unit-tested with a mocked Homebridge/HAP surface; the TCP client uses a fake socket.
- Tests compile under the same strict TypeScript settings as production (`tsconfig.test.json`).
- Coverage threshold is 80% across statements, branches, functions, and lines for the whole `src/` tree (only barrel files and `settings.ts` are excluded).

Requires **Node.js 20 or newer**, matching the `engines` range in `package.json`. CI runs this suite on Node 20, 22, and 24.

```bash
npm install
npm run build          # compile TypeScript to dist/
npm run lint           # eslint
npm test               # jest with coverage (NODE_ENV=test)
npm run test:unit      # unit tests only
```

## Adding new capabilities

1. Read [docs/PROTOCOL.md](docs/PROTOCOL.md) for the command catalog, RC5 codes, and verification notes.
2. Add frame builders in `src/api/protocol.ts` (and parse response data as needed).
3. Expose methods on `ConcertClient` in `src/api/client.ts` (pass `zone` per call).
4. Add a device handler under `src/devices/` implementing `RefreshableAccessory`.
5. Extend `accessories[].type` in `config.schema.json`, `ConcertAccessoryConfig`, and `validateConfig` / `resolveAccessories`.
6. Wire construction in `platform.ts` (`createHandler` + UUID identity).
7. Add unit tests for protocol helpers, client, accessory path, and config validation.
8. Update PROTOCOL.md mapping/status and FEATURES.md.
