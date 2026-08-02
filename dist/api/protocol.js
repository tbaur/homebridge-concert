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
 * @see AudioControl X/XR Series user manual — Automation Integration
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ANSWER_INVALID_STATE = exports.ANSWER_OK = exports.RC5_POWER_OFF = exports.RC5_POWER_ON = exports.RC5_SYSTEM_ZONE2 = exports.RC5_SYSTEM_ZONE1 = exports.MAX_VOLUME = exports.MIN_VOLUME = exports.VOLUME_QUERY = exports.POWER_QUERY = exports.POWER_ON = exports.POWER_STANDBY = exports.COMMAND_RC5 = exports.COMMAND_VOLUME = exports.COMMAND_POWER = exports.FRAME_END = exports.FRAME_START = void 0;
exports.buildRequest = buildRequest;
exports.rc5SystemForZone = rc5SystemForZone;
exports.buildRc5 = buildRc5;
exports.buildPowerOn = buildPowerOn;
exports.buildPowerStandby = buildPowerStandby;
exports.buildPowerQuery = buildPowerQuery;
exports.buildVolumeQuery = buildVolumeQuery;
exports.buildVolumeSet = buildVolumeSet;
exports.tryParseResponse = tryParseResponse;
exports.describeAnswerCode = describeAnswerCode;
exports.isPowerOn = isPowerOn;
exports.parseVolume = parseVolume;
exports.formatFrame = formatFrame;
const errors_1 = require("../errors");
const settings_1 = require("../settings");
Object.defineProperty(exports, "MAX_VOLUME", { enumerable: true, get: function () { return settings_1.MAX_VOLUME; } });
Object.defineProperty(exports, "MIN_VOLUME", { enumerable: true, get: function () { return settings_1.MIN_VOLUME; } });
/** Start-of-frame byte (`!`). */
exports.FRAME_START = 0x21;
/** End-of-frame byte (carriage return). */
exports.FRAME_END = 0x0D;
/** Power / standby status command code (query + status responses). */
exports.COMMAND_POWER = 0x00;
/** Absolute volume set / query command code. */
exports.COMMAND_VOLUME = 0x0D;
/** Simulate RC5 IR command (used for discrete power on/off). */
exports.COMMAND_RC5 = 0x08;
/** Enter standby (status / legacy set data byte). */
exports.POWER_STANDBY = 0x00;
/** Power on (status / legacy set data byte). */
exports.POWER_ON = 0x01;
/** Request current power state (query sentinel). */
exports.POWER_QUERY = 0xF0;
/** Request current volume (query sentinel). */
exports.VOLUME_QUERY = 0xF0;
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
/** Human-readable names for known non-OK answer codes. */
const ANSWER_CODE_NAMES = {
    0x82: 'incorrect zone',
    0x83: 'incorrect command',
    0x84: 'incorrect parameter',
    [exports.ANSWER_INVALID_STATE]: 'invalid command in current state',
    0x86: 'incorrect data length',
};
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
    if (!Number.isInteger(command) || command < 0 || command > 0xFF) {
        throw new RangeError(`Command must be a byte (0–255), got ${command}`);
    }
    if (data.length > 255) {
        throw new RangeError(`Data length must be ≤ 255, got ${data.length}`);
    }
    const frame = Buffer.alloc(5 + data.length);
    frame[0] = exports.FRAME_START;
    frame[1] = zone;
    frame[2] = command;
    frame[3] = data.length;
    if (data.length > 0) {
        data.copy(frame, 4);
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
        if (buffer.length < start + 6) {
            return null;
        }
        const dataLength = buffer[start + 4];
        const totalLength = 6 + dataLength;
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
                zone: buffer[start + 1],
                command: buffer[start + 2],
                answerCode: buffer[start + 3],
                data: Buffer.from(buffer.subarray(start + 5, endIndex)),
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
    const name = ANSWER_CODE_NAMES[answerCode];
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
    if (data.length < 1) {
        throw new errors_1.ProtocolError('Power response data is empty');
    }
    if (data[0] === exports.POWER_ON) {
        return true;
    }
    if (data[0] === exports.POWER_STANDBY) {
        return false;
    }
    throw new errors_1.ProtocolError(`Unexpected power state byte 0x${data[0].toString(16)}`);
}
/**
 * Interpret a volume-command response data byte as a level 0–99.
 *
 * @throws {ProtocolError} when the payload is empty or out of range
 */
function parseVolume(data) {
    if (data.length < 1) {
        throw new errors_1.ProtocolError('Volume response data is empty');
    }
    const level = data[0];
    if (level < settings_1.MIN_VOLUME || level > settings_1.MAX_VOLUME) {
        throw new errors_1.ProtocolError(`Unexpected volume byte 0x${level.toString(16)}`);
    }
    return level;
}
/** Hex dump of a frame for debug logging (no newlines). */
function formatFrame(frame) {
    return [...frame].map((byte) => byte.toString(16).padStart(2, '0')).join(' ');
}
//# sourceMappingURL=protocol.js.map