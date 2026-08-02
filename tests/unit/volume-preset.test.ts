/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 */

import type { PlatformAccessory } from 'homebridge'

import { VolumePresetAccessory } from '../../src/devices/volume-preset'
import type { ConcertClient } from '../../src/api'
import type ConcertPlatform from '../../src/platform'

class FakeHapStatusError extends Error {
  constructor(readonly status: number) {
    super(`HapStatusError:${status}`)
    this.name = 'HapStatusError'
  }
}

function createPlatform(volume = 57) {
  const onChar = {
    onGet: jest.fn().mockReturnThis(),
    onSet: jest.fn().mockReturnThis(),
  }
  const switchService = {
    setCharacteristic: jest.fn().mockReturnThis(),
    getCharacteristic: jest.fn().mockReturnValue(onChar),
    updateCharacteristic: jest.fn(),
  }
  const infoService = {
    setCharacteristic: jest.fn().mockReturnThis(),
  }

  const platform = {
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
    api: {
      hap: {
        HapStatusError: FakeHapStatusError,
      },
    },
    log: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
  } as unknown as ConcertPlatform

  const accessory = {
    displayName: 'XR-8S Volume',
    context: {
      kind: 'volumePreset',
      host: '192.168.1.50',
      port: 50_000,
      zone: 1,
      model: 'AudioControl Concert XR-8S',
      volume,
    },
    getService: jest.fn((service: string) => {
      if (service === 'AccessoryInformation') {
        return infoService
      }
      if (service === 'Switch') {
        return switchService
      }
      return undefined
    }),
    addService: jest.fn(),
  } as unknown as PlatformAccessory

  return { platform, accessory, switchService, onChar }
}

