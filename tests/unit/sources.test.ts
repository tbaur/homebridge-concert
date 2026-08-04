/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 */

import {
  rc5CommandForSource,
  resolveSourceDefinition,
  sourceFromQueryCode,
  sourceSupportsZone,
} from '../../src/api/sources'

describe('source catalog', () => {
  it('resolves ids and labels case-insensitively', () => {
    expect(resolveSourceDefinition('CD')?.id).toBe('cd')
    expect(resolveSourceDefinition('cd')?.label).toBe('CD')
    expect(resolveSourceDefinition('  Bd  ')?.id).toBe('bd')
    expect(resolveSourceDefinition('')).toBeUndefined()
    expect(resolveSourceDefinition('   ')).toBeUndefined()
    expect(resolveSourceDefinition('tape')).toBeUndefined()
  })

  it('maps query codes to definitions', () => {
    expect(sourceFromQueryCode(0x01)?.id).toBe('cd')
    expect(sourceFromQueryCode(0x99)).toBeUndefined()
  })

  it('returns RC5 command bytes per zone', () => {
    const cd = resolveSourceDefinition('CD')!
    expect(rc5CommandForSource(cd, 1)).toBe(0x76)
    expect(rc5CommandForSource(cd, 2)).toBe(0x06)
    expect(() => rc5CommandForSource(cd, 3)).toThrow(/Zone must be 1 or 2/)

    const display = resolveSourceDefinition('DISPLAY')!
    expect(rc5CommandForSource(display, 1)).toBe(0x3A)
    expect(() => rc5CommandForSource(display, 2)).toThrow(/Zone 2/)
  })

  it('reports zone support', () => {
    const cd = resolveSourceDefinition('CD')!
    const display = resolveSourceDefinition('DISPLAY')!
    expect(sourceSupportsZone(cd, 1)).toBe(true)
    expect(sourceSupportsZone(cd, 2)).toBe(true)
    expect(sourceSupportsZone(display, 1)).toBe(true)
    expect(sourceSupportsZone(display, 2)).toBe(false)
    expect(sourceSupportsZone(cd, 3)).toBe(false)
  })
})
