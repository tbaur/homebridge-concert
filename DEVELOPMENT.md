# Development

## Architecture

```
src/
  index.ts              Entry point; registers the dynamic platform.
  settings.ts           Constants (plugin/platform names, model default, port, timeouts,
                        refresh + wake-retry windows, breaker thresholds, volume range)
                        and `readPluginVersion()`.
  platform.ts           Accessory lifecycle, multi-accessory discovery, shared polling, stale cleanup.
  types/                Plugin config + accessory context types.
  errors/               Structured, typed error hierarchy.
  api/
    protocol.ts         X/XR automation frame builders and parsers.
    sources.ts          Input/source catalog (query codes + RC5 select bytes per zone).
    client.ts           Short-lived TCP client (injectable createConnection; zone per call).
    index.ts            Barrel exports.
  devices/
    switch-accessory.ts Base Switch: Accessory Information, cached On state, set/poll
                        race protection, single-flight polling, failure logging.
    preset-accessory.ts Base for "on when the zone matches a target" switches.
    power.ts            HomeKit Switch for power on/standby.
    volume-preset.ts    HomeKit Switch for a configured volume level.
    source-preset.ts    HomeKit Switch for a configured input/source.
    index.ts            Barrel exports.
  utils/
    validators.ts       Startup config validation, accessory resolution, resolvers.
    context.ts          Validation for accessory context restored from the Homebridge cache.
    errors.ts           Cause-preserving text for caught values (`describeError`).
    serial.ts           Stable per-accessory HomeKit SerialNumber generation/persistence.
    index.ts            Barrel exports.
config.schema.json      Homebridge UI settings form (platform config).
docs/
  FEATURES.md           Feature checklist.
  PROTOCOL.md           Full automation protocol catalog for contributors.
```

`dist/` is **committed to git** so `npm install` from a git URL works. CI rebuilds and fails if `dist/` has drifted from `src/`, so run `npm run build` and commit the result with every source change.

## Design principles

- **Dependency-light by design.** The Homebridge plugin runtime uses Node's native `net` and pulls in no third-party runtime dependencies. `homebridge` is a dev-only dependency used for *types only* — there is no runtime `import`/`require` of it, so a CommonJS build never has to load an ESM-only host module. Anything needed at runtime (`HAPStatus`, `HapStatusError`, `Service`, `Characteristic`, `uuid`) comes from the injected `api.hap`. `npm audit --omit=dev` reports zero advisories.
- **`@types/node` tracks the engines floor.** Pinned to the major matching `engines.node`, so the compiler rejects an API that would not exist on the oldest supported runtime. Bumping one without the other silently removes that guarantee.
- **Compatibility claims are tested, not asserted.** `engines.homebridge` allows `^1.6.0`, so CI type-checks and runs the suite against Homebridge 1.6 as well as the pinned 2.x. The `updateDisplayName` fallback and the deliberately loose `PlatformConfig` constructor parameter both exist to keep that true.
- **Dev-dependency hygiene.** Two `overrides` entries pin transitive dev dependencies away from known advisories: `js-yaml` to `^4.2.0`, and `brace-expansion` to `^5.0.9` (`5.0.8` and earlier are affected by GHSA-rgw5-rvv9-x895). Both are dev-only and never shipped. Use a floating minimum rather than an exact pin so a future advisory fix is picked up instead of held back.
- **Pure logic is isolated** in `api/protocol.ts` and `utils/` so it is trivially unit-testable; the TCP client accepts an injectable `createConnection` for testing.
- **Strict TypeScript**, plus `noUncheckedIndexedAccess` and `noImplicitOverride`. The first matters most in `api/protocol.ts`, which indexes into byte buffers straight off the wire. Tests relax it (they index fixtures they just defined) but nothing else.
- **Type-aware linting.** `eslint.config.js` points at `tsconfig.test.json` so rules like `no-floating-promises` and `no-misused-promises` can run; `npm run lint` uses `--max-warnings 0`, so a warning is a failure rather than decoration.
- **Fail fast on bad config, but never destroy user state.** `validateConfig` runs in the platform constructor; fatal errors stop the plugin with an actionable message, non-fatal issues log a warning and fall back to defaults. Cached accessories are deliberately left registered when config is invalid — unregistering them makes HomeKit discard room assignments, scenes, and automations that the user cannot get back by fixing a typo.
- **Never crash the host.** Homebridge runs every plugin in one process, so anything that could throw into a lifecycle callback or an unhandled rejection is contained: `didFinishLaunching` is wrapped, each accessory is constructed independently, poll promises always carry a rejection handler, and sockets keep an inert `error` listener after teardown.
- **Multi-accessory first.** Platform config is a list of typed switches (`power`, `volumePreset`, …). New kinds share discovery, UUID identity, the poll loop, and the `SwitchAccessory` base.

