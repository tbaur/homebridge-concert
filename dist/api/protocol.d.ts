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
 * where St=0x21, Et=0x0D. Power is command code 0x00.
 *
 * @see AudioControl X/XR Series user manual — Automation Integration
 */
/** Start-of-frame byte (`!`). */
export declare const FRAME_START = 33;
/** End-of-frame byte (carriage return). */
export declare const FRAME_END = 13;
/** Power / standby command code. */
export declare const COMMAND_POWER = 0;
/** Enter standby. */
export declare const POWER_STANDBY = 0;
/** Power on. */
export declare const POWER_ON = 1;
/** Request current power state (query sentinel). */
export declare const POWER_QUERY = 240;
/** Answer code: status update / no problems. */
export declare const ANSWER_OK = 0;
/** Parsed response frame from the receiver. */
export interface ProtocolResponse {
    zone: number;
    command: number;
    answerCode: number;
    data: Buffer;
}
/**
 * Build a request frame: St Zn Cc Dl Data... Et.
 *
 * @param zone - Zone number (1 or 2)
 * @param command - Command code
 * @param data - Command parameters (may be empty)
 */
export declare function buildRequest(zone: number, command: number, data?: Buffer): Buffer;
/** Build a power-on request for the given zone. */
export declare function buildPowerOn(zone: number): Buffer;
/** Build a standby (power-off) request for the given zone. */
export declare function buildPowerStandby(zone: number): Buffer;
/** Build a power-state query for the given zone. */
export declare function buildPowerQuery(zone: number): Buffer;
/**
 * Extract the first complete response frame from a buffer, if present.
 *
 * Returns the parsed frame and the number of bytes consumed (including any
 * leading junk before St), or `null` when a complete frame is not yet available.
 */
export declare function tryParseResponse(buffer: Buffer): {
    response: ProtocolResponse;
    consumed: number;
} | null;
/** Describe an answer code for logs and error messages. */
export declare function describeAnswerCode(answerCode: number): string;
/**
 * Interpret a power-command response data byte as on/off.
 *
 * @returns `true` when powered on, `false` when in standby
 * @throws {ProtocolError} when the payload is empty or not a known power state
 */
export declare function isPowerOn(data: Buffer): boolean;
/** Hex dump of a frame for debug logging (no newlines). */
export declare function formatFrame(frame: Buffer): string;
//# sourceMappingURL=protocol.d.ts.map