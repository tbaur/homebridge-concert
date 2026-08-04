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
 * RC5 IR (0x08) with discrete source keys — see {@link ./sources}.
 *
 * @see AudioControl X/XR Series user manual — Automation Integration
 */

import { ProtocolError } from '../errors'
import { MAX_VOLUME, MIN_VOLUME } from '../settings'
import {
  rc5CommandForSource,
  resolveSourceDefinition,
  sourceFromQueryCode,
  type SourceDefinition,
  type SourceId,
} from './sources'

/** Start-of-frame byte (`!`). */
export const FRAME_START = 0x21

/** End-of-frame byte (carriage return). */
export const FRAME_END = 0x0D

/** Power / standby status command code (query + status responses). */
export const COMMAND_POWER = 0x00

/** Absolute volume set / query command code. */
export const COMMAND_VOLUME = 0x0D

/** Current source / input query command code. */
export const COMMAND_SOURCE = 0x1D

/** Simulate RC5 IR command (used for discrete power on/off and source select). */
export const COMMAND_RC5 = 0x08

/** Enter standby (status / legacy set data byte). */
export const POWER_STANDBY = 0x00

/** Power on (status / legacy set data byte). */
export const POWER_ON = 0x01

/** Request current power state (query sentinel). */
export const POWER_QUERY = 0xF0

/** Request current volume (query sentinel). */
export const VOLUME_QUERY = 0xF0

/** Request current source / input (query sentinel). */
export const SOURCE_QUERY = 0xF0

/** Zone 2 source status: follow Zone 1 (not a discrete input). */
export const SOURCE_FOLLOW_ZONE1 = 0x00

/** Re-export volume bounds for protocol callers (single source: settings). */
export { MIN_VOLUME, MAX_VOLUME }

export type { SourceDefinition, SourceId }
export {
  SOURCE_DEFINITIONS,
  SOURCE_IDS,
  SOURCE_LABELS,
  rc5CommandForSource,
  resolveSourceDefinition,
  sourceFromQueryCode,
  sourceSupportsZone,
} from './sources'

/** RC5 system code for Zone 1 advanced / discrete functions. */
export const RC5_SYSTEM_ZONE1 = 0x10

/** RC5 system code for Zone 2. */
export const RC5_SYSTEM_ZONE2 = 0x17

/** Discrete RC5 Power On (16-123 / 23-123). */
export const RC5_POWER_ON = 0x7B

/** Discrete RC5 Power Off (16-124 / 23-124). */
export const RC5_POWER_OFF = 0x7C

/** Answer code: status update / no problems. */
export const ANSWER_OK = 0x00

/**
 * Answer code: command not valid in the receiver's current state.
 * Common while waking from standby before the control plane accepts volume.
 */
export const ANSWER_INVALID_STATE = 0x85

/** Human-readable names for known non-OK answer codes. */
const ANSWER_CODE_NAMES: Readonly<Record<number, string>> = {
  0x82: 'incorrect zone',
  0x83: 'incorrect command',
  0x84: 'incorrect parameter',
  [ANSWER_INVALID_STATE]: 'invalid command in current state',
  0x86: 'incorrect data length',
}

/** Parsed response frame from the receiver. */
export interface ProtocolResponse {
  zone: number
  command: number
  answerCode: number
  data: Buffer
}

/**
 * Build a request frame: St Zn Cc Dl Data... Et.
 *
 * @param zone - Zone number (1 or 2)
 * @param command - Command code
 * @param data - Command parameters (may be empty)
 */
export function buildRequest(zone: number, command: number, data: Buffer = Buffer.alloc(0)): Buffer {
  if (!Number.isInteger(zone) || zone < 1 || zone > 2) {
    throw new RangeError(`Zone must be 1 or 2, got ${zone}`)
  }
  if (!Number.isInteger(command) || command < 0 || command > 0xFF) {
    throw new RangeError(`Command must be a byte (0–255), got ${command}`)
  }
  if (data.length > 255) {
    throw new RangeError(`Data length must be ≤ 255, got ${data.length}`)
  }

  const frame = Buffer.alloc(5 + data.length)
  frame[0] = FRAME_START
  frame[1] = zone
  frame[2] = command
  frame[3] = data.length
  if (data.length > 0) {
    data.copy(frame, 4)
  }
  frame[frame.length - 1] = FRAME_END
  return frame
}

/** RC5 system byte for the given automation zone. */
export function rc5SystemForZone(zone: number): number {
  if (zone === 2) {
    return RC5_SYSTEM_ZONE2
  }
  if (zone === 1) {
    return RC5_SYSTEM_ZONE1
  }
  throw new RangeError(`Zone must be 1 or 2, got ${zone}`)
}

/**
 * Build a Simulate RC5 IR request.
 *
 * @param zone - Automation zone (1 or 2) — also selects the RC5 system code
 * @param system - RC5 system code (Data1)
 * @param command - RC5 command code (Data2)
 */
export function buildRc5(zone: number, system: number, command: number): Buffer {
  return buildRequest(zone, COMMAND_RC5, Buffer.from([system, command]))
}

/**
 * Build a discrete power-on request (RC5 Power On).
 *
 * AudioControl docs emphasize IR simulation for control; Power (0x00) is used
 * for status query/response and may not accept a direct set on X/XR units.
 */
export function buildPowerOn(zone: number): Buffer {
  return buildRc5(zone, rc5SystemForZone(zone), RC5_POWER_ON)
}

/** Build a discrete power-off / standby request (RC5 Power Off). */
export function buildPowerStandby(zone: number): Buffer {
  return buildRc5(zone, rc5SystemForZone(zone), RC5_POWER_OFF)
}

