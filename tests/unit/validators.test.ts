/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 */

import {
  ConfigValidationError,
  accessoryIdentityKey,
  forLog,
  isValidHost,
  resolveAccessories,
  resolvePort,
  resolveRefreshRateSec,
  validateConfig,
} from '../../src/utils/validators'
import type { ConcertPlatformConfig } from '../../src/types'

function baseConfig(overrides: Partial<ConcertPlatformConfig> = {}): ConcertPlatformConfig {
  return {
    platform: 'Concert',
    name: 'Concert',
    host: '192.168.1.50',
    accessories: [
      { type: 'power', name: 'XR-8S Power', zone: 1 },
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
      accessories: [{ type: 'volumePreset', name: 'XR-8S Volume' }],
    }))
    expect(result.errors.some((e) => e.includes('volume'))).toBe(true)
  })

  it('requires source for sourcePreset', () => {
    const result = validateConfig(baseConfig({
      accessories: [{ type: 'sourcePreset', name: 'XR-8S CD' }],
    }))
    expect(result.errors.some((e) => e.includes('source'))).toBe(true)
  })

  it('rejects unknown source ids and Zone 2 DISPLAY', () => {
    const unknown = validateConfig(baseConfig({
      accessories: [{ type: 'sourcePreset', name: 'XR-8S Tape', source: 'TAPE' }],
    }))
    expect(unknown.errors.some((e) => e.includes('not a known input'))).toBe(true)

    const z2Display = validateConfig(baseConfig({
      accessories: [{ type: 'sourcePreset', name: 'Z2 Display', zone: 2, source: 'DISPLAY' }],
    }))
    expect(z2Display.errors.some((e) => e.includes('not available for zone 2'))).toBe(true)
  })

  it('rejects duplicate accessory identities', () => {
    const result = validateConfig(baseConfig({
      accessories: [
        { type: 'volumePreset', name: 'XR-8S Volume A', volume: 57 },
        { type: 'volumePreset', name: 'XR-8S Volume B', volume: 57 },
      ],
    }))
    expect(result.errors.some((e) => e.includes('duplicates'))).toBe(true)
  })

  it('rejects hosts with path separators or embedded ports', () => {
    for (const host of ['192.168.1.50/evil', '192.168.1.50:50000']) {
      const { errors } = validateConfig(baseConfig({ host }))
      expect(errors.some((e) => e.includes('not a valid hostname or IP address'))).toBe(true)
    }
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
    // Both problems must be reported, not just one of them.
    expect(result.warnings.some((w) => w.startsWith('port 99999 is invalid'))).toBe(true)
    expect(result.warnings.some((w) => w.includes('options.refreshRate 1s is below'))).toBe(true)
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
      accessories: [{ type: 'power', name: 'XR-8S Power', zone: 9 }],
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

  it('rejects control characters in an accessory name', () => {
    const result = validateConfig(baseConfig({
      accessories: [{ type: 'power', name: 'XR\n[Concert] forged line' }],
    }))
    expect(result.errors.some((e) => e.includes('control characters'))).toBe(true)
  })

  it('rejects control characters in the platform name', () => {
    const result = validateConfig(baseConfig({ name: 'Concert\nforged' }))
    expect(result.errors.some((e) => e.includes('control characters'))).toBe(true)
  })

  it('neutralizes control characters when echoing an invalid host', () => {
    const result = validateConfig(baseConfig({ host: 'bad host\nforged' }))
    expect(result.errors.some((e) => e.includes('\n'))).toBe(false)
    expect(result.errors.some((e) => e.includes('\uFFFD'))).toBe(true)
  })

  it('neutralizes control characters when echoing an invalid port', () => {
    const result = validateConfig(baseConfig({ port: '50000\nforged' as unknown as number }))
    expect(result.warnings.some((w) => w.includes('\n'))).toBe(false)
    expect(result.warnings.some((w) => w.includes('\uFFFD'))).toBe(true)
  })
})

describe('resolveAccessories', () => {
  it('resolves power, volume, and source presets', () => {
    const resolved = resolveAccessories(baseConfig({
      accessories: [
        { type: 'power', name: 'XR-8S Power' },
        { type: 'volumePreset', name: 'XR-8S Volume', volume: 57 },
        { type: 'sourcePreset', name: 'XR-8S CD', source: 'CD' },
      ],
    }))
    expect(resolved).toEqual([
      { kind: 'power', name: 'XR-8S Power', zone: 1 },
      { kind: 'volumePreset', name: 'XR-8S Volume', zone: 1, volume: 57 },
      { kind: 'sourcePreset', name: 'XR-8S CD', zone: 1, source: 'cd' },
    ])
    expect(accessoryIdentityKey(resolved[0])).toBe('z1:power')
    expect(accessoryIdentityKey(resolved[1])).toBe('z1:vol:57')
    expect(accessoryIdentityKey(resolved[2])).toBe('z1:src:cd')
  })

  it('throws ConfigValidationError carrying each message separately', () => {
    const config = baseConfig({
      accessories: [
        { type: 'volumePreset', name: 'Too loud', volume: 150 },
        { type: 'sourcePreset', name: 'Nope', source: 'NOPE' },
      ],
    })
    expect(() => resolveAccessories(config)).toThrow(ConfigValidationError)
    try {
      resolveAccessories(config)
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigValidationError)
      expect((error as ConfigValidationError).errors).toHaveLength(2)
    }
  })
})

describe('resolvers', () => {
  it('resolvePort falls back to 50000', () => {
    expect(resolvePort(50000)).toBe(50000)
    expect(resolvePort(undefined)).toBe(50000)
    expect(resolvePort(0)).toBe(50000)
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
    expect(isValidHost('receiver')).toBe(true)
    expect(isValidHost('my-receiver.example.com')).toBe(true)
  })

  it('accepts IPv6 bare and bracketed', () => {
    expect(isValidHost('fe80::1')).toBe(true)
    expect(isValidHost('[fe80::1]')).toBe(true)
  })

  it('rejects empty, unsafe, or host:port values', () => {
    expect(isValidHost('')).toBe(false)
    expect(isValidHost('host with spaces')).toBe(false)
    expect(isValidHost('192.168.1.50:50000')).toBe(false)
  })

  it('rejects malformed hosts that would only fail later at DNS', () => {
    expect(isValidHost('[]')).toBe(false)
    expect(isValidHost('[not-an-ip]')).toBe(false)
    expect(isValidHost('..')).toBe(false)
    expect(isValidHost('-leading-hyphen')).toBe(false)
    expect(isValidHost('trailing-hyphen-')).toBe(false)
    expect(isValidHost('under_score')).toBe(false)
    expect(isValidHost('host\nname')).toBe(false)
    expect(isValidHost('a'.repeat(254))).toBe(false)
  })
})

describe('forLog', () => {
  it('replaces control characters so config values cannot forge log lines', () => {
    expect(forLog('XR\n[Concert] Bridge shutting down')).toBe(
      'XR\uFFFD[Concert] Bridge shutting down',
    )
    expect(forLog('plain')).toBe('plain')
  })

  it('truncates very long values', () => {
    expect(forLog('x'.repeat(500))).toHaveLength(101)
  })

  it('stringifies non-string values', () => {
    expect(forLog(50_000)).toBe('50000')
    expect(forLog(undefined)).toBe('undefined')
  })
})
