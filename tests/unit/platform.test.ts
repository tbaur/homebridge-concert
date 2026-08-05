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
      HAPStatus: { SERVICE_COMMUNICATION_FAILURE: -70402 },
      HapStatusError: class extends Error {},
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
      on: jest.fn(),
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
      { type: 'power', name: 'XR-8S Power', zone: 1 },
    ],
    ...overrides,
  }
}

/** Drain microtasks / immediates so sequential `refreshAll` can finish. */
async function settleRefresh(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
}

describe('ConcertPlatform', () => {
  beforeEach(() => {
    jest.spyOn(ConcertClient.prototype, 'getPowerState').mockResolvedValue(false)
    jest.spyOn(ConcertClient.prototype, 'setPower').mockResolvedValue(undefined)
    jest.spyOn(ConcertClient.prototype, 'getVolume').mockResolvedValue(40)
    jest.spyOn(ConcertClient.prototype, 'setVolume').mockResolvedValue(undefined)
    jest.spyOn(ConcertClient.prototype, 'setVolumeWhenReady').mockResolvedValue(undefined)
    jest.spyOn(ConcertClient.prototype, 'getSource').mockResolvedValue('cd')
    jest.spyOn(ConcertClient.prototype, 'setSource').mockResolvedValue(undefined)
    jest.spyOn(ConcertClient.prototype, 'setSourceWhenReady').mockResolvedValue(undefined)
    jest.spyOn(ConcertClient.prototype, 'getLastPowerState').mockReturnValue(undefined)
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('keeps cached accessories registered when host is missing', () => {
    const api = createMockApi()
    const log = createLog()
    const config = {
      platform: 'Concert',
      name: 'Concert',
      accessories: [{ type: 'power', name: 'XR-8S Power' }],
    } as ConcertPlatformConfig

    const platform = new ConcertPlatform(log, config, api)
    const cached = { UUID: 'cached', displayName: 'Cached' } as PlatformAccessory
    platform.configureAccessory(cached)
    api.emit('didFinishLaunching')

    expect(log.error).toHaveBeenCalled()
    expect(api.registerPlatformAccessories).not.toHaveBeenCalled()
    // Unregistering would make HomeKit discard rooms, scenes, and automations
    // that the user cannot recover by fixing the config.
    expect(api.unregisterPlatformAccessories).not.toHaveBeenCalled()
    expect(platform.accessories).toHaveLength(1)
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('No Response'))
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

  it('reports a discovery failure instead of throwing into Homebridge', () => {
    const api = createMockApi()
    const log = createLog()
    ;(api.platformAccessory as unknown as jest.Mock).mockImplementation(() => {
      throw new Error('accessory name is invalid')
    })

    new ConcertPlatform(log, validConfig(), api)

    // A throw here would escape the emitter and take down the host process.
    expect(() => api.emit('didFinishLaunching')).not.toThrow()
    // Contained to the one accessory, including a registration failure.
    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining('Skipping accessory "XR-8S Power"'),
    )
  })

  it('survives a failure outside the per-accessory loop', () => {
    const api = createMockApi()
    const log = createLog()
    ;(api.unregisterPlatformAccessories as unknown as jest.Mock).mockImplementation(() => {
      throw new Error('HAP is unhappy')
    })

    const platform = new ConcertPlatform(log, validConfig(), api)
    platform.configureAccessory({ UUID: 'uuid-stale', displayName: 'Stale' } as PlatformAccessory)

    expect(() => api.emit('didFinishLaunching')).not.toThrow()
    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to set up accessories'),
    )
  })

  it('registers power, volume, and source accessories on launch', async () => {
    const api = createMockApi()
    const log = createLog()
    const config = validConfig({
      accessories: [
        { type: 'power', name: 'XR-8S Power', zone: 1 },
        { type: 'volumePreset', name: 'XR-8S Volume', zone: 1, volume: 57 },
        { type: 'sourcePreset', name: 'XR-8S CD', zone: 1, source: 'CD' },
      ],
    })
    jest.spyOn(ConcertClient.prototype, 'getPowerState').mockResolvedValue(true)
    jest.spyOn(ConcertClient.prototype, 'getLastPowerState').mockReturnValue(true)

    new ConcertPlatform(log, config, api)
    api.emit('didFinishLaunching')
    await settleRefresh()

    expect(api.registerPlatformAccessories).toHaveBeenCalledTimes(3)
    expect(api.registerPlatformAccessories).toHaveBeenCalledWith(
      'homebridge-concert',
      'Concert',
      expect.arrayContaining([
        expect.objectContaining({ displayName: 'XR-8S Power' }),
      ]),
    )
    expect(api.registerPlatformAccessories).toHaveBeenCalledWith(
      'homebridge-concert',
      'Concert',
      expect.arrayContaining([
        expect.objectContaining({ displayName: 'XR-8S Volume' }),
      ]),
    )
    expect(api.registerPlatformAccessories).toHaveBeenCalledWith(
      'homebridge-concert',
      'Concert',
      expect.arrayContaining([
        expect.objectContaining({ displayName: 'XR-8S CD' }),
      ]),
    )
    const registered = (api.registerPlatformAccessories as jest.Mock).mock.calls[0][2][0] as {
      context: { serialNumber: string }
    }
    expect(registered.context.serialNumber).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
    expect(ConcertClient.prototype.getPowerState).toHaveBeenCalled()
    expect(ConcertClient.prototype.getVolume).toHaveBeenCalled()
    expect(ConcertClient.prototype.getSource).toHaveBeenCalled()
    api.emit('shutdown')
  })

  it('skips volume poll on launch when the zone is in standby', async () => {
    const api = createMockApi()
    const log = createLog()
    const config = validConfig({
      accessories: [
        { type: 'power', name: 'XR-8S Power', zone: 1 },
        { type: 'volumePreset', name: 'XR-8S Volume', zone: 1, volume: 57 },
      ],
    })
    jest.spyOn(ConcertClient.prototype, 'getPowerState').mockResolvedValue(false)
    jest.spyOn(ConcertClient.prototype, 'getLastPowerState').mockReturnValue(false)

    new ConcertPlatform(log, config, api)
    api.emit('didFinishLaunching')
    await settleRefresh()

    expect(ConcertClient.prototype.getPowerState).toHaveBeenCalled()
    expect(ConcertClient.prototype.getVolume).not.toHaveBeenCalled()
    api.emit('shutdown')
  })

  it('restores a cached accessory and still removes other stale ones', () => {
    const api = createMockApi()
    const log = createLog()
    const config = validConfig({
      accessories: [{ type: 'power', name: 'Theater', zone: 1 }],
    })

    const platform = new ConcertPlatform(log, config, api)
    const uuid = api.hap.uuid.generate('concert-z1:power')
    const cached = {
      UUID: uuid,
      displayName: 'Old Name',
      context: { serialNumber: 'cached-serial-abc' },
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
      on: jest.fn(),
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
    expect(cached.context).toEqual(expect.objectContaining({
      serialNumber: 'cached-serial-abc',
    }))
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
    const uuid = api.hap.uuid.generate('concert-z1:power')
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
      on: jest.fn(),
    } as unknown as PlatformAccessory

    platform.configureAccessory(cached)
    api.emit('didFinishLaunching')

    expect(cached.displayName).toBe('Living Room AVR')
    expect(hapAccessory.displayName).toBe('Living Room AVR')
    expect(log.info).toHaveBeenCalledWith('Renamed accessory "Old Name" → "Living Room AVR"')
    // The fixture must model a real PlatformAccessory closely enough that the
    // handler actually builds; otherwise this test silently covers the failure path.
    expect(log.error).not.toHaveBeenCalledWith(expect.stringContaining('Skipping accessory'))
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

  it('coalesces overlapping poll ticks onto one in-flight refresh', async () => {
    jest.useFakeTimers()
    const api = createMockApi()
    const log = createLog()
    const config = validConfig({
      options: { refreshRate: 5 },
    })

    let resolvePower: ((value: boolean) => void) | undefined
    jest.spyOn(ConcertClient.prototype, 'getPowerState').mockImplementation(
      () => new Promise<boolean>((resolve) => {
        resolvePower = resolve
      }),
    )

    new ConcertPlatform(log, config, api)
    api.emit('didFinishLaunching')
    await Promise.resolve()
    expect(ConcertClient.prototype.getPowerState).toHaveBeenCalledTimes(1)

    // Timer fires while the launch refresh is still blocked on getPowerState.
    await jest.advanceTimersByTimeAsync(5_000)
    expect(ConcertClient.prototype.getPowerState).toHaveBeenCalledTimes(1)
    expect(log.debug).toHaveBeenCalledWith(
      'Refresh (poll) coalesced; previous refresh still in flight',
    )

    resolvePower?.(false)
    // Fake timers: drain microtasks only (avoid setImmediate-based settleRefresh).
    await Promise.resolve()
    await Promise.resolve()
    api.emit('shutdown')
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

  it('refreshes presets together so same-zone queries coalesce', async () => {
    const api = createMockApi()
    const log = createLog()
    const config = validConfig({
      accessories: [
        { type: 'power', name: 'XR-8S Power', zone: 1 },
        { type: 'volumePreset', name: 'Quiet', zone: 1, volume: 30 },
        { type: 'volumePreset', name: 'Loud', zone: 1, volume: 57 },
      ],
    })
    jest.spyOn(ConcertClient.prototype, 'getLastPowerState').mockReturnValue(true)

    let concurrentVolumeQueries = 0
    let peakConcurrentVolumeQueries = 0
    jest.spyOn(ConcertClient.prototype, 'getVolume').mockImplementation(async () => {
      concurrentVolumeQueries += 1
      peakConcurrentVolumeQueries = Math.max(
        peakConcurrentVolumeQueries,
        concurrentVolumeQueries,
      )
      await Promise.resolve()
      concurrentVolumeQueries -= 1
      return 30
    })

    new ConcertPlatform(log, config, api)
    api.emit('didFinishLaunching')
    await settleRefresh()

    // Sequential refresh would let each preset finish before the next started,
    // defeating the client's in-flight coalescing and costing one socket each.
    expect(peakConcurrentVolumeQueries).toBe(2)
    api.emit('shutdown')
  })

  it('skips an accessory that cannot be constructed and keeps the rest', () => {
    const api = createMockApi()
    const log = createLog()
    const config = validConfig({
      accessories: [
        { type: 'power', name: 'XR-8S Power', zone: 1 },
        { type: 'volumePreset', name: 'Broken', zone: 1, volume: 57 },
      ],
    })
    // Simulate HAP rejecting one accessory's Switch service.
    const platformAccessory = api.platformAccessory as unknown as jest.Mock
    const buildAccessory = platformAccessory.getMockImplementation()!
    platformAccessory.mockImplementation((displayName: string, uuid: string) => {
      const accessory = buildAccessory(displayName, uuid)
      if (displayName === 'Broken') {
        accessory.getService = jest.fn(() => undefined)
        accessory.addService = jest.fn(() => {
          throw new Error('service name is invalid')
        })
      }
      return accessory
    })

    new ConcertPlatform(log, config, api)
    expect(() => api.emit('didFinishLaunching')).not.toThrow()

    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Skipping accessory "Broken"'))
    // The healthy accessory is still registered.
    expect(api.registerPlatformAccessories).toHaveBeenCalledWith(
      'homebridge-concert',
      'Concert',
      expect.arrayContaining([expect.objectContaining({ displayName: 'XR-8S Power' })]),
    )
    api.emit('shutdown')
  })

  it('reports the plugin version and target on startup', () => {
    const api = createMockApi()
    const log = createLog()

    new ConcertPlatform(log, validConfig(), api)
    api.emit('didFinishLaunching')

    // Without this line a bug report cannot say which build talked to what.
    expect(log.info).toHaveBeenCalledWith(
      expect.stringMatching(/^homebridge-concert v\d+\.\d+\.\d+.* → 192\.168\.1\.50:50000 \(/),
    )
    api.emit('shutdown')
  })

  it('notes when a cached accessory\'s receiver address has changed', () => {
    const api = createMockApi()
    const log = createLog()
    const config = validConfig({ host: '192.168.1.60' })

    const platform = new ConcertPlatform(log, config, api)
    // Reachable only because the UUID no longer encodes the address: the same
    // accessory now matches across an IP change instead of being discarded.
    platform.configureAccessory({
      UUID: api.hap.uuid.generate('concert-z1:power'),
      displayName: 'XR-8S Power',
      context: { kind: 'power', zone: 1, host: '192.168.1.50', port: 50_000 },
      getService: jest.fn(() => ({
        setCharacteristic: jest.fn().mockReturnThis(),
        getCharacteristic: jest.fn().mockReturnValue({
          onGet: jest.fn().mockReturnThis(),
          onSet: jest.fn().mockReturnThis(),
        }),
        updateCharacteristic: jest.fn(),
      })),
      addService: jest.fn(),
      on: jest.fn(),
    } as unknown as PlatformAccessory)

    api.emit('didFinishLaunching')

    expect(log.info).toHaveBeenCalledWith(
      'XR-8S Power: receiver address changed 192.168.1.50:50000 → 192.168.1.60:50000',
    )
    // The whole point: a moved receiver must not cost the user its HomeKit state.
    expect(api.unregisterPlatformAccessories).not.toHaveBeenCalled()
    expect(api.registerPlatformAccessories).not.toHaveBeenCalled()
    api.emit('shutdown')
  })

  it('adopts an accessory cached under the old address-based UUID', () => {
    const api = createMockApi()
    const log = createLog()
    const config = validConfig({
      accessories: [{ type: 'volumePreset', name: 'XR-8S Volume', zone: 1, volume: 57 }],
    })

    const platform = new ConcertPlatform(log, config, api)
    // UUIDs used to be seeded with host:port. Replacing this accessory would cost
    // the user its room, scenes, and automations for no functional reason.
    const legacy = {
      UUID: api.hap.uuid.generate('concert-192.168.1.50:50000:z1:vol:57'),
      displayName: 'XR-8S Volume',
      context: { kind: 'volumePreset', zone: 1, volume: 57, serialNumber: 'legacy-serial' },
      getService: jest.fn(() => ({
        setCharacteristic: jest.fn().mockReturnThis(),
        getCharacteristic: jest.fn().mockReturnValue({
          onGet: jest.fn().mockReturnThis(),
          onSet: jest.fn().mockReturnThis(),
        }),
        updateCharacteristic: jest.fn(),
      })),
      addService: jest.fn(),
      on: jest.fn(),
    } as unknown as PlatformAccessory

    platform.configureAccessory(legacy)
    api.emit('didFinishLaunching')

    expect(log.info).toHaveBeenCalledWith(
      expect.stringContaining('Adopting cached accessory "XR-8S Volume" for z1:vol:57'),
    )
    expect(api.unregisterPlatformAccessories).not.toHaveBeenCalled()
    expect(api.registerPlatformAccessories).not.toHaveBeenCalled()
    expect(api.updatePlatformAccessories).toHaveBeenCalledWith([legacy])
    // The opaque serial is part of what HomeKit keys on; it must survive too.
    expect((legacy.context as { serialNumber?: string }).serialNumber).toBe('legacy-serial')
    expect(log.error).not.toHaveBeenCalledWith(expect.stringContaining('Skipping accessory'))
    api.emit('shutdown')
  })

  it('announces an adoption once, not on every restart', () => {
    const config = validConfig({
      accessories: [{ type: 'power', name: 'XR-8S Power', zone: 1 }],
    })
    const legacyUuid = 'uuid-concert-192.168.1.50:50000:z1:power'
    // Shared across both launches, exactly as the on-disk cache would be.
    const context: Record<string, unknown> = { kind: 'power', zone: 1 }
    const makeCached = () => ({
      UUID: legacyUuid,
      displayName: 'XR-8S Power',
      get context() {
        return context
      },
      set context(next: Record<string, unknown>) {
        Object.assign(context, next)
      },
      getService: jest.fn(() => ({
        setCharacteristic: jest.fn().mockReturnThis(),
        getCharacteristic: jest.fn().mockReturnValue({
          onGet: jest.fn().mockReturnThis(),
          onSet: jest.fn().mockReturnThis(),
        }),
        updateCharacteristic: jest.fn(),
      })),
      addService: jest.fn(),
      on: jest.fn(),
    } as unknown as PlatformAccessory)

    const firstApi = createMockApi()
    const firstLog = createLog()
    const first = new ConcertPlatform(firstLog, config, firstApi)
    first.configureAccessory(makeCached())
    firstApi.emit('didFinishLaunching')

    expect(firstLog.info).toHaveBeenCalledWith(
      expect.stringContaining('registered by an earlier version'),
    )
    firstApi.emit('shutdown')

    // A HAP UUID is immutable, so the accessory keeps its legacy UUID and is
    // re-adopted forever. The notice must not be repeated every launch.
    const secondApi = createMockApi()
    const secondLog = createLog()
    const second = new ConcertPlatform(secondLog, config, secondApi)
    second.configureAccessory(makeCached())
    secondApi.emit('didFinishLaunching')

    expect(secondLog.info).not.toHaveBeenCalledWith(
      expect.stringContaining('Adopting cached accessory'),
    )
    expect(secondLog.debug).toHaveBeenCalledWith(
      expect.stringContaining('identity predates the current scheme'),
    )
    expect(secondApi.unregisterPlatformAccessories).not.toHaveBeenCalled()
    secondApi.emit('shutdown')
  })

  it('adopts each cached accessory at most once', () => {
    const api = createMockApi()
    const log = createLog()
    const config = validConfig({
      accessories: [
        { type: 'volumePreset', name: 'Quiet', zone: 1, volume: 30 },
        { type: 'volumePreset', name: 'Loud', zone: 1, volume: 57 },
      ],
    })

    const platform = new ConcertPlatform(log, config, api)
    const makeLegacy = (volume: number) => ({
      UUID: api.hap.uuid.generate(`concert-192.168.1.50:50000:z1:vol:${volume}`),
      displayName: `Legacy ${volume}`,
      context: { kind: 'volumePreset', zone: 1, volume },
      getService: jest.fn(() => ({
        setCharacteristic: jest.fn().mockReturnThis(),
        getCharacteristic: jest.fn().mockReturnValue({
          onGet: jest.fn().mockReturnThis(),
          onSet: jest.fn().mockReturnThis(),
        }),
        updateCharacteristic: jest.fn(),
      })),
      addService: jest.fn(),
      on: jest.fn(),
      updateDisplayName: jest.fn(),
    } as unknown as PlatformAccessory)

    const quiet = makeLegacy(30)
    const loud = makeLegacy(57)
    platform.configureAccessory(quiet)
    platform.configureAccessory(loud)
    api.emit('didFinishLaunching')

    // Presets differ only by target, so identity matching must not cross them.
    expect(api.unregisterPlatformAccessories).not.toHaveBeenCalled()
    expect(api.registerPlatformAccessories).not.toHaveBeenCalled()
    expect((quiet.context as { volume?: number }).volume).toBe(30)
    expect((loud.context as { volume?: number }).volume).toBe(57)
    api.emit('shutdown')
  })

  it('still removes a cached accessory that no longer matches any config entry', () => {
    const api = createMockApi()
    const log = createLog()
    const config = validConfig({
      accessories: [{ type: 'power', name: 'XR-8S Power', zone: 1 }],
    })

    const platform = new ConcertPlatform(log, config, api)
    // A preset the user deleted: identity matching must not resurrect it.
    const removed = {
      UUID: 'uuid-legacy-vol',
      displayName: 'Deleted Preset',
      context: { kind: 'volumePreset', zone: 1, volume: 99 },
    } as unknown as PlatformAccessory

    platform.configureAccessory(removed)
    api.emit('didFinishLaunching')

    expect(api.unregisterPlatformAccessories).toHaveBeenCalledWith(
      'homebridge-concert',
      'Concert',
      [removed],
    )
    api.emit('shutdown')
  })

  it('makes an accessory with no handler read as No Response', () => {
    const api = createMockApi()
    const log = createLog()
    const onChar = {
      onGet: jest.fn().mockReturnThis(),
      onSet: jest.fn().mockReturnThis(),
    }
    const platformAccessory = api.platformAccessory as unknown as jest.Mock
    const buildAccessory = platformAccessory.getMockImplementation()!
    platformAccessory.mockImplementation((displayName: string, uuid: string) => {
      const accessory = buildAccessory(displayName, uuid)
      accessory.getService = jest.fn(() => ({
        setCharacteristic: jest.fn().mockReturnThis(),
        getCharacteristic: jest.fn(() => onChar),
        updateCharacteristic: jest.fn(),
      }))
      accessory.addService = jest.fn(() => {
        throw new Error('service name is invalid')
      })
      return accessory
    })

    new ConcertPlatform(log, validConfig(), api)
    api.emit('didFinishLaunching')

    // HAP answers a read with the value deserialized from its cache when no get
    // handler is registered, so without this the switch would serve a stale
    // value instead of showing a fault.
    const failingGet = onChar.onGet.mock.calls.at(-1)?.[0] as () => unknown
    expect(failingGet).toBeDefined()
    expect(() => failingGet()).toThrow()
    api.emit('shutdown')
  })

  it('does not start polling when no accessory could be set up', () => {
    const api = createMockApi()
    const log = createLog()
    const platformAccessory = api.platformAccessory as unknown as jest.Mock
    platformAccessory.mockImplementation(() => {
      throw new Error('HAP rejected the accessory')
    })

    new ConcertPlatform(log, validConfig(), api)
    api.emit('didFinishLaunching')

    // Announcing a poll interval that nothing polls sends the operator hunting.
    expect(log.info).not.toHaveBeenCalledWith(expect.stringContaining('Polling accessory state'))
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('nothing will be polled'))
    api.emit('shutdown')
  })

  it('closes the client on shutdown', () => {
    const api = createMockApi()
    const log = createLog()
    const close = jest.spyOn(ConcertClient.prototype, 'close')

    new ConcertPlatform(log, validConfig(), api)
    api.emit('didFinishLaunching')
    api.emit('shutdown')

    expect(close).toHaveBeenCalled()
  })
})
