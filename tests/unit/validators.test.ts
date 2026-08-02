/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 */

import {
  accessoryIdentityKey,
  isValidHost,
  resolveAccessories,
  resolvePort,
  resolveRefreshRateSec,
  resolveZone,
  validateConfig,
} from '../../src/utils/validators'
import type { ConcertPlatformConfig } from '../../src/types'

function baseConfig(overrides: Partial<ConcertPlatformConfig> = {}): ConcertPlatformConfig {
  return {
    platform: 'Concert',
    name: 'Concert',
    host: '192.168.1.50',
    accessories: [
      { type: 'power', name: 'XR-8S', zone: 1 },
    ],
    ...overrides,
  }
}

describe('validateConfig', () => {
  it('accepts a minimal valid config', () => {
    const result = validateConfig(baseConfig())
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([])
  })

  it('requires host', () => {
    const result = validateConfig(baseConfig({ host: '' }))
    expect(result.errors.some((e) => e.includes('host'))).toBe(true)
  })

  it('requires accessories', () => {
    const result = validateConfig(baseConfig({ accessories: [] }))
    expect(result.errors.some((e) => e.includes('accessories'))).toBe(true)
  })

  it('requires volume for volumePreset', () => {
    const result = validateConfig(baseConfig({
      accessories: [{ type: 'volumePreset', name: 'Concert 57' }],
    }))
    expect(result.errors.some((e) => e.includes('volume'))).toBe(true)
  })

  it('rejects duplicate accessory identities', () => {
    const result = validateConfig(baseConfig({
      accessories: [
        { type: 'volumePreset', name: 'A', volume: 57 },
        { type: 'volumePreset', name: 'B', volume: 57 },
      ],
    }))
    expect(result.errors.some((e) => e.includes('duplicates'))).toBe(true)
  })

  it('rejects hosts with path separators or embedded ports', () => {
    expect(validateConfig(baseConfig({ host: '192.168.1.50/evil' })).errors.length).toBeGreaterThan(0)
    expect(validateConfig(baseConfig({ host: '192.168.1.50:50000' })).errors.length).toBeGreaterThan(0)
  })

  it('accepts bracketed IPv6 hosts', () => {
    const result = validateConfig(baseConfig({ host: '[2001:db8::1]' }))
    expect(result.errors).toEqual([])
  })

  it('warns on invalid port/refreshRate', () => {
    const result = validateConfig(baseConfig({
      port: 99_999,
      options: { refreshRate: 1 },
    }))
    expect(result.errors).toEqual([])
    expect(result.warnings.length).toBeGreaterThanOrEqual(2)
    expect(result.warnings.some((w) => w.includes('using default'))).toBe(true)
  })

  it('warns when refreshRate is not an integer', () => {
    const result = validateConfig(baseConfig({
      options: { refreshRate: Number.NaN },
    }))
    expect(result.warnings.some((w) => w.includes('refreshRate'))).toBe(true)
  })

  it('rejects unknown accessory types and missing names', () => {
    const badType = validateConfig(baseConfig({
      accessories: [{ type: 'mute' as 'power', name: 'X' }],
    }))
    expect(badType.errors.some((e) => e.includes('type'))).toBe(true)

    const badName = validateConfig(baseConfig({
      accessories: [{ type: 'power', name: '   ' }],
    }))
    expect(badName.errors.some((e) => e.includes('name'))).toBe(true)

    const badEntry = validateConfig(baseConfig({
      accessories: [undefined as unknown as { type: 'power'; name: string }],
    }))
    expect(badEntry.errors.some((e) => e.includes('must be an object'))).toBe(true)
  })

  it('errors on invalid accessory zone', () => {
    const result = validateConfig(baseConfig({
      accessories: [{ type: 'power', name: 'XR-8S', zone: 9 }],
    }))
    expect(result.errors.some((e) => e.includes('zone'))).toBe(true)
  })

  it('warns when refreshRate exceeds the maximum', () => {
    const result = validateConfig(baseConfig({ options: { refreshRate: 3000000 } }))
    expect(result.errors).toEqual([])
    expect(result.warnings.some((w) => w.includes('maximum') && w.includes('clamped'))).toBe(true)
  })

  it('errors when config is missing', () => {
    const result = validateConfig(undefined)
    expect(result.errors.length).toBeGreaterThan(0)
  })
})

describe('resolveAccessories', () => {
  it('resolves power and volume presets', () => {
    const resolved = resolveAccessories(baseConfig({
      accessories: [
        { type: 'power', name: 'XR-8S' },
        { type: 'volumePreset', name: 'Concert 57', volume: 57 },
      ],
    }))
    expect(resolved).toEqual([
      { kind: 'power', name: 'XR-8S', zone: 1 },
      { kind: 'volumePreset', name: 'Concert 57', zone: 1, volume: 57 },
    ])
    expect(accessoryIdentityKey(resolved[0])).toBe('z1:power')
    expect(accessoryIdentityKey(resolved[1])).toBe('z1:vol:57')
  })
})

describe('resolvers', () => {
  it('resolvePort falls back to 50000', () => {
    expect(resolvePort(50000)).toBe(50000)
    expect(resolvePort(undefined)).toBe(50000)
    expect(resolvePort(0)).toBe(50000)
  })

  it('resolveZone falls back to 1', () => {
    expect(resolveZone(2)).toBe(2)
    expect(resolveZone(undefined)).toBe(1)
    expect(resolveZone(5)).toBe(1)
  })

  it('resolveRefreshRateSec clamps and falls back', () => {
    expect(resolveRefreshRateSec(60, 30)).toBe(60)
    expect(resolveRefreshRateSec(1, 30)).toBe(30)
    expect(resolveRefreshRateSec(3000000, 30)).toBe(86_400)
  })
})

describe('isValidHost', () => {
  it('accepts common host forms', () => {
    expect(isValidHost('192.168.1.50')).toBe(true)
    expect(isValidHost('avr.local')).toBe(true)
  })

  it('rejects empty, unsafe, or host:port values', () => {
    expect(isValidHost('')).toBe(false)
    expect(isValidHost('host with spaces')).toBe(false)
    expect(isValidHost('192.168.1.50:50000')).toBe(false)
  })
})
