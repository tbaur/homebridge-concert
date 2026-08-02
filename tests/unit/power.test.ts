/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 */

import type { PlatformAccessory } from 'homebridge'

import { PowerAccessory } from '../../src/devices/power'
import type { ConcertClient } from '../../src/api'
import type ConcertPlatform from '../../src/platform'

class FakeHapStatusError extends Error {
  constructor(readonly status: number) {
    super(`HapStatusError:${status}`)
    this.name = 'HapStatusError'
  }
}

function createPlatform() {
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
    displayName: 'XR-8S',
    context: {
      kind: 'power',
      host: '192.168.1.50',
      port: 50_000,
      zone: 1,
      model: 'Concert XR-8S',
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

  return { platform, accessory, switchService, onChar, infoService }
}

describe('PowerAccessory', () => {
  it('sets power on and updates local state', async () => {
    const { platform, accessory, onChar } = createPlatform()
    const client = {
      setPower: jest.fn().mockResolvedValue(undefined),
      getPowerState: jest.fn(),
    } as unknown as ConcertClient

    new PowerAccessory(platform, accessory, client)
    const setHandler = onChar.onSet.mock.calls[0][0] as (value: boolean) => Promise<void>
    await setHandler(true)

    expect(client.setPower).toHaveBeenCalledWith(true, 1)
    expect(platform.log.info).toHaveBeenCalledWith('XR-8S: ON')
  })

  it('sets FirmwareRevision from the package version', () => {
    const { platform, accessory, infoService } = createPlatform()
    const client = {
      setPower: jest.fn(),
      getPowerState: jest.fn(),
    } as unknown as ConcertClient

    new PowerAccessory(platform, accessory, client)
    expect(infoService.setCharacteristic).toHaveBeenCalledWith('FirmwareRevision', expect.stringMatching(/^\d+\.\d+\.\d+/))
  })

  it('reverts the characteristic and throws HapStatusError when setPower fails', async () => {
    const { platform, accessory, onChar, switchService } = createPlatform()
    const client = {
      setPower: jest.fn().mockRejectedValue(new Error('offline')),
      getPowerState: jest.fn(),
    } as unknown as ConcertClient

    new PowerAccessory(platform, accessory, client)
    const setHandler = onChar.onSet.mock.calls[0][0] as (value: boolean) => Promise<void>

    await expect(setHandler(true)).rejects.toBeInstanceOf(FakeHapStatusError)
    expect(switchService.updateCharacteristic).toHaveBeenCalledWith('On', false)
    expect(platform.log.error).toHaveBeenCalledWith(expect.stringContaining('offline'))
  })

  it('polls power state into HomeKit', async () => {
    const { platform, accessory, switchService } = createPlatform()
    const client = {
      setPower: jest.fn(),
      getPowerState: jest.fn().mockResolvedValue(true),
    } as unknown as ConcertClient

    const handler = new PowerAccessory(platform, accessory, client)
    await handler.refresh()

    expect(client.getPowerState).toHaveBeenCalledWith(1)
    expect(switchService.updateCharacteristic).toHaveBeenCalledWith('On', true)
  })

  it('warns once on poll failure then demotes to debug', async () => {
    const { platform, accessory } = createPlatform()
    const client = {
      setPower: jest.fn(),
      getPowerState: jest.fn().mockRejectedValue(new Error('Timed out waiting for response')),
    } as unknown as ConcertClient

    const handler = new PowerAccessory(platform, accessory, client)
    await handler.refresh()
    await handler.refresh()

    expect(platform.log.warn).toHaveBeenCalledTimes(1)
    expect(platform.log.warn).toHaveBeenCalledWith(
      'XR-8S power poll failed: Timed out waiting for response',
    )
    expect(platform.log.debug).toHaveBeenCalledWith(
      'XR-8S power poll failed: Timed out waiting for response',
    )
  })

  it('discards a stale poll that finishes after a set', async () => {
    const { platform, accessory, onChar, switchService } = createPlatform()
    let resolvePoll: ((value: boolean) => void) | undefined
    const client = {
      setPower: jest.fn().mockResolvedValue(undefined),
      getPowerState: jest.fn().mockImplementation(() => new Promise<boolean>((resolve) => {
        resolvePoll = resolve
      })),
    } as unknown as ConcertClient

    const handler = new PowerAccessory(platform, accessory, client)
    const pendingRefresh = handler.refresh()
    const setHandler = onChar.onSet.mock.calls[0][0] as (value: boolean) => Promise<void>
    await setHandler(true)
    resolvePoll?.(false)
    await pendingRefresh

    expect(switchService.updateCharacteristic).not.toHaveBeenCalledWith('On', false)
    expect(platform.log.info).toHaveBeenCalledWith('XR-8S: ON')
    expect(platform.log.info).not.toHaveBeenCalledWith(expect.stringContaining('(external)'))
    const getHandler = onChar.onGet.mock.calls[0][0] as () => boolean
    expect(getHandler()).toBe(true)
  })

  it('logs ON from HomeKit set even when a poll starts during setPower', async () => {
    const { platform, accessory, onChar } = createPlatform()
    let resolveSet: (() => void) | undefined
    let resolvePoll: ((value: boolean) => void) | undefined
    const client = {
      setPower: jest.fn().mockImplementation(() => new Promise<void>((resolve) => {
        resolveSet = resolve
      })),
      getPowerState: jest.fn().mockImplementation(() => new Promise<boolean>((resolve) => {
        resolvePoll = resolve
      })),
    } as unknown as ConcertClient

    const handler = new PowerAccessory(platform, accessory, client)
    const setHandler = onChar.onSet.mock.calls[0][0] as (value: boolean) => Promise<void>

    const pendingSet = setHandler(true)
    const pendingRefresh = handler.refresh()
    resolveSet?.()
    await pendingSet
    resolvePoll?.(true)
    await pendingRefresh

    expect(platform.log.info).toHaveBeenCalledWith('XR-8S: ON')
    expect(platform.log.info).not.toHaveBeenCalledWith('XR-8S: ON (external)')
    const getHandler = onChar.onGet.mock.calls[0][0] as () => boolean
    expect(getHandler()).toBe(true)
  })

  it('logs (external) only for poll-observed changes', async () => {
    const { platform, accessory } = createPlatform()
    const client = {
      setPower: jest.fn(),
      getPowerState: jest.fn().mockResolvedValue(true),
    } as unknown as ConcertClient

    const handler = new PowerAccessory(platform, accessory, client)
    await handler.refresh()

    expect(platform.log.info).toHaveBeenCalledWith('XR-8S: ON (external)')
  })

  it('returns the cached On value from get', () => {
    const { platform, accessory, onChar } = createPlatform()
    const client = {
      setPower: jest.fn(),
      getPowerState: jest.fn(),
    } as unknown as ConcertClient

    new PowerAccessory(platform, accessory, client)
    const getHandler = onChar.onGet.mock.calls[0][0] as () => boolean
    expect(getHandler()).toBe(false)
  })

  it('single-flights concurrent refresh calls', async () => {
    const { platform, accessory } = createPlatform()
    let resolvePoll: ((value: boolean) => void) | undefined
    const client = {
      setPower: jest.fn(),
      getPowerState: jest.fn().mockImplementation(() => new Promise<boolean>((resolve) => {
        resolvePoll = resolve
      })),
    } as unknown as ConcertClient

    const handler = new PowerAccessory(platform, accessory, client)
    const first = handler.refresh()
    const second = handler.refresh()
    expect(client.getPowerState).toHaveBeenCalledTimes(1)
    resolvePoll?.(true)
    await Promise.all([first, second])
  })

  it('logs recovery after a successful poll following failures', async () => {
    const { platform, accessory } = createPlatform()
    const client = {
      setPower: jest.fn(),
      getPowerState: jest.fn()
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValueOnce(false),
    } as unknown as ConcertClient

    const handler = new PowerAccessory(platform, accessory, client)
    await handler.refresh()
    await handler.refresh()

    expect(platform.log.info).toHaveBeenCalledWith('XR-8S power poll recovered')
  })
})
