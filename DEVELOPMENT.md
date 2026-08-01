# Development

## Architecture

```
src/
  index.ts            Entry point; registers the dynamic platform.
  settings.ts         Constants (plugin/platform names, port, timeouts).
  platform.ts         Accessory lifecycle, polling, stale cleanup.
  types/              Plugin config + accessory context types.
  errors/             Structured, typed error hierarchy.
  api/
    protocol.ts       X/XR automation frame builders and parsers.
    client.ts         Short-lived TCP client (injectable createConnection).
    index.ts          Barrel exports.
  devices/
    receiver.ts       HomeKit Switch accessory for power on/standby.
  utils/
    validators.ts     Startup config validation + resolvers.
    index.ts          Barrel exports.
config.schema.json    Homebridge UI settings form (platform config).
```

## Design principles

- **Dependency-light by design.** The Homebridge plugin runtime uses Node's native `net` and pulls in no third-party runtime dependencies. `homebridge` is a dev-only dependency (types) injected at runtime by the host, and `npm audit --omit=dev` reports zero advisories.
- **Dev-dependency hygiene.** Two `overrides` entries pin transitive dev dependencies away from known advisories: `js-yaml` to `^4.2.0`, and `brace-expansion` to `5.0.8`. Both are dev-only and never shipped.
- **Pure logic is isolated** in `api/protocol.ts` and `utils/` so it is trivially unit-testable; the TCP client accepts an injectable `createConnection` for testing.
- **Strict TypeScript** (`noImplicitAny`, `noUnusedLocals`, etc.).
- **Fail fast on bad config.** `validateConfig` runs in the platform constructor; fatal errors stop the plugin with an actionable message, non-fatal issues log a warning and fall back to defaults.

## Reliability & performance

This plugin talks to a **LAN TCP** control port, so its resilience focuses on making each request robust:

- **Short-lived connections** — each power query/set opens a TCP socket, sends one frame, reads one response, and closes. That avoids sticky half-open sockets if the receiver drops idle clients in standby.
- **Bounded timeouts** — connect and request waits are capped so a stalled receiver cannot wedge Homebridge.
- **Polling cadence** — default 90s, configurable, clamped to 5s–86400s (prevents Node's `setInterval` overflow-to-1ms behavior).
- **Set/poll isolation** — HomeKit sets own a `setGeneration`; a poll that started before a set is discarded so plugin-driven changes log as `ON`/`STANDBY` (not `(external)`). Overlapping poll ticks share one in-flight request (single-flight).
- **Query retry** — a timed-out / closed power query is retried once after a short delay before the poll is marked failed.
- **Quiet poll failures** — the first consecutive failure logs at warn; repeats demote to debug until a successful poll recovers.

## Testing

- Unit tests live in `tests/unit/` and inject fakes (no real network). The platform and receiver accessory are unit-tested with a mocked Homebridge/HAP surface; the TCP client uses a fake socket.
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

Power *query* uses command `0x00` / data `0xF0`. Power *set* uses Simulate RC5 (`0x08`) with discrete Power On (`0x7B`) / Power Off (`0x7C`).

The plugin currently exposes power on/standby for one configured zone. To add volume, source, or other X/XR commands:

1. Add frame builders in `src/api/protocol.ts` (and parse response data as needed).
2. Expose methods on `ConcertClient` in `src/api/client.ts`.
3. Map the new state to HAP services in `src/devices/receiver.ts` (or a new accessory handler).
4. Extend `config.schema.json` / `ConcertPlatformConfig` if new options are required.
5. Add unit tests for the protocol helpers and the accessory path.