## Reliability & performance

This plugin talks to a **LAN TCP** control port, so its resilience focuses on making each request robust:

- **Short-lived connections** — each query/set opens a TCP socket, sends one frame, reads one response, and closes. That avoids sticky half-open sockets if the receiver drops idle clients in standby.
- **Serialized TCP** — `ConcertClient` runs one command at a time so Power + Volume polls (and sets) never open overlapping sockets against a flaky standby stack.
- **Bounded timeouts** — connect and request waits are capped so a stalled receiver cannot wedge Homebridge. Sets accept an overall `timeoutMs` budget that also covers post-ack verification, and every set caller supplies one.
- **Sets answer inside HAP's write window, then finish out of band.** HAP-NodeJS abandons a write handler after `Accessory.TIMEOUT_WARNING + TIMEOUT_AFTER_WARNING` (9s) and *discards* whatever the handler eventually returns, so a 60s wake retry can never be reported through the write. Each set makes one attempt bounded by `HOMEKIT_WRITE_BUDGET_MS`; if that fails only because the receiver is not ready, the write is acknowledged and `completeInBackground` finishes the job, pushing the real value to HomeKit when it lands and reverting the characteristic if it ultimately fails. Polls skip while that background work is pending.
- **A set is only confirmed by a frame that agrees with it.** An RC5 power or source command may be acknowledged by a following status frame, so `send` takes a `confirms` predicate: a status frame reporting the *opposite* state is discarded like any other unmatched frame, which routes the ambiguity into settle-and-verify instead of caching the inverse of reality. Checking only the answer code let a "Power = STANDBY" reply confirm a Power On.
- **Polling cadence** — default 90s, configurable; values below 5s fall back to the 90s default and values above 86400s are clamped (which prevents Node's `setInterval` overflow-to-1ms behavior). The shared timer refreshes power handlers first and awaits them, then refreshes the presets together. Overlapping ticks coalesce onto the in-flight walk so a slow standby timeout cannot stack polls.
- **Preset fan-in** — presets refresh concurrently precisely so the client's per-zone in-flight coalescing can collapse them; refreshing them one at a time would cost one TCP round trip per preset for the same value.
- **Standby means Off, not unknown** — when the client last observed the zone in standby, volume-preset and source-preset polls skip the query *and* report Off. A preset asserts "the zone is at this level / on this input", which cannot hold for a receiver that is off; skipping without correcting the value left the switch stuck On for as long as standby lasted. The standby check is deliberately `=== false`, not "not on": with no power accessory configured the power state is never observed, and a stricter test would disable preset polling entirely.
- **Sets invalidate their siblings** — a successful set calls `platform.requestRefresh()`. Only one volume level or input can be active, so the other presets on that zone are wrong the moment one succeeds, and a preset set implies the receiver is awake, so the power switch may be wrong too. Without this they stayed wrong until the next poll tick.
- **Refresh reason drives log severity** — a refresh carries a `RefreshReason`. A scheduled `poll` failure is real news: it warns once, then demotes to debug, and after `POLL_FAILURES_BEFORE_UNKNOWN` it drops to No Response. A `post-set` failure is expected — the XR rejects reads for ~20s after waking — so it logs at debug only and does not count toward the failure streak. Without the distinction, every power-on produced two spurious warnings about a receiver that was merely still waking.
- **Redundant writes are only skipped while fresh** — a HomeKit On write is dropped as a no-op when the switch already reads On, but only within `STATE_FRESHNESS_MS` of the last confirmed reading. Beyond that the level may have been changed at the front panel, and dropping the write would silently do nothing.
- **Unreachable backoff** — after `QUERY_BREAKER_FAILURE_THRESHOLD` consecutive transport failures the client stops dialing for a growing cool-off, so an unplugged receiver cannot consume most of every poll interval in connect timeouts. The cool-off doubles once per *opening*, not once per failed query: one sweep issues a query per command type, so counting per query advanced the backoff several steps at a time and pushed recovery minutes past the point the receiver came back. Sets bypass the breaker (a HomeKit action is deliberate and must always be attempted) and any success closes it.
- **A refused connection is not a waking receiver.** `isReceiverNotReadyError` treats `ECONNREFUSED`/`ENOTFOUND`/`EHOSTUNREACH`/`ENETUNREACH` as permanent, so a set against an absent host fails promptly instead of re-dialing for the full wake window. A waking receiver accepts the connection and then stalls or answers `0x85`, which is what the retry loop is for.
- **Cached power state expires.** `getLastPowerState` returns `undefined` past `POWER_STATE_TTL_MS`. Presets skip their own query when the zone was last seen in standby, so without an expiry a receiver unplugged while in standby would let them re-confirm Off forever and never report a fault.
- **Retry sleeps sit outside the TCP lock.** `withQueryRetry` wraps `withExclusive`, not the reverse, so the delay between attempts does not block a HomeKit write the user just made.
- **Set/poll isolation** — HomeKit sets own a `setGeneration`; a poll that started before a set is discarded so plugin-driven changes log cleanly. Overlapping poll ticks share one in-flight request per accessory (single-flight).
- **Query retry** — a timed-out / closed power, volume, or source query is retried once after a short delay before the poll is marked failed.
- **Verification off the lock** — after a missing set ack the client re-queries state, but each query re-acquires the TCP lock on its own so the settle pauses do not block polls or other writes.
- **Wake-aware volume / source set** — `setVolumeWhenReady` and `setSourceWhenReady` retry every 2s for up to 60s on connection errors and answer `0x85` (invalid in current state), so Shortcuts can set a volume preset or select an input after power-on without a fixed Wait. The “device is not ready” info log is deferred 30s (normal XR wake is ~20s). Polls are skipped while that set is in flight.
- **Quiet poll failures** — the first consecutive failure logs at warn; repeats demote to debug until a successful poll recovers. Failed polls keep the last known On value (no Off flip → fake “(external)” On on recover).
- **Unknown is not Off** — a switch reports `SERVICE_COMMUNICATION_FAILURE` (HomeKit “No Response”) until a query or set has revealed real state, and returns to that after `POLL_FAILURES_BEFORE_UNKNOWN` consecutive failures, so an automation cannot act on an invented or long-stale value. Short failure streaks keep the last known value so a single timeout does not make the switch flicker.
- **HAP write-back ordering** — HAP assigns the *written* value to a characteristic after the set handler resolves, so a "snap back" pushed synchronously from inside `onSet` is overwritten. `snapCharacteristic` defers to the next macrotask; the error path can push synchronously because HAP skips its write-back when the handler throws.
- **Clean shutdown** — `shutdown` clears the poll timer and calls `ConcertClient.close()`, which wakes pending retry sleeps and fails in-flight requests instead of letting them run out their timeouts. Retry sleeps are `unref`'d so they never hold the process open.

### Accessory identity and renaming

An accessory's UUID is derived from its identity key alone (`z1:power`, `z1:vol:57`, `z1:src:cd`) — deliberately **not** the receiver's address. Seeding it with `host:port` meant a DHCP lease change produced entirely new accessories and `removeStaleAccessories` unregistered the old ones, costing the user every room assignment, scene, and automation for a receiver that had merely moved. Host and port stay in the accessory context for diagnostics, which is what makes the "receiver address changed" breadcrumb reachable.

`pairWithCached` maps each configured entry to the cached accessory it should reuse: exact UUID matches are claimed first, then anything left over is matched on the identity recorded in its context. That second pass is the migration for the UUID change — an accessory cached under the old address-based scheme is *adopted* rather than replaced, so upgrading costs the user nothing. Pairing runs before `removeStaleAccessories`, because an adopted accessory keeps its original UUID and must count as one to keep. Identity matching compares the preset target too, so two volume presets on one zone can never adopt each other's accessory.

Changing a preset's value still produces a different accessory, because the value *is* the identity. Renaming is handled separately and in place: `applyAccessoryDisplayName` uses `updateDisplayName` on Homebridge ≥1.8 and falls back to writing `displayName` plus the private `_associatedHAPAccessory` on older versions, because assigning `displayName` alone is not persisted across a cache restore.

### No handler means No Response

An accessory with no attached handler is not inert: HAP's `Characteristic.handleGetRequest` falls through to the value deserialized from its cache, so the switch would serve a stale state an automation could act on. `markAccessoryUnavailable` attaches `onGet`/`onSet` that throw `SERVICE_COMMUNICATION_FAILURE` instead, which is what actually produces "No Response". It is used both when config is invalid and when a single accessory fails to construct.

### Retry cadence

Retries are deliberately fixed-interval rather than exponentially backed off. The wake retry polls a single receiver every 2s specifically to notice readiness promptly; growing the interval would make a Shortcut wait longer than necessary, and there is no herd to protect against. Escalating backoff lives where it actually helps — the query circuit breaker, which doubles its cool-off while the receiver stays unreachable.

## Testing

- Unit tests live in `tests/unit/` and inject fakes (no real network). Platform and device accessories are unit-tested with a mocked Homebridge/HAP surface; the TCP client uses a fake socket.
- Tests compile under the production strict TypeScript settings (`tsconfig.test.json` extends `tsconfig.json`), relaxing only `noUnusedLocals`, `noUnusedParameters`, and `noUncheckedIndexedAccess`. Run `npx tsc --noEmit -p tsconfig.test.json` to type-check both trees together; note that the config restates `exclude`, because the inherited one excludes `tests` and would otherwise cancel its own `include`.
- Coverage threshold is 80% across statements, branches, functions, and lines. Excluded: declaration files, the four barrel `index.ts` files, and `settings.ts`. The barrels are listed individually rather than globbed, because `!src/**/index.ts` also silently excluded `src/index.ts` (the plugin entry point) and `src/errors/index.ts`.
- **Fakes must model the real object, or they hide the path they cover.** The client detaches only the listeners it added (`socket.off(...)`) and leaves an inert `error` listener behind, so the socket fake must be a plain `EventEmitter` that does not intercept `off()` or `emit()`. The same trap has bitten the HAP fakes twice: a `PlatformAccessory` double missing `on()` made every cached-restore test silently exercise the *failure* path instead, and it passed. When a fixture stands in for a real object, assert that the happy path was actually reached — e.g. `expect(log.error).not.toHaveBeenCalledWith(expect.stringContaining('Skipping accessory'))`.

Requires **Node.js 20 or newer**, matching the `engines` range in `package.json`. CI runs this suite on Node 20, 22, and 24, plus a job against the oldest supported Homebridge.

```bash
npm install
npm run build                         # compile TypeScript to dist/ (commit the result)
npm run lint                          # eslint, warnings are failures
npx tsc --noEmit -p tsconfig.test.json # type-check src + tests together
npm test                              # jest with coverage (NODE_ENV=test)
npm run test:unit                     # unit tests only
```

`npm install` does not build: there is no `prepare` script, because it would rewrite the committed `dist/` on every install and dirty the working tree. Run `npm run build` yourself and commit the result. Publishing is still safe — `prepublishOnly` cleans and rebuilds.

## Adding new capabilities

1. Read [docs/PROTOCOL.md](docs/PROTOCOL.md) for the command catalog, RC5 codes, and verification notes.
2. Add frame builders in `src/api/protocol.ts` (and parse response data as needed).
3. Expose methods on `ConcertClient` in `src/api/client.ts` (pass `zone` per call).
4. Add a device handler under `src/devices/`, extending `SwitchAccessory` (or `PresetSwitchAccessory` for "on when the zone matches a target" behavior) so it inherits state caching, race protection, and failure logging.
5. Extend `accessories[].type` in `config.schema.json`, `ConcertAccessoryConfig`, and `validateConfig` / `resolveAccessories`. Give any new numeric field `minimum`/`maximum` in the schema when an out-of-range value is fatal, so the Homebridge UI cannot save a config the plugin refuses to start with.
6. Wire construction in `platform.ts` (`createHandler` + UUID identity), adding the handler to `powerHandlers` or `presetHandlers` as appropriate.
7. Add unit tests for protocol helpers, client, accessory path, and config validation.
8. Update PROTOCOL.md mapping/status and FEATURES.md.
9. Run `npm run build` and commit the `dist/` changes.
