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

  it('requires name and host', () => {
    expect(schema.schema.required).toEqual(expect.arrayContaining(['name', 'host']))
  })

  it('defaults the control port to 50000', () => {
    expect(schema.schema.properties.port.default).toBe(50_000)
  })

  it('bounds refreshRate between 5 and 86400', () => {
    const refreshRate = schema.schema.properties.options.properties.refreshRate
    expect(refreshRate.minimum).toBe(5)
    expect(refreshRate.maximum).toBe(86_400)
  })

  it('package name matches PLUGIN_NAME', () => {
    // Keep the published package name and registerPlatform name in lockstep.
     
    const pkg = require('../../package.json') as { name: string }
    expect(pkg.name).toBe(PLUGIN_NAME)
  })
})
