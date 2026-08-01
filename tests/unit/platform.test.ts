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

describe('ConcertPlatform', () => {
  beforeEach(() => {
    jest.spyOn(ConcertClient.prototype, 'getPowerState').mockResolvedValue(false)
    jest.spyOn(ConcertClient.prototype, 'setPower').mockResolvedValue(undefined)
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

  it('registers a switch accessory on launch', () => {
    const api = createMockApi()
    const log = createLog()
    const config: ConcertPlatformConfig = {
      platform: 'Concert',
      name: 'Theater',
      host: '192.168.1.50',
      accessoryName: 'XR-8S',
    }

    new ConcertPlatform(log, config, api)
    api.emit('didFinishLaunching')

    expect(api.registerPlatformAccessories).toHaveBeenCalledWith(
      'homebridge-concert',
      'Concert',
      expect.arrayContaining([
        expect.objectContaining({ displayName: 'XR-8S' }),
      ]),
    )
    expect(ConcertClient.prototype.getPowerState).toHaveBeenCalled()
    api.emit('shutdown')
  })

  it('restores a cached accessory and still removes other stale ones', () => {
    const api = createMockApi()
    const log = createLog()
    const config: ConcertPlatformConfig = {
      platform: 'Concert',
      name: 'Theater',
      host: '192.168.1.50',
      zone: 1,
    }

    const platform = new ConcertPlatform(log, config, api)
    const uuid = api.hap.uuid.generate('concert-192.168.1.50:50000:z1')
    const cached = {
      UUID: uuid,
      displayName: 'Old Name',
      context: {},
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
    const stale = {
      UUID: 'uuid-stale',
      displayName: 'Stale',
      context: {},
    } as PlatformAccessory

    platform.configureAccessory(cached)
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
    api.emit('shutdown')
  })

  it('removes stale cached accessories when the target changes', () => {
    const api = createMockApi()
    const log = createLog()
    const config: ConcertPlatformConfig = {
      platform: 'Concert',
      name: 'Theater',
      host: '192.168.1.50',
    }

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
    const config: ConcertPlatformConfig = {
      platform: 'Concert',
      name: 'Theater',
      host: '192.168.1.50',
      options: { refreshRate: 5 },
    }

    new ConcertPlatform(log, config, api)
    api.emit('didFinishLaunching')
    // Let the immediate boot refresh settle so the next interval tick opens a new request.
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
    const config: ConcertPlatformConfig = {
      platform: 'Concert',
      name: 'Theater',
      host: '192.168.1.50',
    }
    const platform = new ConcertPlatform(log, config, api)
    const accessory = { UUID: 'cached', displayName: 'Cached' } as PlatformAccessory
    platform.configureAccessory(accessory)
    expect(platform.accessories).toContain(accessory)
    api.emit('shutdown')
  })
})
