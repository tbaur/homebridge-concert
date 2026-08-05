"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview AudioControl X/XR series IP/RS232 frame builders and parsers.
 *
 * Wire format (same over RS232 and TCP port 50000):
 *   Request:  St Zn Cc Dl Data... Et
 *   Response: St Zn Cc Ac Dl Data... Et
 *
 * where St=0x21, Et=0x0D.
 *
 * Power *query* uses command 0x00 with data 0xF0. Power *set* uses Simulate
 * RC5 IR (0x08) with discrete Power On / Power Off codes — X/XR units treat
 * Power (0x00) as query-oriented and may not answer a direct set.
 *
 * Volume uses command 0x0D with data 0x00–0x63 (0–99) to set, or 0xF0 to query.
 *
 * Source *query* uses command 0x1D with data 0xF0. Source *set* uses Simulate
 * RC5 IR (0x08) with discrete source keys — see `./sources.ts`.
 *
 * @see AudioControl X/XR Series user manual — Automation Integration
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ANSWER_INVALID_STATE = exports.ANSWER_OK = exports.RC5_POWER_OFF = exports.RC5_POWER_ON = exports.RC5_SYSTEM_ZONE2 = exports.RC5_SYSTEM_ZONE1 = exports.sourceSupportsZone = exports.sourceFromQueryCode = exports.resolveSourceDefinition = exports.rc5CommandForSource = exports.SOURCE_LABELS = exports.SOURCE_DEFINITIONS = exports.SOURCE_FOLLOW_ZONE1 = exports.SOURCE_QUERY = exports.VOLUME_QUERY = exports.POWER_QUERY = exports.POWER_ON = exports.POWER_STANDBY = exports.COMMAND_RC5 = exports.COMMAND_SOURCE = exports.COMMAND_VOLUME = exports.COMMAND_POWER = exports.FRAME_END = exports.FRAME_START = void 0;
exports.buildRequest = buildRequest;
exports.rc5SystemForZone = rc5SystemForZone;
exports.buildRc5 = buildRc5;
exports.buildPowerOn = buildPowerOn;
exports.buildPowerStandby = buildPowerStandby;
exports.buildPowerQuery = buildPowerQuery;
exports.buildVolumeQuery = buildVolumeQuery;
exports.buildVolumeSet = buildVolumeSet;
exports.buildSourceQuery = buildSourceQuery;
exports.buildSourceSet = buildSourceSet;
exports.tryParseResponse = tryParseResponse;
exports.describeAnswerCode = describeAnswerCode;
exports.isPowerOn = isPowerOn;
exports.parseVolume = parseVolume;
exports.parseSource = parseSource;
exports.isSourceFollowZone1 = isSourceFollowZone1;
exports.formatFrame = formatFrame;
const errors_1 = require("../errors");
const settings_1 = require("../settings");
const sources_1 = require("./sources");
/** Start-of-frame byte (`!`). */
exports.FRAME_START = 0x21;
/** End-of-frame byte (carriage return). */
exports.FRAME_END = 0x0D;
/** Largest value a single protocol byte can hold, and so the longest Data run. */
const MAX_BYTE = 0xFF;
/** Non-data bytes in a request: St Zn Cc Dl … Et. */
const REQUEST_OVERHEAD_BYTES = 5;
/** Index of the first Data byte in a request. */
const REQUEST_DATA_OFFSET = 4;
/** Non-data bytes in a response: St Zn Cc Ac Dl … Et. */
const RESPONSE_OVERHEAD_BYTES = 6;
/** Offset of the first Data byte within a response frame. */
const RESPONSE_DATA_OFFSET = 5;
/** Power / standby status command code (query + status responses). */
exports.COMMAND_POWER = 0x00;
/** Absolute volume set / query command code. */
exports.COMMAND_VOLUME = 0x0D;
/** Current source / input query command code. */
exports.COMMAND_SOURCE = 0x1D;
/** Simulate RC5 IR command (used for discrete power on/off and source select). */
exports.COMMAND_RC5 = 0x08;
/** Enter standby (status / legacy set data byte). */
exports.POWER_STANDBY = 0x00;
/** Power on (status / legacy set data byte). */
exports.POWER_ON = 0x01;
/** Request current power state (query sentinel). */
exports.POWER_QUERY = 0xF0;
/** Request current volume (query sentinel). */
exports.VOLUME_QUERY = 0xF0;
/** Request current source / input (query sentinel). */
exports.SOURCE_QUERY = 0xF0;
/** Zone 2 source status: follow Zone 1 (not a discrete input). */
exports.SOURCE_FOLLOW_ZONE1 = 0x00;
var sources_2 = require("./sources");
Object.defineProperty(exports, "SOURCE_DEFINITIONS", { enumerable: true, get: function () { return sources_2.SOURCE_DEFINITIONS; } });
Object.defineProperty(exports, "SOURCE_LABELS", { enumerable: true, get: function () { return sources_2.SOURCE_LABELS; } });
Object.defineProperty(exports, "rc5CommandForSource", { enumerable: true, get: function () { return sources_2.rc5CommandForSource; } });
Object.defineProperty(exports, "resolveSourceDefinition", { enumerable: true, get: function () { return sources_2.resolveSourceDefinition; } });
Object.defineProperty(exports, "sourceFromQueryCode", { enumerable: true, get: function () { return sources_2.sourceFromQueryCode; } });
Object.defineProperty(exports, "sourceSupportsZone", { enumerable: true, get: function () { return sources_2.sourceSupportsZone; } });
/** RC5 system code for Zone 1 advanced / discrete functions. */
exports.RC5_SYSTEM_ZONE1 = 0x10;
/** RC5 system code for Zone 2. */
exports.RC5_SYSTEM_ZONE2 = 0x17;
/** Discrete RC5 Power On (16-123 / 23-123). */
exports.RC5_POWER_ON = 0x7B;
/** Discrete RC5 Power Off (16-124 / 23-124). */
exports.RC5_POWER_OFF = 0x7C;
/** Answer code: status update / no problems. */
exports.ANSWER_OK = 0x00;
/**
 * Answer code: command not valid in the receiver's current state.
 * Common while waking from standby before the control plane accepts volume.
 */
