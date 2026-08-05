/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Configuration validation. Validates the Homebridge platform
 * config at startup so misconfiguration fails fast with an actionable message.
 */
import type { ConcertPlatformConfig, ResolvedAccessory } from '../types';
/**
 * Outcome of validating the platform config.
 *
 * `errors` are fatal — the plugin cannot start. `warnings` are non-fatal — the
 * plugin starts but a value was missing/out of range and a default/clamp was applied.
 */
export interface ConfigValidationResult {
    errors: string[];
    warnings: string[];
}
/**
 * Raised when accessory resolution fails. Keeps the individual messages so a
 * caller can report them separately instead of parsing one joined string.
 */
export declare class ConfigValidationError extends Error {
    readonly errors: readonly string[];
    constructor(errors: readonly string[]);
}
/**
 * Render an untrusted config value safe for a single log line.
 *
 * Config comes from `config.json`, which other plugins and UI users can write.
 * Interpolating it raw lets an embedded newline forge log lines attributed to
 * other components.
 */
export declare function forLog(value: unknown): string;
/**
 * True when `value` is a usable IPv4/IPv6 address or DNS hostname.
 *
 * An allowlist rather than a denylist: only forms `net.createConnection` can
 * actually reach are accepted, so a malformed target fails at startup with a
 * clear message instead of as a DNS error on every poll. `host:port` is
 * rejected (use the `port` option); bracketed IPv6 (`[::1]`) is accepted and
 * unwrapped by the client before connecting.
 */
export declare function isValidHost(value: string): boolean;
/** Stable identity key used for duplicate detection and UUID generation. */
export declare function accessoryIdentityKey(accessory: ResolvedAccessory): string;
/**
 * Validate the platform config.
 *
 * Fatal: missing/invalid `host`, missing/invalid `accessories`.
 * Non-fatal: out-of-range `port` or `refreshRate` — those produce warnings and
 * fall back/clamp via the resolvers.
 */
export declare function validateConfig(config: ConcertPlatformConfig | undefined): ConfigValidationResult;
/**
 * Resolve and validate accessories after `validateConfig` has reported no errors.
 *
 * Zone defaults to 1 when omitted. An explicit zone other than 1 or 2 is fatal
 * and throws rather than being silently defaulted.
 *
 * @throws {ConfigValidationError} when any entry fails to resolve
 */
export declare function resolveAccessories(config: ConcertPlatformConfig): ResolvedAccessory[];
/** Resolve a usable TCP port, falling back to the AudioControl default. */
export declare function resolvePort(port: number | undefined): number;
/**
 * Resolve a usable refresh interval in seconds.
 *
 * Out-of-range values fall back to `fallback` (below minimum / non-integer) or
 * are clamped to {@link MAX_REFRESH_RATE_SEC} (above maximum).
 */
export declare function resolveRefreshRateSec(refreshRate: number | undefined, fallback: number): number;
//# sourceMappingURL=validators.d.ts.map