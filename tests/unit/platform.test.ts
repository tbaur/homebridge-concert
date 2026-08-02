/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 */

import type { API, Logging, PlatformAccessory } from 'homebridge'

import { ConcertClient } from '../../src/api/client'
import ConcertPlatform from '../../src/platform'
import type { ConcertPlatformConfig } from '../../src/types'

type TestApi = API & { emit: (event: string) => void }

function createMockApi(): TestApi {
  const handlers = new Map<string, () => void>()

  const makeService = () => ({
    setCharacteristic: jest.fn().mockReturnThis(),
    getCharacteristic: jest.fn().mockReturnValue({
      onGet: jest.fn().mockReturnThis(),
      onSet: jest.fn().mockReturnThis(),
    }),
    updateCharacteristic: jest.fn(),
  })

  return {
    hap: {
      Service: {
        Switch: 'Switch',
        AccessoryInformation: 'AccessoryInformation',
      },
      Characteristic: {
        On: 'On',
        Manufacturer: 'Manufacturer',
        Model: 'Model',
        SerialNumber: 'SerialNumber',
        FirmwareRevision: 'FirmwareRevision',
        Name: 'Name',
      },
      uuid: {
        generate: (value: string) => `uuid-${value}`,
      },
    },
    platformAccessory: jest.fn((displayName: string, uuid: string) => ({
      displayName,
      UUID: uuid,
      context: {},
      getService: jest.fn((service: string) => {
        if (service === 'AccessoryInformation' || service === 'Switch') {
          return makeService()
        }
        return undefined
      }),
      addService: jest.fn(() => makeService()),
    })),
    registerPlatformAccessories: jest.fn(),
    unregisterPlatformAccessories: jest.fn(),
    updatePlatformAccessories: jest.fn(),
    on: jest.fn((event: string, handler: () => void) => {
      handlers.set(event, handler)
    }),
    emit(event: string) {
      handlers.get(event)?.()
    },
  } as unknown as TestApi
}

function createLog(): Logging {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    success: jest.fn(),
  } as unknown as Logging
}

function validConfig(overrides: Partial<ConcertPlatformConfig> = {}): ConcertPlatformConfig {
  return {
    platform: 'Concert',
    name: 'Theater',
    host: '192.168.1.50',
    accessories: [
      { type: 'power', name: 'XR-8S', zone: 1 },
    ],
    ...overrides,
  }
}