exports.ANSWER_INVALID_STATE = 0x85;
/**
 * Human-readable names for known non-OK answer codes.
 *
 * A Map (not an object literal) because the key comes straight off the wire —
 * this keeps lookups away from `Object.prototype`, matching {@link sourceFromQueryCode}.
 */
const ANSWER_CODE_NAMES = new Map([
    [0x82, 'incorrect zone'],
    [0x83, 'incorrect command'],
    [0x84, 'incorrect parameter'],
    [exports.ANSWER_INVALID_STATE, 'invalid command in current state'],
    [0x86, 'incorrect data length'],
]);
/**
 * Build a request frame: St Zn Cc Dl Data... Et.
 *
 * @param zone - Zone number (1 or 2)
 * @param command - Command code
 * @param data - Command parameters (may be empty)
 */
function buildRequest(zone, command, data = Buffer.alloc(0)) {
    if (!Number.isInteger(zone) || zone < 1 || zone > 2) {
        throw new RangeError(`Zone must be 1 or 2, got ${zone}`);
    }
    if (!Number.isInteger(command) || command < 0 || command > MAX_BYTE) {
        throw new RangeError(`Command must be a byte (0–${MAX_BYTE}), got ${command}`);
    }
    if (data.length > MAX_BYTE) {
        throw new RangeError(`Data length must be ≤ ${MAX_BYTE}, got ${data.length}`);
    }
    const frame = Buffer.alloc(REQUEST_OVERHEAD_BYTES + data.length);
    frame[0] = exports.FRAME_START;
    frame[1] = zone;
    frame[2] = command;
    frame[3] = data.length;
    if (data.length > 0) {
        data.copy(frame, REQUEST_DATA_OFFSET);
    }
    frame[frame.length - 1] = exports.FRAME_END;
    return frame;
}
/** RC5 system byte for the given automation zone. */
function rc5SystemForZone(zone) {
    if (zone === 2) {
        return exports.RC5_SYSTEM_ZONE2;
    }
    if (zone === 1) {
        return exports.RC5_SYSTEM_ZONE1;
    }
    throw new RangeError(`Zone must be 1 or 2, got ${zone}`);
}
/**
 * Build a Simulate RC5 IR request.
 *
 * @param zone - Automation zone (1 or 2) — also selects the RC5 system code
 * @param system - RC5 system code (Data1)
 * @param command - RC5 command code (Data2)
 */