describe('VolumePresetAccessory', () => {
  it('sets volume when turned On', async () => {
    const { platform, accessory, onChar, switchService } = createPlatform()
    const client = {
      setVolume: jest.fn().mockResolvedValue(undefined),
      getVolume: jest.fn(),
    } as unknown as ConcertClient

    new VolumePresetAccessory(platform, accessory, client)
    const setHandler = onChar.onSet.mock.calls[0][0] as (value: boolean) => Promise<void>
    await setHandler(true)

    expect(client.setVolume).toHaveBeenCalledWith(57, 1)
    expect(platform.log.info).toHaveBeenCalledWith('XR-8S Volume: SET 57')
    expect(switchService.updateCharacteristic).toHaveBeenCalledWith('On', true)
  })

  it('skips setVolume when already at the preset', async () => {
    const { platform, accessory, onChar } = createPlatform()
    const client = {
      setVolume: jest.fn().mockResolvedValue(undefined),
      getVolume: jest.fn().mockResolvedValue(57),
    } as unknown as ConcertClient

    const handler = new VolumePresetAccessory(platform, accessory, client)
    await handler.refresh()
    const setHandler = onChar.onSet.mock.calls[0][0] as (value: boolean) => Promise<void>
    await setHandler(true)
    await setHandler(true)

    expect(client.setVolume).not.toHaveBeenCalled()
    expect(platform.log.info).not.toHaveBeenCalledWith('XR-8S Volume: SET 57')
  })

  it('single-flights concurrent On writes into one setVolume', async () => {
    const { platform, accessory, onChar } = createPlatform()
    let resolveSet: (() => void) | undefined
    const client = {
      setVolume: jest.fn().mockImplementation(() => new Promise<void>((resolve) => {
        resolveSet = resolve
      })),
      getVolume: jest.fn(),
    } as unknown as ConcertClient

    new VolumePresetAccessory(platform, accessory, client)
    const setHandler = onChar.onSet.mock.calls[0][0] as (value: boolean) => Promise<void>
    const first = setHandler(true)
    const second = setHandler(true)
    const third = setHandler(true)

    expect(client.setVolume).toHaveBeenCalledTimes(1)
    resolveSet?.()
    await Promise.all([first, second, third])
    expect(client.setVolume).toHaveBeenCalledTimes(1)
    expect(platform.log.info).toHaveBeenCalledTimes(1)
    expect(platform.log.info).toHaveBeenCalledWith('XR-8S Volume: SET 57')
  })

  it('does not re-set after a successful On when HomeKit repeats the write', async () => {
    const { platform, accessory, onChar } = createPlatform()
    const client = {
      setVolume: jest.fn().mockResolvedValue(undefined),
      getVolume: jest.fn(),
    } as unknown as ConcertClient

    new VolumePresetAccessory(platform, accessory, client)
    const setHandler = onChar.onSet.mock.calls[0][0] as (value: boolean) => Promise<void>
    await setHandler(true)
    await setHandler(true)
    await setHandler(true)

    expect(client.setVolume).toHaveBeenCalledTimes(1)
    expect(platform.log.info).toHaveBeenCalledTimes(1)
  })

  it('treats Off as a no-op and snaps the characteristic back', async () => {
    const { platform, accessory, onChar, switchService } = createPlatform()
    const client = {
      setVolume: jest.fn().mockResolvedValue(undefined),
      getVolume: jest.fn().mockResolvedValue(57),
    } as unknown as ConcertClient

    const handler = new VolumePresetAccessory(platform, accessory, client)
    await handler.refresh()
    const setHandler = onChar.onSet.mock.calls[0][0] as (value: boolean) => Promise<void>
    await setHandler(false)

    expect(client.setVolume).not.toHaveBeenCalled()
    expect(switchService.updateCharacteristic).toHaveBeenCalledWith('On', true)
  })

  it('reports On only when polled volume matches the target', async () => {
    const { platform, accessory, switchService } = createPlatform()
    const client = {
      setVolume: jest.fn(),
      getVolume: jest.fn()
        .mockResolvedValueOnce(40)
        .mockResolvedValueOnce(57),
    } as unknown as ConcertClient

    const handler = new VolumePresetAccessory(platform, accessory, client)
    await handler.refresh()
    expect(switchService.updateCharacteristic).toHaveBeenCalledWith('On', false)

    await handler.refresh()
    expect(switchService.updateCharacteristic).toHaveBeenCalledWith('On', true)
    expect(platform.log.info).toHaveBeenCalledWith(
      expect.stringContaining('(level 57, external)'),
    )
  })

  it('marks Off when volume poll fails after being On', async () => {
    const { platform, accessory, switchService } = createPlatform()
    const client = {
      setVolume: jest.fn(),
      getVolume: jest.fn()
        .mockResolvedValueOnce(57)
        .mockRejectedValueOnce(new Error('standby')),
    } as unknown as ConcertClient

    const handler = new VolumePresetAccessory(platform, accessory, client)
    await handler.refresh()
    await handler.refresh()

    expect(switchService.updateCharacteristic).toHaveBeenCalledWith('On', false)
    expect(platform.log.warn).toHaveBeenCalledWith(
      'XR-8S Volume: poll failed: standby',
    )
  })

  it('reverts and throws HapStatusError when setVolume fails', async () => {
    const { platform, accessory, onChar, switchService } = createPlatform()
    const client = {
      setVolume: jest.fn().mockRejectedValue(new Error('offline')),
      getVolume: jest.fn(),
    } as unknown as ConcertClient

    new VolumePresetAccessory(platform, accessory, client)
    const setHandler = onChar.onSet.mock.calls[0][0] as (value: boolean) => Promise<void>

    await expect(setHandler(true)).rejects.toBeInstanceOf(FakeHapStatusError)
    expect(switchService.updateCharacteristic).toHaveBeenCalledWith('On', false)
  })

  it('requires volume in context', () => {
    const { platform, accessory } = createPlatform()
    ;(accessory.context as { volume?: number }).volume = undefined
    const client = {
      setVolume: jest.fn(),
      getVolume: jest.fn(),
    } as unknown as ConcertClient

    expect(() => new VolumePresetAccessory(platform, accessory, client)).toThrow(/missing volume/)
  })

  it('returns the cached On value from get', () => {
    const { platform, accessory, onChar } = createPlatform()
    const client = {
      setVolume: jest.fn(),
      getVolume: jest.fn(),
    } as unknown as ConcertClient

    new VolumePresetAccessory(platform, accessory, client)
    const getHandler = onChar.onGet.mock.calls[0][0] as () => boolean
    expect(getHandler()).toBe(false)
  })

  it('single-flights concurrent refresh calls', async () => {
    const { platform, accessory } = createPlatform()
    let resolvePoll: ((value: number) => void) | undefined
    const client = {
      setVolume: jest.fn(),
      getVolume: jest.fn().mockImplementation(() => new Promise<number>((resolve) => {
        resolvePoll = resolve
      })),
    } as unknown as ConcertClient

    const handler = new VolumePresetAccessory(platform, accessory, client)
    const first = handler.refresh()
    const second = handler.refresh()
    expect(client.getVolume).toHaveBeenCalledTimes(1)
    resolvePoll?.(57)
    await Promise.all([first, second])
  })

  it('logs recovery after a successful poll following failures', async () => {
    const { platform, accessory } = createPlatform()
    const client = {
      setVolume: jest.fn(),
      getVolume: jest.fn()
        .mockRejectedValueOnce(new Error('timeout'))
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValueOnce(40),
    } as unknown as ConcertClient

    const handler = new VolumePresetAccessory(platform, accessory, client)
    await handler.refresh()
    await handler.refresh()
    await handler.refresh()

    expect(platform.log.debug).toHaveBeenCalledWith(
      'XR-8S Volume: poll failed: timeout',
    )
    expect(platform.log.info).toHaveBeenCalledWith('XR-8S Volume: poll recovered')
  })

  it('discards a stale poll that finishes after a set', async () => {
    const { platform, accessory, onChar, switchService } = createPlatform()
    let resolvePoll: ((value: number) => void) | undefined
    const client = {
      setVolume: jest.fn().mockResolvedValue(undefined),
      getVolume: jest.fn().mockImplementation(() => new Promise<number>((resolve) => {
        resolvePoll = resolve
      })),
    } as unknown as ConcertClient

    const handler = new VolumePresetAccessory(platform, accessory, client)
    const pendingRefresh = handler.refresh()
    const setHandler = onChar.onSet.mock.calls[0][0] as (value: boolean) => Promise<void>
    await setHandler(true)
    resolvePoll?.(40)
    await pendingRefresh

    expect(switchService.updateCharacteristic).not.toHaveBeenCalledWith('On', false)
    const getHandler = onChar.onGet.mock.calls[0][0] as () => boolean
    expect(getHandler()).toBe(true)
  })
})
