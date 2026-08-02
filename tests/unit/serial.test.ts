/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 */

import type { PlatformAccessory } from 'homebridge'

import {
  ensureAccessorySerialNumber,
  newAccessorySerialNumber,
} from '../../src/utils/serial'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

describe('accessory serial helpers', () => {
  it('generates UUID-shaped serials', () => {
    const first = newAccessorySerialNumber()
    const second = newAccessorySerialNumber()
    expect(first).toMatch(UUID_RE)
    expect(second).toMatch(UUID_RE)
    expect(first).not.toBe(second)
  })

  it('persists a generated serial on the accessory context', () => {
    const accessory = { context: {} } as PlatformAccessory
    const serial = ensureAccessorySerialNumber(accessory)
    expect(serial).toMatch(UUID_RE)
    expect((accessory.context as { serialNumber: string }).serialNumber).toBe(serial)
    expect(ensureAccessorySerialNumber(accessory)).toBe(serial)
  })

  it('reuses an existing non-empty serial', () => {
    const accessory = {
      context: { serialNumber: 'fixed-serial-1' },
    } as unknown as PlatformAccessory
    expect(ensureAccessorySerialNumber(accessory)).toBe('fixed-serial-1')
  })
})
