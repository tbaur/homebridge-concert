/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 */

import schema from '../../config.schema.json'
import { PLATFORM_NAME, PLUGIN_NAME } from '../../src/settings'

describe('config.schema.json', () => {
  it('matches platform registration constants', () => {
    expect(schema.pluginAlias).toBe(PLATFORM_NAME)
    expect(schema.pluginType).toBe('platform')
    expect(schema.singular).toBe(true)
  })

  it('requires name, host, and accessories', () => {
    expect(schema.schema.required).toEqual(expect.arrayContaining(['name', 'host', 'accessories']))
  })

  it('defaults the control port to 50000 and refreshRate to 90', () => {
    expect(schema.schema.properties.port.default).toBe(50_000)
    expect(schema.schema.properties.options.properties.refreshRate.default).toBe(90)
  })

  it('defines accessories as an array of typed switches', () => {
    const accessories = schema.schema.properties.accessories
    expect(accessories.type).toBe('array')
    expect(accessories.minItems).toBe(1)
    expect(accessories.items.required).toEqual(expect.arrayContaining(['type', 'name']))
    expect(accessories.items.properties.type.enum).toEqual([
      'power',
      'volumePreset',
      'sourcePreset',
    ])
    expect(accessories.items.properties.source.enum).toEqual(expect.arrayContaining(['CD', 'BD']))
  })

  it('binds accessory form fields under accessories[] (not root name/type)', () => {
    const accessoriesForm = schema.layout.find(
      (entry) => typeof entry === 'object' && entry !== null && 'key' in entry && entry.key === 'accessories',
    ) as { key: string; type: string; items: Array<string | { key: string }> }
    expect(accessoriesForm.type).toBe('array')
    const keys = accessoriesForm.items.map((item) => (typeof item === 'string' ? item : item.key))
    expect(keys).toEqual(expect.arrayContaining([
      'accessories[].type',
      'accessories[].name',
      'accessories[].zone',
      'accessories[].volume',
      'accessories[].source',
    ]))
    expect(keys).not.toContain('type')
    expect(keys).not.toContain('name')
  })

  it('uses editable integer fields (no min/max sliders) for port and refreshRate', () => {
    const port = schema.schema.properties.port as { minimum?: number; maximum?: number }
    const refreshRate = schema.schema.properties.options.properties.refreshRate as {
      minimum?: number
      maximum?: number
    }
    expect(port.minimum).toBeUndefined()
    expect(port.maximum).toBeUndefined()
    expect(refreshRate.minimum).toBeUndefined()
    expect(refreshRate.maximum).toBeUndefined()
    expect(schema.layout).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'port', type: 'integer' }),
      expect.objectContaining({ key: 'options.refreshRate', type: 'integer' }),
      expect.objectContaining({ key: 'accessories', type: 'array' }),
    ]))
  })

  it('package name matches PLUGIN_NAME', () => {
    // Keep the published package name and registerPlatform name in lockstep.
     
    const pkg = require('../../package.json') as { name: string }
    expect(pkg.name).toBe(PLUGIN_NAME)
  })
})