/** Build a power-state query for the given zone. */
export function buildPowerQuery(zone: number): Buffer {
  return buildRequest(zone, COMMAND_POWER, Buffer.from([POWER_QUERY]))
}

/** Build a volume-state query for the given zone. */
export function buildVolumeQuery(zone: number): Buffer {
  return buildRequest(zone, COMMAND_VOLUME, Buffer.from([VOLUME_QUERY]))
}

/**
 * Build an absolute volume set for the given zone.
 *
 * @param zone - Zone number (1 or 2)
 * @param level - Volume 0–99 (`0x00`–`0x63`)
 */
export function buildVolumeSet(zone: number, level: number): Buffer {
  if (!Number.isInteger(level) || level < MIN_VOLUME || level > MAX_VOLUME) {
    throw new RangeError(`Volume must be an integer ${MIN_VOLUME}–${MAX_VOLUME}, got ${level}`)
  }
  return buildRequest(zone, COMMAND_VOLUME, Buffer.from([level]))
}

/** Build a current-source query for the given zone. */
export function buildSourceQuery(zone: number): Buffer {
  return buildRequest(zone, COMMAND_SOURCE, Buffer.from([SOURCE_QUERY]))
}

/**
 * Build a discrete source-select request (RC5 source key).
 *
 * @param zone - Automation zone (1 or 2)
 * @param source - Source definition or config id / label
 */
export function buildSourceSet(zone: number, source: SourceDefinition | string): Buffer {
  const definition = typeof source === 'string'
    ? resolveSourceDefinition(source)
    : source
  if (!definition) {
    throw new RangeError(`Unknown source "${String(source)}"`)
  }
  return buildRc5(zone, rc5SystemForZone(zone), rc5CommandForSource(definition, zone))
}

/**
 * Extract the first complete response frame from a buffer, if present.
 *
 * Returns the parsed frame and the number of bytes consumed (including any
 * leading junk before St), or `null` when a complete frame is not yet available.
 */
export function tryParseResponse(buffer: Buffer): { response: ProtocolResponse; consumed: number } | null {
  let searchFrom = 0
  while (searchFrom < buffer.length) {
    const start = buffer.indexOf(FRAME_START, searchFrom)
    if (start < 0) {
      return null
    }

    // Minimum response: St Zn Cc Ac Dl Et  (Dl = 0)
    if (buffer.length < start + 6) {
      return null
    }

    const dataLength = buffer[start + 4]
    const totalLength = 6 + dataLength
    if (buffer.length < start + totalLength) {
      return null
    }

    const endIndex = start + totalLength - 1
    if (buffer[endIndex] !== FRAME_END) {
      // Corrupt frame: skip this start byte and keep looking.
      searchFrom = start + 1
      continue
    }

    return {
      response: {
        zone: buffer[start + 1],
        command: buffer[start + 2],
        answerCode: buffer[start + 3],
        data: Buffer.from(buffer.subarray(start + 5, endIndex)),
      },
      consumed: start + totalLength,
    }
  }

  return null
}

/** Describe an answer code for logs and error messages. */
export function describeAnswerCode(answerCode: number): string {
  if (answerCode === ANSWER_OK) {
    return 'ok'
  }
  const name = ANSWER_CODE_NAMES[answerCode]
  if (name) {
    return `0x${answerCode.toString(16)} (${name})`
  }
  return `0x${answerCode.toString(16)}`
}

/**
 * Interpret a power-command response data byte as on/off.
 *
 * @returns `true` when powered on, `false` when in standby
 * @throws {ProtocolError} when the payload is empty or not a known power state
 */
export function isPowerOn(data: Buffer): boolean {
  if (data.length < 1) {
    throw new ProtocolError('Power response data is empty')
  }
  if (data[0] === POWER_ON) {
    return true
  }
  if (data[0] === POWER_STANDBY) {
    return false
  }
  throw new ProtocolError(`Unexpected power state byte 0x${data[0].toString(16)}`)
}

/**
 * Interpret a volume-command response data byte as a level 0–99.
 *
 * @throws {ProtocolError} when the payload is empty or out of range
 */
export function parseVolume(data: Buffer): number {
  if (data.length < 1) {
    throw new ProtocolError('Volume response data is empty')
  }
  const level = data[0]
  if (level < MIN_VOLUME || level > MAX_VOLUME) {
    throw new ProtocolError(`Unexpected volume byte 0x${level.toString(16)}`)
  }
  return level
}

/**
 * Interpret a source-command (0x1D) response data byte as a known input.
 *
 * Zone 2 “Follow Zone 1” ({@link SOURCE_FOLLOW_ZONE1}) is not a discrete
 * input — callers that need the effective source should resolve Zone 1.
 *
 * @throws {ProtocolError} when the payload is empty, Follow Zone 1, or unknown
 */
export function parseSource(data: Buffer): SourceDefinition {
  if (data.length < 1) {
    throw new ProtocolError('Source response data is empty')
  }
  const code = data[0]
  if (code === SOURCE_FOLLOW_ZONE1) {
    throw new ProtocolError('Source is Follow Zone 1 (not a discrete input)')
  }
  const source = sourceFromQueryCode(code)
  if (!source) {
    throw new ProtocolError(`Unexpected source byte 0x${code.toString(16)}`)
  }
  return source
}

/** True when 0x1D data is Zone 2 “Follow Zone 1”. */
export function isSourceFollowZone1(data: Buffer): boolean {
  return data.length >= 1 && data[0] === SOURCE_FOLLOW_ZONE1
}

/** Hex dump of a frame for debug logging (no newlines). */
export function formatFrame(frame: Buffer): string {
  return [...frame].map((byte) => byte.toString(16).padStart(2, '0')).join(' ')
}