function buildRc5(zone, system, command) {
    return buildRequest(zone, exports.COMMAND_RC5, Buffer.from([system, command]));
}
/**
 * Build a discrete power-on request (RC5 Power On).
 *
 * AudioControl docs emphasize IR simulation for control; Power (0x00) is used
 * for status query/response and may not accept a direct set on X/XR units.
 */
function buildPowerOn(zone) {
    return buildRc5(zone, rc5SystemForZone(zone), exports.RC5_POWER_ON);
}
/** Build a discrete power-off / standby request (RC5 Power Off). */
function buildPowerStandby(zone) {
    return buildRc5(zone, rc5SystemForZone(zone), exports.RC5_POWER_OFF);
}
/** Build a power-state query for the given zone. */
function buildPowerQuery(zone) {
    return buildRequest(zone, exports.COMMAND_POWER, Buffer.from([exports.POWER_QUERY]));
}
/** Build a volume-state query for the given zone. */
function buildVolumeQuery(zone) {
    return buildRequest(zone, exports.COMMAND_VOLUME, Buffer.from([exports.VOLUME_QUERY]));
}
/**
 * Build an absolute volume set for the given zone.
 *
 * @param zone - Zone number (1 or 2)
 * @param level - Volume 0–99 (`0x00`–`0x63`)
 */
function buildVolumeSet(zone, level) {
    if (!Number.isInteger(level) || level < settings_1.MIN_VOLUME || level > settings_1.MAX_VOLUME) {
        throw new RangeError(`Volume must be an integer ${settings_1.MIN_VOLUME}–${settings_1.MAX_VOLUME}, got ${level}`);
    }
    return buildRequest(zone, exports.COMMAND_VOLUME, Buffer.from([level]));
}
/** Build a current-source query for the given zone. */
function buildSourceQuery(zone) {
    return buildRequest(zone, exports.COMMAND_SOURCE, Buffer.from([exports.SOURCE_QUERY]));
}
/**
 * Build a discrete source-select request (RC5 source key).
 *
 * @param zone - Automation zone (1 or 2)
 * @param source - Source definition or config id / label
 */
function buildSourceSet(zone, source) {
    const definition = typeof source === 'string'
        ? (0, sources_1.resolveSourceDefinition)(source)
        : source;
    if (!definition) {
        throw new RangeError(`Unknown source "${String(source)}"`);
    }
    return buildRc5(zone, rc5SystemForZone(zone), (0, sources_1.rc5CommandForSource)(definition, zone));
}
/**
 * Extract the first complete response frame from a buffer, if present.
 *
 * Returns the parsed frame and the number of bytes consumed (including any
 * leading junk before St), or `null` when a complete frame is not yet available.
 */
