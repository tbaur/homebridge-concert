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

import { ProtocolError } from '../errors'

/** Start-of-frame byte (`!`). */
export const FRAME_START = 0x21

/** End-of-frame byte (carriage return). */
export const FRAME_END = 0x0D

/** Power / standby command code. */
export const COMMAND_POWER = 0x00

/** Enter standby. */
export const POWER_STANDBY = 0x00

/** Power on. */
export const POWER_ON = 0x01

/** Request current power state (query sentinel). */
export const POWER_QUERY = 0xF0

/** Answer code: status update / no problems. */
export const ANSWER_OK = 0x00

/** Human-readable names for known non-OK answer codes. */
const ANSWER_CODE_NAMES: Readonly<Record<number, string>> = {
  0x82: 'incorrect zone',
  0x83: 'incorrect command',
  0x84: 'incorrect parameter',
  0x85: 'invalid command in current state',
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

/** Build a power-on request for the given zone. */
export function buildPowerOn(zone: number): Buffer {
  return buildRequest(zone, COMMAND_POWER, Buffer.from([POWER_ON]))
}

/** Build a standby (power-off) request for the given zone. */
export function buildPowerStandby(zone: number): Buffer {
  return buildRequest(zone, COMMAND_POWER, Buffer.from([POWER_STANDBY]))
}

/** Build a power-state query for the given zone. */
export function buildPowerQuery(zone: number): Buffer {
  return buildRequest(zone, COMMAND_POWER, Buffer.from([POWER_QUERY]))
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

/** Hex dump of a frame for debug logging (no newlines). */
export function formatFrame(frame: Buffer): string {
  return [...frame].map((byte) => byte.toString(16).padStart(2, '0')).join(' ')
}
