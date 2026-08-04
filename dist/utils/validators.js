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
exports.accessoryIdentityKey = accessoryIdentityKey;
exports.validateConfig = validateConfig;
exports.resolveAccessories = resolveAccessories;
exports.resolvePort = resolvePort;
exports.resolveZone = resolveZone;
exports.resolveRefreshRateSec = resolveRefreshRateSec;
const protocol_1 = require("../api/protocol");
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
function isAccessoryKind(value) {
    return value === 'power' || value === 'volumePreset' || value === 'sourcePreset';
}
/** Stable identity key used for duplicate detection and UUID generation. */
function accessoryIdentityKey(accessory) {
    if (accessory.kind === 'volumePreset') {
        return `z${accessory.zone}:vol:${accessory.volume}`;
    }
    if (accessory.kind === 'sourcePreset') {
        return `z${accessory.zone}:src:${accessory.source}`;
    }
    return `z${accessory.zone}:power`;
}
/**
 * Validate the platform config.
 *
 * Fatal: missing/invalid `host`, missing/invalid `accessories`.
 * Non-fatal: out-of-range `port` or `refreshRate` — those produce warnings and
 * fall back/clamp via the resolvers.
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
    if (!Array.isArray(config.accessories) || config.accessories.length === 0) {
        errors.push('accessories is required and must contain at least one entry.');
    }
    else {
        const seen = new Set();
        config.accessories.forEach((entry, index) => {
            const label = `accessories[${index}]`;
            const resolved = tryResolveAccessory(entry, label, errors);
            if (!resolved) {
                return;
            }
            const key = accessoryIdentityKey(resolved);
            if (seen.has(key)) {
                errors.push(`${label} duplicates another accessory (${key}).`);
            }
            else {
                seen.add(key);
            }
        });
    }
    return { errors, warnings };
}
/**
 * Resolve and validate accessories after `validateConfig` has reported no errors.
 *
 * Zone defaults to 1 when omitted or invalid (invalid zone already fatal when
 * validating entries that set an explicit bad zone).
 */
function resolveAccessories(config) {
    const errors = [];
    const resolved = [];
    for (const [index, entry] of (config.accessories ?? []).entries()) {
        const accessory = tryResolveAccessory(entry, `accessories[${index}]`, errors);
        if (accessory) {
            resolved.push(accessory);
        }
    }
    if (errors.length > 0) {
        throw new Error(errors.join(' '));
    }
    return resolved;
}
function tryResolveAccessory(entry, label, errors) {
    if (!entry || typeof entry !== 'object') {
        errors.push(`${label} must be an object.`);
        return undefined;
    }
    if (!isAccessoryKind(entry.type)) {
        errors.push(`${label}.type must be "power", "volumePreset", or "sourcePreset".`);
        return undefined;
    }
    if (!isNonEmptyString(entry.name)) {
        errors.push(`${label}.name is required.`);
        return undefined;
    }
    let zone = settings_1.DEFAULT_ZONE;
    if (entry.zone !== undefined) {
        if (entry.zone !== 1 && entry.zone !== 2) {
            errors.push(`${label}.zone must be 1 or 2.`);
            return undefined;
        }
        zone = entry.zone;
    }
    if (entry.type === 'power') {
        return {
            kind: 'power',
            name: entry.name.trim(),
            zone,
        };
    }
    if (entry.type === 'sourcePreset') {
        if (!isNonEmptyString(entry.source)) {
            errors.push(`${label}.source is required for sourcePreset `
                + `(one of: ${protocol_1.SOURCE_LABELS.join(', ')}).`);
            return undefined;
        }
        const definition = (0, protocol_1.resolveSourceDefinition)(entry.source);
        if (!definition) {
            errors.push(`${label}.source "${entry.source}" is not a known input `
                + `(one of: ${protocol_1.SOURCE_LABELS.join(', ')}).`);
            return undefined;
        }
        if (!(0, protocol_1.sourceSupportsZone)(definition, zone)) {
            errors.push(`${label}.source "${definition.label}" is not available for zone ${zone}.`);
            return undefined;
        }
        return {
            kind: 'sourcePreset',
            name: entry.name.trim(),
            zone,
            source: definition.id,
        };
    }
    if (typeof entry.volume !== 'number'
        || !Number.isInteger(entry.volume)
        || entry.volume < settings_1.MIN_VOLUME
        || entry.volume > settings_1.MAX_VOLUME) {
        errors.push(`${label}.volume is required for volumePreset and must be an integer `
            + `${settings_1.MIN_VOLUME}–${settings_1.MAX_VOLUME}.`);
        return undefined;
    }
    return {
        kind: 'volumePreset',
        name: entry.name.trim(),
        zone,
        volume: entry.volume,
    };
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