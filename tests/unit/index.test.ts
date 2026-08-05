/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 */

import type { API } from 'homebridge'

import registerPlugin from '../../src/index'
import ConcertPlatform from '../../src/platform'
import { PLATFORM_NAME, PLUGIN_NAME } from '../../src/settings'

describe('plugin entry point', () => {
  it('registers the platform with Homebridge', () => {
    const api = { registerPlatform: jest.fn() } as unknown as API

    registerPlugin(api)

    // Argument order matters: Homebridge looks the platform up by these names,
    // and a swap would only surface as "platform not found" at runtime.
    expect(api.registerPlatform).toHaveBeenCalledWith(
      PLUGIN_NAME,
      PLATFORM_NAME,
      ConcertPlatform,
    )
  })

  it('registers under the published package name', () => {
    const pkg = require('../../package.json') as { name: string }
    expect(PLUGIN_NAME).toBe(pkg.name)
  })
})
