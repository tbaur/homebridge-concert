/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 */

import {
  ANSWER_OK,
  COMMAND_POWER,
  FRAME_END,
  FRAME_START,
  POWER_ON,
  POWER_QUERY,
  POWER_STANDBY,
  buildPowerOn,
  buildPowerQuery,
  buildPowerStandby,
  buildRequest,
  describeAnswerCode,
  formatFrame,
  isPowerOn,
  tryParseResponse,
} from '../../src/api/protocol'

describe('buildRequest', () => {
  it('builds a minimal frame with no data', () => {
    const frame = buildRequest(1, 0x04)
    expect([...frame]).toEqual([FRAME_START, 0x01, 0x04, 0x00, FRAME_END])
  })

  it('builds a frame with data bytes', () => {
    const frame = buildRequest(2, COMMAND_POWER, Buffer.from([POWER_ON]))
    expect([...frame]).toEqual([FRAME_START, 0x02, COMMAND_POWER, 0x01, POWER_ON, FRAME_END])
  })

  it('rejects invalid zones', () => {
    expect(() => buildRequest(0, 0x00)).toThrow(RangeError)
    expect(() => buildRequest(3, 0x00)).toThrow(RangeError)
  })

  it('rejects oversized data', () => {
    expect(() => buildRequest(1, 0x00, Buffer.alloc(256))).toThrow(RangeError)
  })
})

describe('power helpers', () => {
  it('builds power on / standby / query frames', () => {
    expect([...buildPowerOn(1)]).toEqual([0x21, 0x01, 0x00, 0x01, POWER_ON, 0x0d])
    expect([...buildPowerStandby(1)]).toEqual([0x21, 0x01, 0x00, 0x01, POWER_STANDBY, 0x0d])
    expect([...buildPowerQuery(1)]).toEqual([0x21, 0x01, 0x00, 0x01, POWER_QUERY, 0x0d])
  })
})

describe('tryParseResponse', () => {
  it('returns null until a full frame arrives', () => {
    expect(tryParseResponse(Buffer.from([0x21, 0x01, 0x00]))).toBeNull()
  })

  it('parses a power-on status response', () => {
    const raw = Buffer.from([0x21, 0x01, 0x00, ANSWER_OK, 0x01, POWER_ON, 0x0d])
    const parsed = tryParseResponse(raw)
    expect(parsed).not.toBeNull()
    expect(parsed!.response).toEqual({
      zone: 1,
      command: COMMAND_POWER,
      answerCode: ANSWER_OK,
      data: Buffer.from([POWER_ON]),
    })
    expect(parsed!.consumed).toBe(7)
  })

  it('skips leading junk before the start byte', () => {
    const raw = Buffer.from([0xff, 0xfe, 0x21, 0x01, 0x00, 0x00, 0x01, 0x00, 0x0d])
    const parsed = tryParseResponse(raw)
    expect(parsed!.response.answerCode).toBe(ANSWER_OK)
    expect(parsed!.consumed).toBe(9)
  })

  it('skips a corrupt frame missing ETR and finds the next', () => {
    // First candidate: St Zn Cc Ac Dl=1 but wrong end byte, then a valid frame.
    const raw = Buffer.from([
      0x21, 0x01, 0x00, 0x00, 0x01, 0x01, 0x00, // corrupt (ends 0x00 not 0x0d)
      0x21, 0x01, 0x00, 0x00, 0x01, 0x01, 0x0d, // valid power-on
    ])
    const parsed = tryParseResponse(raw)
    expect(parsed!.response.data[0]).toBe(POWER_ON)
    expect(parsed!.consumed).toBe(14)
  })
})

describe('isPowerOn / describeAnswerCode / formatFrame', () => {
  it('interprets power data bytes', () => {
    expect(isPowerOn(Buffer.from([POWER_ON]))).toBe(true)
    expect(isPowerOn(Buffer.from([POWER_STANDBY]))).toBe(false)
    expect(() => isPowerOn(Buffer.alloc(0))).toThrow(/empty/)
    expect(() => isPowerOn(Buffer.from([0x99]))).toThrow(/Unexpected power state/)
  })

  it('describes answer codes', () => {
    expect(describeAnswerCode(ANSWER_OK)).toBe('ok')
    expect(describeAnswerCode(0x83)).toContain('incorrect command')
    expect(describeAnswerCode(0x99)).toBe('0x99')
  })

  it('formats frames as hex', () => {
    expect(formatFrame(Buffer.from([0x21, 0x0a]))).toBe('21 0a')
  })
})
