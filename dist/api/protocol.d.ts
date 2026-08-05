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
import { type SourceDefinition, type SourceId } from './sources';
/** Start-of-frame byte (`!`). */
export declare const FRAME_START = 33;
/** End-of-frame byte (carriage return). */
export declare const FRAME_END = 13;
/** Power / standby status command code (query + status responses). */
export declare const COMMAND_POWER = 0;
/** Absolute volume set / query command code. */
export declare const COMMAND_VOLUME = 13;
/** Current source / input query command code. */
export declare const COMMAND_SOURCE = 29;
/** Simulate RC5 IR command (used for discrete power on/off and source select). */
export declare const COMMAND_RC5 = 8;
/** Enter standby (status / legacy set data byte). */
export declare const POWER_STANDBY = 0;
/** Power on (status / legacy set data byte). */
export declare const POWER_ON = 1;
/** Request current power state (query sentinel). */
export declare const POWER_QUERY = 240;
/** Request current volume (query sentinel). */
export declare const VOLUME_QUERY = 240;
/** Request current source / input (query sentinel). */
export declare const SOURCE_QUERY = 240;
/** Zone 2 source status: follow Zone 1 (not a discrete input). */
export declare const SOURCE_FOLLOW_ZONE1 = 0;
export type { SourceDefinition, SourceId };
export { SOURCE_DEFINITIONS, SOURCE_LABELS, rc5CommandForSource, resolveSourceDefinition, sourceFromQueryCode, sourceSupportsZone, } from './sources';
/** RC5 system code for Zone 1 advanced / discrete functions. */
export declare const RC5_SYSTEM_ZONE1 = 16;
/** RC5 system code for Zone 2. */
export declare const RC5_SYSTEM_ZONE2 = 23;
/** Discrete RC5 Power On (16-123 / 23-123). */
export declare const RC5_POWER_ON = 123;
/** Discrete RC5 Power Off (16-124 / 23-124). */
export declare const RC5_POWER_OFF = 124;
/** Answer code: status update / no problems. */
export declare const ANSWER_OK = 0;
/**
 * Answer code: command not valid in the receiver's current state.
 * Common while waking from standby before the control plane accepts volume.
 */
export declare const ANSWER_INVALID_STATE = 133;
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
/** RC5 system byte for the given automation zone. */
export declare function rc5SystemForZone(zone: number): number;
/**
 * Build a Simulate RC5 IR request.
 *
 * @param zone - Automation zone (1 or 2) — also selects the RC5 system code
 * @param system - RC5 system code (Data1)
 * @param command - RC5 command code (Data2)
 */
export declare function buildRc5(zone: number, system: number, command: number): Buffer;
/**
 * Build a discrete power-on request (RC5 Power On).
 *
 * AudioControl docs emphasize IR simulation for control; Power (0x00) is used
 * for status query/response and may not accept a direct set on X/XR units.
 */
export declare function buildPowerOn(zone: number): Buffer;
/** Build a discrete power-off / standby request (RC5 Power Off). */
export declare function buildPowerStandby(zone: number): Buffer;
/** Build a power-state query for the given zone. */
export declare function buildPowerQuery(zone: number): Buffer;
/** Build a volume-state query for the given zone. */
export declare function buildVolumeQuery(zone: number): Buffer;
/**
 * Build an absolute volume set for the given zone.
 *
 * @param zone - Zone number (1 or 2)
 * @param level - Volume 0–99 (`0x00`–`0x63`)
 */
export declare function buildVolumeSet(zone: number, level: number): Buffer;
/** Build a current-source query for the given zone. */
export declare function buildSourceQuery(zone: number): Buffer;
/**
 * Build a discrete source-select request (RC5 source key).
 *
 * @param zone - Automation zone (1 or 2)
 * @param source - Source definition or config id / label
 */
export declare function buildSourceSet(zone: number, source: SourceDefinition | string): Buffer;
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
/**
 * Interpret a volume-command response data byte as a level 0–99.
 *
 * @throws {ProtocolError} when the payload is empty or out of range
 */
export declare function parseVolume(data: Buffer): number;
/**
 * Interpret a source-command (0x1D) response data byte as a known input.
 *
 * Zone 2 “Follow Zone 1” ({@link SOURCE_FOLLOW_ZONE1}) is not a discrete
 * input — callers that need the effective source should resolve Zone 1.
 *
 * @throws {ProtocolError} when the payload is empty, Follow Zone 1, or unknown
 */
export declare function parseSource(data: Buffer): SourceDefinition;
/** True when 0x1D data is Zone 2 “Follow Zone 1”. */
export declare function isSourceFollowZone1(data: Buffer): boolean;
/** Hex dump of a frame for debug logging (no newlines). */
export declare function formatFrame(frame: Buffer): string;
//# sourceMappingURL=protocol.d.ts.map