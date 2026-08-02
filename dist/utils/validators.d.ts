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
 * True when `value` looks like a usable hostname or IPv4/IPv6 address.
 *
 * Rejects `host:port` forms (except bracketed IPv6) so a combined target cannot
 * silently fail later in `net.createConnection`.
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
 * Zone defaults to 1 when omitted or invalid (invalid zone already fatal when
 * validating entries that set an explicit bad zone).
 */
export declare function resolveAccessories(config: ConcertPlatformConfig): ResolvedAccessory[];
/** Resolve a usable TCP port, falling back to the AudioControl default. */
export declare function resolvePort(port: number | undefined): number;
/** Resolve a usable zone number (1 or 2). */
export declare function resolveZone(zone: number | undefined): number;
/**
 * Resolve a usable refresh interval in seconds.
 *
 * Out-of-range values fall back to `fallback` (below minimum / non-integer) or
 * are clamped to {@link MAX_REFRESH_RATE_SEC} (above maximum).
 */
export declare function resolveRefreshRateSec(refreshRate: number | undefined, fallback: number): number;
//# sourceMappingURL=validators.d.ts.map