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
exports.ConfigValidationError = void 0;
exports.forLog = forLog;
exports.isValidHost = isValidHost;
exports.accessoryIdentityKey = accessoryIdentityKey;
exports.validateConfig = validateConfig;
exports.resolveAccessories = resolveAccessories;
exports.resolvePort = resolvePort;
exports.resolveRefreshRateSec = resolveRefreshRateSec;
const node_net_1 = require("node:net");
const protocol_1 = require("../api/protocol");
const settings_1 = require("../settings");
const types_1 = require("../types");
/**
 * Raised when accessory resolution fails. Keeps the individual messages so a
 * caller can report them separately instead of parsing one joined string.
 */
class ConfigValidationError extends Error {
    errors;
    constructor(errors) {
        super(errors.join(' '));
        this.name = 'ConfigValidationError';
        this.errors = [...errors];
    }
}
exports.ConfigValidationError = ConfigValidationError;
function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}
/** Control characters that would let a config value forge extra log lines. */
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/;
/** Same class, global, for replacement. `String.replace` resets `lastIndex`. */
const CONTROL_CHARACTERS_GLOBAL = /[\u0000-\u001F\u007F]/g;
/** Longest config value echoed into a log message. */
const MAX_LOGGED_VALUE_LENGTH = 100;
/**
 * Render an untrusted config value safe for a single log line.
 *
 * Config comes from `config.json`, which other plugins and UI users can write.
 * Interpolating it raw lets an embedded newline forge log lines attributed to
 * other components.
 */
function forLog(value) {
    const text = typeof value === 'string' ? value : String(value);
    const escaped = text.replace(CONTROL_CHARACTERS_GLOBAL, '\uFFFD');
    return escaped.length > MAX_LOGGED_VALUE_LENGTH
        ? `${escaped.slice(0, MAX_LOGGED_VALUE_LENGTH)}…`
        : escaped;
}
/** Labels are shown in the Home app, so control characters are rejected outright. */
function hasControlCharacters(value) {
    return CONTROL_CHARACTERS.test(value);
}
/** Each dot-separated hostname label: alphanumeric, inner hyphens allowed. */
const HOSTNAME_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
/**
 * True when `value` is a usable IPv4/IPv6 address or DNS hostname.
 *
 * An allowlist rather than a denylist: only forms `net.createConnection` can
 * actually reach are accepted, so a malformed target fails at startup with a
 * clear message instead of as a DNS error on every poll. `host:port` is
 * rejected (use the `port` option); bracketed IPv6 (`[::1]`) is accepted and
 * unwrapped by the client before connecting.
 */
function isValidHost(value) {
    const host = value.trim();
    if (host.length === 0 || host.length > settings_1.MAX_HOSTNAME_LENGTH) {
        return false;
    }
    if ((0, node_net_1.isIP)(host) !== 0) {
        return true;
    }
    const bracketed = /^\[(.+)\]$/.exec(host)?.[1];
    if (bracketed !== undefined) {
        return (0, node_net_1.isIP)(bracketed) === 6;
    }
    // A bare colon means a host:port pair or an unbracketed IPv6 literal.
    if (host.includes(':')) {
        return false;
    }
    return host.split('.').every((label) => HOSTNAME_LABEL.test(label));
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
        errors.push(`host "${forLog(config.host)}" is not a valid hostname or IP address `
            + '(do not include a port; use the port option instead).');
    }
    if (config.name !== undefined && !isNonEmptyString(config.name)) {
        errors.push('name must be a non-empty string when provided.');
    }
    else if (typeof config.name === 'string' && hasControlCharacters(config.name)) {
        errors.push('name must not contain control characters.');
    }
    // `model` reaches both the startup log and the HomeKit Model characteristic.
    // HAP truncates a long string but does not strip control characters, so an
    // unchecked value here could forge log lines.
    if (config.model !== undefined) {
        if (typeof config.model !== 'string') {
            errors.push('model must be a string when provided.');
        }
        else if (hasControlCharacters(config.model)) {
            errors.push('model must not contain control characters.');
        }
        else if (config.model.trim().length > settings_1.MAX_ACCESSORY_TEXT_LENGTH) {
            warnings.push(`model is longer than ${settings_1.MAX_ACCESSORY_TEXT_LENGTH} characters; `
                + 'HomeKit will truncate it.');
        }
    }
    if (config.port !== undefined) {
        if (!isValidPort(config.port)) {
            warnings.push(`port ${forLog(config.port)} is invalid; using default ${settings_1.DEFAULT_CONTROL_PORT}.`);
        }
    }
    const refreshRate = config.options?.refreshRate;
    if (refreshRate !== undefined) {
        if (typeof refreshRate !== 'number' || !Number.isInteger(refreshRate)) {
            warnings.push(`options.refreshRate ${forLog(refreshRate)} is invalid; using default ${settings_1.DEFAULT_REFRESH_RATE_SEC}.`);
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
 * Zone defaults to 1 when omitted. An explicit zone other than 1 or 2 is fatal
 * and throws rather than being silently defaulted.
 *
 * @throws {ConfigValidationError} when any entry fails to resolve
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
        throw new ConfigValidationError(errors);
    }
    return resolved;
}
function tryResolveAccessory(entry, label, errors) {
    if (!entry || typeof entry !== 'object') {
        errors.push(`${label} must be an object.`);
        return undefined;
    }
    if (!(0, types_1.isAccessoryKind)(entry.type)) {
        errors.push(`${label}.type must be "power", "volumePreset", or "sourcePreset".`);
        return undefined;
    }
    if (!isNonEmptyString(entry.name)) {
        errors.push(`${label}.name is required.`);
        return undefined;
    }
    // The name becomes a HomeKit display name and appears in every log line for
    // this accessory, so reject control characters rather than sanitizing them.
    if (hasControlCharacters(entry.name)) {
        errors.push(`${label}.name must not contain control characters.`);
        return undefined;
    }
    if (entry.name.trim().length > settings_1.MAX_ACCESSORY_TEXT_LENGTH) {
        errors.push(`${label}.name must be ${settings_1.MAX_ACCESSORY_TEXT_LENGTH} characters or fewer `
            + '(HomeKit truncates longer names and warns on every restart).');
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
            errors.push(`${label}.source "${forLog(entry.source)}" is not a known input `
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
/** True when `port` is an integer in the valid TCP range. */
function isValidPort(port) {
    return typeof port === 'number'
        && Number.isInteger(port)
        && port >= settings_1.MIN_TCP_PORT
        && port <= settings_1.MAX_TCP_PORT;
}
/** Resolve a usable TCP port, falling back to the AudioControl default. */
function resolvePort(port) {
    return isValidPort(port) ? port : settings_1.DEFAULT_CONTROL_PORT;
}
/**
 * Resolve a usable refresh interval in seconds.
 *
 * Out-of-range values fall back to `fallback` (below minimum / non-integer) or
 * are clamped to {@link MAX_REFRESH_RATE_SEC} (above maximum).
 */
function resolveRefreshRateSec(refreshRate, fallback) {
    if (typeof refreshRate !== 'number' || !Number.isInteger(refreshRate)) {
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