"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Input / source catalog for AudioControl Concert XR (family protocol).
 *
 * Source *query* uses command 0x1D. Source *set* uses Simulate RC5 IR (0x08)
 * with discrete source keys — matching power on/off.
 *
 * Codes come from the shared Arcam/AudioControl X/XR automation family and
 * should be verified on Concert XR before treating as production-proven.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SOURCE_LABELS = exports.SOURCE_IDS = exports.SOURCE_DEFINITIONS = void 0;
exports.resolveSourceDefinition = resolveSourceDefinition;
exports.sourceFromQueryCode = sourceFromQueryCode;
exports.rc5CommandForSource = rc5CommandForSource;
exports.sourceSupportsZone = sourceSupportsZone;
/**
 * Supported inputs for `sourcePreset` accessories.
 *
 * Query codes: 0x1D response Data. RC5: system 16 (Z1) / 23 (Z2).
 */
exports.SOURCE_DEFINITIONS = [
    { id: 'cd', label: 'CD', queryCode: 0x01, rc5Zone1: 0x76, rc5Zone2: 0x06 },
    { id: 'bd', label: 'BD', queryCode: 0x02, rc5Zone1: 0x62, rc5Zone2: 0x07 },
    { id: 'av', label: 'AV', queryCode: 0x03, rc5Zone1: 0x5E, rc5Zone2: 0x09 },
    { id: 'sat', label: 'SAT', queryCode: 0x04, rc5Zone1: 0x1B, rc5Zone2: 0x14 },
    { id: 'pvr', label: 'PVR', queryCode: 0x05, rc5Zone1: 0x60, rc5Zone2: 0x0F },
    { id: 'uhd', label: 'UHD', queryCode: 0x06, rc5Zone1: 0x7D, rc5Zone2: 0x17 },
    { id: 'aux', label: 'AUX', queryCode: 0x08, rc5Zone1: 0x63, rc5Zone2: 0x0D },
    { id: 'display', label: 'DISPLAY', queryCode: 0x09, rc5Zone1: 0x3A },
    { id: 'fm', label: 'FM', queryCode: 0x0B, rc5Zone1: 0x1C, rc5Zone2: 0x0E },
    { id: 'dab', label: 'DAB', queryCode: 0x0C, rc5Zone1: 0x48, rc5Zone2: 0x10 },
    { id: 'net', label: 'NET', queryCode: 0x0E, rc5Zone1: 0x5C, rc5Zone2: 0x13 },
    { id: 'stb', label: 'STB', queryCode: 0x10, rc5Zone1: 0x64, rc5Zone2: 0x08 },
    { id: 'game', label: 'GAME', queryCode: 0x11, rc5Zone1: 0x61, rc5Zone2: 0x0B },
    { id: 'bt', label: 'BT', queryCode: 0x12, rc5Zone1: 0x7A, rc5Zone2: 0x16 },
];
const BY_ID = new Map(exports.SOURCE_DEFINITIONS.map((source) => [source.id, source]));
const BY_QUERY = new Map(exports.SOURCE_DEFINITIONS.map((source) => [source.queryCode, source]));
/** All accepted `accessories[].source` values (lowercase ids). */
exports.SOURCE_IDS = exports.SOURCE_DEFINITIONS.map((s) => s.id);
/** Labels for Homebridge UI / docs (uppercase front-panel names). */
exports.SOURCE_LABELS = exports.SOURCE_DEFINITIONS.map((s) => s.label);
/**
 * Resolve a config source string (case-insensitive id or label) to a definition.
 *
 * Accepts `"cd"`, `"CD"`, `"Cd"`, etc.
 */
function resolveSourceDefinition(value) {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
        return undefined;
    }
    const lower = trimmed.toLowerCase();
    const byId = BY_ID.get(lower);
    if (byId) {
        return byId;
    }
    return exports.SOURCE_DEFINITIONS.find((source) => source.label.toLowerCase() === lower);
}
/** Look up a source by its 0x1D query/response byte. */
function sourceFromQueryCode(code) {
    return BY_QUERY.get(code);
}
/**
 * RC5 command byte for selecting `source` in the given automation zone.
 *
 * @throws {RangeError} when the source has no discrete RC5 for that zone
 */
function rc5CommandForSource(source, zone) {
    if (zone === 1) {
        return source.rc5Zone1;
    }
    if (zone === 2) {
        if (source.rc5Zone2 === undefined) {
            throw new RangeError(`Source "${source.label}" has no Zone 2 RC5 select code`);
        }
        return source.rc5Zone2;
    }
    throw new RangeError(`Zone must be 1 or 2, got ${zone}`);
}
/** True when `source` can be selected in the given zone via discrete RC5. */
function sourceSupportsZone(source, zone) {
    if (zone === 1) {
        return true;
    }
    if (zone === 2) {
        return source.rc5Zone2 !== undefined;
    }
    return false;
}
//# sourceMappingURL=sources.js.map