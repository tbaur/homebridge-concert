/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 */

import type { PlatformAccessory } from 'homebridge'

import { ConnectionError, ProtocolError } from '../../src/errors'
import { DEFAULT_MODEL } from '../../src/settings'
import { describeError, describeErrorStack } from '../../src/utils/errors'
import { parseAccessoryContext } from '../../src/utils/context'

function accessoryWithContext(context: unknown): PlatformAccessory {
  return { displayName: 'XR-8S Power', context } as unknown as PlatformAccessory
}

describe('describeError', () => {
  it('surfaces the underlying cause, which is why errors carry one', () => {
    const error = new ConnectionError('Connection to 192.168.1.50:50000 failed: reset', {
      cause: new Error('ECONNRESET'),
    })
    expect(describeError(error)).toBe(
      'Connection to 192.168.1.50:50000 failed: reset (cause: ECONNRESET)',
    )
  })

  it('does not repeat a cause that duplicates the message', () => {
    const error = new ConnectionError('same', { cause: new Error('same') })
    expect(describeError(error)).toBe('same')
  })

  it('handles errors without a cause and non-Error throws', () => {
    expect(describeError(new Error('plain'))).toBe('plain')
    expect(describeError('a string')).toBe('a string')
    expect(describeError(undefined)).toBe('undefined')
  })

  it('returns a stack when there is one', () => {
    expect(describeErrorStack(new Error('boom'))).toContain('boom')
    expect(describeErrorStack('not an error')).toBe('')
  })
})

describe('error types', () => {
  it('keeps the answer code and cause on a ProtocolError', () => {
    const cause = new Error('root')
    const error = new ProtocolError('volume set rejected', { answerCode: 0x85, cause })
    expect(error.name).toBe('ProtocolError')
    expect(error.answerCode).toBe(0x85)
    expect(error.cause).toBe(cause)
  })

  it('omits cause when none was supplied', () => {
    const error = new ProtocolError('no cause')
    expect(error.answerCode).toBeUndefined()
    expect(error.cause).toBeUndefined()
  })
})

describe('parseAccessoryContext', () => {
  it('returns a validated context and defaults the model', () => {
    const context = parseAccessoryContext(accessoryWithContext({
      kind: 'power',
      zone: 2,
    }))
    expect(context.kind).toBe('power')
    expect(context.zone).toBe(2)
    expect(context.model).toBe(DEFAULT_MODEL)
  })

  it('keeps a model that was persisted', () => {
    const context = parseAccessoryContext(accessoryWithContext({
      kind: 'power',
      zone: 1,
      model: 'Concert XR-6',
    }))
    expect(context.model).toBe('Concert XR-6')
  })

  it('rejects a missing context', () => {
    expect(() => parseAccessoryContext(accessoryWithContext(undefined)))
      .toThrow(/context is missing/)
  })

  it('rejects an unknown kind', () => {
    expect(() => parseAccessoryContext(accessoryWithContext({ kind: 'mute', zone: 1 })))
      .toThrow(/unknown kind "mute"/)
  })

  it('rejects a missing or out-of-range zone rather than silently using zone 1', () => {
    // Defaulting here would point a zone-2 accessory at the main zone.
    expect(() => parseAccessoryContext(accessoryWithContext({ kind: 'power' })))
      .toThrow(/invalid zone "undefined"/)
    expect(() => parseAccessoryContext(accessoryWithContext({ kind: 'power', zone: 9 })))
      .toThrow(/invalid zone "9"/)
  })
})