describe('ConcertPlatform', () => {
  beforeEach(() => {
    jest.spyOn(ConcertClient.prototype, 'getPowerState').mockResolvedValue(false)
    jest.spyOn(ConcertClient.prototype, 'setPower').mockResolvedValue(undefined)
    jest.spyOn(ConcertClient.prototype, 'getVolume').mockResolvedValue(40)
    jest.spyOn(ConcertClient.prototype, 'setVolume').mockResolvedValue(undefined)
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('stays disabled when host is missing and clears cached accessories', () => {
    const api = createMockApi()
    const log = createLog()
    const config = {
      platform: 'Concert',
      name: 'Concert',
      accessories: [{ type: 'power', name: 'XR-8S' }],
    } as ConcertPlatformConfig

    const platform = new ConcertPlatform(log, config, api)
    const cached = { UUID: 'cached', displayName: 'Cached' } as PlatformAccessory
    platform.configureAccessory(cached)
    api.emit('didFinishLaunching')

    expect(log.error).toHaveBeenCalled()
    expect(api.registerPlatformAccessories).not.toHaveBeenCalled()
    expect(api.unregisterPlatformAccessories).toHaveBeenCalledWith(
      'homebridge-concert',
      'Concert',
      [cached],
    )
    expect(platform.accessories).toHaveLength(0)
  })

  it('stays disabled when accessories are missing', () => {
    const api = createMockApi()
    const log = createLog()
    const config = {
      platform: 'Concert',
      name: 'Concert',
      host: '192.168.1.50',
    } as ConcertPlatformConfig

    new ConcertPlatform(log, config, api)
    api.emit('didFinishLaunching')

    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('accessories'))
    expect(api.registerPlatformAccessories).not.toHaveBeenCalled()
  })

  it('registers power and volume accessories on launch', () => {
    const api = createMockApi()
    const log = createLog()
    const config = validConfig({
      accessories: [
        { type: 'power', name: 'XR-8S', zone: 1 },
        { type: 'volumePreset', name: 'Concert 57', zone: 1, volume: 57 },
      ],
    })

    new ConcertPlatform(log, config, api)
    api.emit('didFinishLaunching')

    expect(api.registerPlatformAccessories).toHaveBeenCalledTimes(2)
    expect(api.registerPlatformAccessories).toHaveBeenCalledWith(
      'homebridge-concert',
      'Concert',
      expect.arrayContaining([
        expect.objectContaining({ displayName: 'XR-8S' }),
      ]),
    )
    expect(api.registerPlatformAccessories).toHaveBeenCalledWith(
      'homebridge-concert',
      'Concert',
      expect.arrayContaining([
        expect.objectContaining({ displayName: 'Concert 57' }),
      ]),
    )
    expect(ConcertClient.prototype.getPowerState).toHaveBeenCalled()
    expect(ConcertClient.prototype.getVolume).toHaveBeenCalled()
    api.emit('shutdown')
  })

  it('restores a cached accessory and still removes other stale ones', () => {
    const api = createMockApi()
    const log = createLog()
    const config = validConfig({
      accessories: [{ type: 'power', name: 'Theater', zone: 1 }],
    })

    const platform = new ConcertPlatform(log, config, api)
    const uuid = api.hap.uuid.generate('concert-192.168.1.50:50000:z1:power')
    const cached = {
      UUID: uuid,
      displayName: 'Old Name',
      context: {},
      updateDisplayName: undefined as ((name: string) => void) | undefined,
      getService: jest.fn().mockReturnValue({
        setCharacteristic: jest.fn().mockReturnThis(),
        getCharacteristic: jest.fn().mockReturnValue({
          onGet: jest.fn().mockReturnThis(),
          onSet: jest.fn().mockReturnThis(),
        }),
        updateCharacteristic: jest.fn(),
      }),
      addService: jest.fn(),
    }
    cached.updateDisplayName = (name: string) => {
      cached.displayName = name
    }
    const cachedAccessory = cached as unknown as PlatformAccessory
    const stale = {
      UUID: 'uuid-stale',
      displayName: 'Stale',
      context: {},
    } as PlatformAccessory

    platform.configureAccessory(cachedAccessory)
    platform.configureAccessory(stale)
    api.emit('didFinishLaunching')

    expect(api.registerPlatformAccessories).not.toHaveBeenCalled()
    expect(api.updatePlatformAccessories).toHaveBeenCalled()
    expect(api.unregisterPlatformAccessories).toHaveBeenCalledWith(
      'homebridge-concert',
      'Concert',
      [stale],
    )
    expect(cached.displayName).toBe('Theater')
    expect(log.info).toHaveBeenCalledWith('Renamed accessory "Old Name" → "Theater"')
    api.emit('shutdown')
  })

  it('renames a cached accessory without updateDisplayName via HAP fallback', () => {
    const api = createMockApi()
    const log = createLog()
    const config = validConfig({
      accessories: [{ type: 'power', name: 'Living Room AVR', zone: 1 }],
    })

    const platform = new ConcertPlatform(log, config, api)
    const uuid = api.hap.uuid.generate('concert-192.168.1.50:50000:z1:power')
    const hapAccessory = { displayName: 'Old Name' }
    const cached = {
      UUID: uuid,
      displayName: 'Old Name',
      context: {},
      _associatedHAPAccessory: hapAccessory,
      getService: jest.fn().mockReturnValue({
        setCharacteristic: jest.fn().mockReturnThis(),
        getCharacteristic: jest.fn().mockReturnValue({
          onGet: jest.fn().mockReturnThis(),
          onSet: jest.fn().mockReturnThis(),
        }),
        updateCharacteristic: jest.fn(),
      }),
      addService: jest.fn(),
    } as unknown as PlatformAccessory

    platform.configureAccessory(cached)
    api.emit('didFinishLaunching')

    expect(cached.displayName).toBe('Living Room AVR')
    expect(hapAccessory.displayName).toBe('Living Room AVR')
    expect(log.info).toHaveBeenCalledWith('Renamed accessory "Old Name" → "Living Room AVR"')
    api.emit('shutdown')
  })

  it('removes stale cached accessories when the target changes', () => {
    const api = createMockApi()
    const log = createLog()
    const config = validConfig()

    const platform = new ConcertPlatform(log, config, api)
    const stale = {
      UUID: 'uuid-stale',
      displayName: 'Stale',
      context: {},
    } as PlatformAccessory
    platform.configureAccessory(stale)
    api.emit('didFinishLaunching')

    expect(api.unregisterPlatformAccessories).toHaveBeenCalledWith(
      'homebridge-concert',
      'Concert',
      [stale],
    )
    expect(api.registerPlatformAccessories).toHaveBeenCalled()
    api.emit('shutdown')
  })

  it('clears the poll timer on shutdown', async () => {
    jest.useFakeTimers()
    const api = createMockApi()
    const log = createLog()
    const config = validConfig({
      options: { refreshRate: 5 },
    })

    new ConcertPlatform(log, config, api)
    api.emit('didFinishLaunching')
    await Promise.resolve()
    const callsBefore = (ConcertClient.prototype.getPowerState as jest.Mock).mock.calls.length

    await jest.advanceTimersByTimeAsync(5_000)
    expect((ConcertClient.prototype.getPowerState as jest.Mock).mock.calls.length).toBeGreaterThan(callsBefore)

    api.emit('shutdown')
    const callsAfterShutdown = (ConcertClient.prototype.getPowerState as jest.Mock).mock.calls.length
    await jest.advanceTimersByTimeAsync(5_000)
    expect((ConcertClient.prototype.getPowerState as jest.Mock).mock.calls.length).toBe(callsAfterShutdown)
  })

  it('stores cached accessories via configureAccessory', () => {
    const api = createMockApi()
    const log = createLog()
    const config = validConfig()
    const platform = new ConcertPlatform(log, config, api)
    const accessory = { UUID: 'cached', displayName: 'Cached' } as PlatformAccessory
    platform.configureAccessory(accessory)
    expect(platform.accessories).toContain(accessory)
    api.emit('shutdown')
  })
})