function tryParseResponse(buffer) {
    let searchFrom = 0;
    while (searchFrom < buffer.length) {
        const start = buffer.indexOf(exports.FRAME_START, searchFrom);
        if (start < 0) {
            return null;
        }
        // Minimum response: St Zn Cc Ac Dl Et  (Dl = 0)
        if (buffer.length < start + RESPONSE_OVERHEAD_BYTES) {
            return null;
        }
        // The length check above guarantees these header bytes exist; the explicit
        // test is what `noUncheckedIndexedAccess` requires. Throwing rather than
        // returning null keeps a genuine violation diagnosable instead of surfacing
        // as an unexplained request timeout.
        const zone = buffer[start + 1];
        const command = buffer[start + 2];
        const answerCode = buffer[start + 3];
        const dataLength = buffer[start + 4];
        if (zone === undefined
            || command === undefined
            || answerCode === undefined
            || dataLength === undefined) {
            throw new errors_1.ProtocolError('Response header truncated after a length check passed');
        }
        const totalLength = RESPONSE_OVERHEAD_BYTES + dataLength;
        if (buffer.length < start + totalLength) {
            return null;
        }
        const endIndex = start + totalLength - 1;
        if (buffer[endIndex] !== exports.FRAME_END) {
            // Corrupt frame: skip this start byte and keep looking.
            searchFrom = start + 1;
            continue;
        }
        return {
            response: {
                zone,
                command,
                answerCode,
                data: Buffer.from(buffer.subarray(start + RESPONSE_DATA_OFFSET, endIndex)),
            },
            consumed: start + totalLength,
        };
    }
    return null;
}
/** Describe an answer code for logs and error messages. */
function describeAnswerCode(answerCode) {
    if (answerCode === exports.ANSWER_OK) {
        return 'ok';
    }
    const name = ANSWER_CODE_NAMES.get(answerCode);
    if (name) {
        return `0x${answerCode.toString(16)} (${name})`;
    }
    return `0x${answerCode.toString(16)}`;
}
/**
 * Interpret a power-command response data byte as on/off.
 *
 * @returns `true` when powered on, `false` when in standby
 * @throws {ProtocolError} when the payload is empty or not a known power state
 */
function isPowerOn(data) {
    const state = data[0];
    if (state === undefined) {
        throw new errors_1.ProtocolError('Power response data is empty');
    }
    if (state === exports.POWER_ON) {
        return true;
    }
    if (state === exports.POWER_STANDBY) {
        return false;
    }
    throw new errors_1.ProtocolError(`Unexpected power state byte 0x${state.toString(16)}`);
}
/**
 * Interpret a volume-command response data byte as a level 0–99.
 *
 * @throws {ProtocolError} when the payload is empty or out of range
 */
function parseVolume(data) {
    const level = data[0];
    if (level === undefined) {
        throw new errors_1.ProtocolError('Volume response data is empty');
    }
    if (level < settings_1.MIN_VOLUME || level > settings_1.MAX_VOLUME) {
        throw new errors_1.ProtocolError(`Unexpected volume byte 0x${level.toString(16)}`);
    }
    return level;
}
/**
 * Interpret a source-command (0x1D) response data byte as a known input.
 *
 * Zone 2 “Follow Zone 1” ({@link SOURCE_FOLLOW_ZONE1}) is not a discrete
 * input — callers that need the effective source should resolve Zone 1.
 *
 * @throws {ProtocolError} when the payload is empty, Follow Zone 1, or unknown
 */
function parseSource(data) {
    const code = data[0];
    if (code === undefined) {
        throw new errors_1.ProtocolError('Source response data is empty');
    }
    if (code === exports.SOURCE_FOLLOW_ZONE1) {
        throw new errors_1.ProtocolError('Source is Follow Zone 1 (not a discrete input)');
    }
    const source = (0, sources_1.sourceFromQueryCode)(code);
    if (!source) {
        throw new errors_1.ProtocolError(`Unexpected source byte 0x${code.toString(16)}`);
    }
    return source;
}
/** True when 0x1D data is Zone 2 “Follow Zone 1”. */
function isSourceFollowZone1(data) {
    return data.length >= 1 && data[0] === exports.SOURCE_FOLLOW_ZONE1;
}
/** Hex dump of a frame for debug logging (no newlines). */
function formatFrame(frame) {
    return [...frame].map((byte) => byte.toString(16).padStart(2, '0')).join(' ');
}
//# sourceMappingURL=protocol.js.map