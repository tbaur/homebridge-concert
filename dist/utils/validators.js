"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Configuration validation. Validates the Homebridge platform
 * config at startup so misconfiguration fails fast with an actionable message.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isValidHost = isValidHost;
exports.validateConfig = validateConfig;
exports.resolvePort = resolvePort;
exports.resolveZone = resolveZone;
exports.resolveRefreshRateSec = resolveRefreshRateSec;
const settings_1 = require("../settings");
function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}
/**
 * True when `value` looks like a usable hostname or IPv4/IPv6 address.
 *
 * Rejects `host:port` forms (except bracketed IPv6) so a combined target cannot
 * silently fail later in `net.createConnection`.
 */
function isValidHost(value) {
    const host = value.trim();
    if (host.length === 0 || host.length > 253) {
        return false;
    }
    // Reject characters that would make a TCP target ambiguous or unsafe.
    if (/[\s/\\?#]/.test(host)) {
        return false;
    }
    // Bare IPv6 may contain colons; require brackets when using that form.
    if (host.includes(':')) {
        if (!(host.startsWith('[') && host.includes(']'))) {
            return false;
        }
    }
    return true;
}
/**
 * Validate the platform config.
 *
 * Fatal: missing/invalid `host`. Non-fatal: out-of-range `port`, `zone`, or
 * `refreshRate` — those produce warnings and fall back/clamp via the resolvers.
 */
function validateConfig(config) {
    const errors = [];
    const warnings = [];
    if (!config || typeof config !== 'object') {
        return { errors: ['Platform configuration is missing.'], warnings };
    }
    if (!isNonEmptyString(config.host)) {
        errors.push('host is required (IP address or hostname of the AudioControl Concert receiver).');
    }
    else if (!isValidHost(config.host)) {
        errors.push(`host "${config.host}" is not a valid hostname or IP address `
            + '(do not include a port; use the port option instead).');
    }
    if (config.port !== undefined) {
        if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65_535) {
            warnings.push(`port ${String(config.port)} is invalid; using default ${settings_1.DEFAULT_CONTROL_PORT}.`);
        }
    }
    if (config.zone !== undefined) {
        if (!Number.isInteger(config.zone) || (config.zone !== 1 && config.zone !== 2)) {
            warnings.push(`zone ${String(config.zone)} is invalid; using default ${settings_1.DEFAULT_ZONE}.`);
        }
    }
    const refreshRate = config.options?.refreshRate;
    if (refreshRate !== undefined) {
        if (typeof refreshRate !== 'number' || !Number.isInteger(refreshRate) || Number.isNaN(refreshRate)) {
            warnings.push(`options.refreshRate ${String(refreshRate)} is invalid; using default ${settings_1.DEFAULT_REFRESH_RATE_SEC}.`);
        }
        else if (refreshRate < settings_1.MIN_REFRESH_RATE_SEC) {
            warnings.push(`options.refreshRate ${refreshRate}s is below the ${settings_1.MIN_REFRESH_RATE_SEC}s minimum; `
                + `using default ${settings_1.DEFAULT_REFRESH_RATE_SEC}.`);
        }
        else if (refreshRate > settings_1.MAX_REFRESH_RATE_SEC) {
            warnings.push(`options.refreshRate ${refreshRate}s is above the ${settings_1.MAX_REFRESH_RATE_SEC}s maximum; it will be clamped.`);
        }
    }
    return { errors, warnings };
}
/** Resolve a usable TCP port, falling back to the AudioControl default. */
function resolvePort(port) {
    if (typeof port === 'number' && Number.isInteger(port) && port >= 1 && port <= 65_535) {
        return port;
    }
    return settings_1.DEFAULT_CONTROL_PORT;
}
/** Resolve a usable zone number (1 or 2). */
function resolveZone(zone) {
    if (zone === 1 || zone === 2) {
        return zone;
    }
    return settings_1.DEFAULT_ZONE;
}
/**
 * Resolve a usable refresh interval in seconds.
 *
 * Out-of-range values fall back to `fallback` (below minimum / non-integer) or
 * are clamped to {@link MAX_REFRESH_RATE_SEC} (above maximum).
 */
function resolveRefreshRateSec(refreshRate, fallback) {
    if (typeof refreshRate !== 'number' || !Number.isInteger(refreshRate) || Number.isNaN(refreshRate)) {
        return fallback;
    }
    if (refreshRate < settings_1.MIN_REFRESH_RATE_SEC) {
        return fallback;
    }
    if (refreshRate > settings_1.MAX_REFRESH_RATE_SEC) {
        return settings_1.MAX_REFRESH_RATE_SEC;
    }
    return refreshRate;
}
//# sourceMappingURL=validators.js.map