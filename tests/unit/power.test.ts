/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 */

import type { PlatformAccessory } from 'homebridge'

import { PowerAccessory } from '../../src/devices/power'
import { ConnectionError } from '../../src/errors'
import { POLL_FAILURES_BEFORE_UNKNOWN, POWER_SET_TIMEOUT_MS } from '../../src/settings'
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
    requestRefresh: jest.fn(),
    log: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
  } as unknown as ConcertPlatform

  const accessory = {
    displayName: 'XR-8S Power',
    context: {
      kind: 'power',
      host: '192.168.1.50',
      port: 50_000,
      zone: 1,
      model: 'AudioControl Concert XR-8S',
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
    on: jest.fn(),
    addService: jest.fn(),
  } as unknown as PlatformAccessory

  return { platform, accessory, switchService, onChar, infoService }
}

/** The snap-back to HomeKit is deferred a macrotask so HAP cannot clobber it. */
async function flushDeferredUpdates(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve))
}

describe('PowerAccessory', () => {
  it('sets power on and updates local state', async () => {
    const { platform, accessory, onChar, switchService } = createPlatform()
    const client = {
      setPower: jest.fn().mockResolvedValue(undefined),
      getPowerState: jest.fn(),
    } as unknown as ConcertClient

    new PowerAccessory(platform, accessory, client)
    const setHandler = onChar.onSet.mock.calls[0][0] as (value: boolean) => Promise<void>
    await setHandler(true)

    expect(client.setPower).toHaveBeenCalledWith(true, 1, { timeoutMs: POWER_SET_TIMEOUT_MS })
    expect(platform.log.info).toHaveBeenCalledWith('XR-8S Power: ON')
    await flushDeferredUpdates()
    expect(switchService.updateCharacteristic).toHaveBeenCalledWith('On', true)
  })

  it('sets standby and reports it as STANDBY, not OFF', async () => {
    const { platform, accessory, onChar } = createPlatform()
    const client = {
      setPower: jest.fn().mockResolvedValue(undefined),
      getPowerState: jest.fn(),
    } as unknown as ConcertClient

    new PowerAccessory(platform, accessory, client)
    const setHandler = onChar.onSet.mock.calls[0][0] as (value: boolean) => Promise<void>
    await setHandler(false)

    expect(client.setPower).toHaveBeenCalledWith(false, 1, { timeoutMs: POWER_SET_TIMEOUT_MS })
    expect(platform.log.info).toHaveBeenCalledWith('XR-8S Power: STANDBY')
  })

  it('reports an externally observed power-off as STANDBY (external)', async () => {
    const { platform, accessory } = createPlatform()
    const client = {
      setPower: jest.fn(),
      getPowerState: jest.fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false),
    } as unknown as ConcertClient

    const handler = new PowerAccessory(platform, accessory, client)
    await handler.refresh()
    await handler.refresh()

    expect(platform.log.info).toHaveBeenCalledWith('XR-8S Power: STANDBY (external)')
  })

  it('reports No Response again after a sustained failure streak', async () => {
    const { platform, accessory, onChar } = createPlatform()
    const reachable = { value: true }
    const client = {
      setPower: jest.fn(),
      getPowerState: jest.fn(() => (reachable.value
        ? Promise.resolve(true)
        : Promise.reject(new Error('Timed out connecting')))),
    } as unknown as ConcertClient

    const handler = new PowerAccessory(platform, accessory, client)
    const getHandler = onChar.onGet.mock.calls[0][0] as () => boolean

    await handler.refresh()
    expect(getHandler()).toBe(true)

    reachable.value = false
    for (let i = 0; i < POLL_FAILURES_BEFORE_UNKNOWN - 1; i++) {
      await handler.refresh()
      // A short streak keeps the last known value so one timeout cannot make
      // the switch flicker.
      expect(getHandler()).toBe(true)
    }

    await handler.refresh()
    expect(() => getHandler()).toThrow(FakeHapStatusError)
    expect(platform.log.warn).toHaveBeenCalledWith(
      `XR-8S Power: state unknown after ${POLL_FAILURES_BEFORE_UNKNOWN} `
      + 'failed polls; reporting No Response',
    )

    // Recovery restores a real value and announces that the streak ended.
    reachable.value = true
    await handler.refresh()
    expect(getHandler()).toBe(true)
    expect(platform.log.info).toHaveBeenCalledWith('XR-8S Power: poll recovered')
  })

  it('acknowledges the write and confirms power in the background', async () => {
    const { platform, accessory, onChar, switchService } = createPlatform()
    let confirm: (() => void) | undefined
    const setPower = jest.fn()
      .mockRejectedValueOnce(new ConnectionError('Timed out waiting for a response'))
      .mockImplementationOnce(() => new Promise<void>((resolve) => {
        confirm = resolve
      }))
    const client = { setPower, getPowerState: jest.fn() } as unknown as ConcertClient

    new PowerAccessory(platform, accessory, client)
    const setHandler = onChar.onSet.mock.calls[0][0] as (value: boolean) => Promise<void>

    // HAP abandons the write at ~9s, and confirming a missing ack takes longer,
    // so the write must resolve and the confirmation continue out of band.
    await expect(setHandler(true)).resolves.toBeUndefined()
    expect(platform.log.info).toHaveBeenCalledWith('XR-8S Power: confirming ON in the background')
    expect(platform.log.info).not.toHaveBeenCalledWith('XR-8S Power: ON')

    confirm?.()
    await flushDeferredUpdates()
    expect(platform.log.info).toHaveBeenCalledWith('XR-8S Power: ON')
    expect(switchService.updateCharacteristic).toHaveBeenCalledWith('On', true)
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

  it('uses a persisted opaque SerialNumber, not host:port', () => {
    const { platform, accessory, infoService } = createPlatform()
    ;(accessory.context as { serialNumber?: string }).serialNumber = 'persisted-serial'
    const client = {
      setPower: jest.fn(),
      getPowerState: jest.fn(),
    } as unknown as ConcertClient

    new PowerAccessory(platform, accessory, client)
    expect(infoService.setCharacteristic).toHaveBeenCalledWith('SerialNumber', 'persisted-serial')
    expect(infoService.setCharacteristic).not.toHaveBeenCalledWith(
      'SerialNumber',
      expect.stringContaining('192.168.1.50'),
    )
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
      'XR-8S Power: poll failed: Timed out waiting for response',
    )
    expect(platform.log.debug).toHaveBeenCalledWith(
      'XR-8S Power: poll failed: Timed out waiting for response',
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
    expect(platform.log.info).toHaveBeenCalledWith('XR-8S Power: ON')
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

    expect(platform.log.info).toHaveBeenCalledWith('XR-8S Power: ON')
    expect(platform.log.info).not.toHaveBeenCalledWith('XR-8S Power: ON (external)')
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

    expect(platform.log.info).toHaveBeenCalledWith('XR-8S Power: ON (external)')
  })

  it('reports No Response until real state has been observed', async () => {
    const { platform, accessory, onChar } = createPlatform()
    const client = {
      setPower: jest.fn(),
      getPowerState: jest.fn().mockResolvedValue(true),
    } as unknown as ConcertClient

    const handler = new PowerAccessory(platform, accessory, client)
    const getHandler = onChar.onGet.mock.calls[0][0] as () => boolean

    // Answering "off" before the first poll would let an automation act on a
    // value the plugin invented.
    expect(() => getHandler()).toThrow(FakeHapStatusError)

    await handler.refresh()
    expect(getHandler()).toBe(true)
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

    expect(platform.log.info).toHaveBeenCalledWith('XR-8S Power: poll recovered')
  })
})
