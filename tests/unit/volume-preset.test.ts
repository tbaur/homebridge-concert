/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 */

import type { PlatformAccessory } from 'homebridge'
import { HAPStatus } from 'homebridge'

import { ANSWER_INVALID_STATE } from '../../src/api/protocol'
import { VolumePresetAccessory } from '../../src/devices/volume-preset'
import { ProtocolError } from '../../src/errors'
import { HOMEKIT_WRITE_BUDGET_MS, STATE_FRESHNESS_MS } from '../../src/settings'
import type { ConcertClient } from '../../src/api'
import type ConcertPlatform from '../../src/platform'

class FakeHapStatusError extends Error {
  constructor(readonly status: number) {
    super(`HapStatusError:${status}`)
    this.name = 'HapStatusError'
  }
}

/** Minimal client mock; tests override methods as needed. */
function mockClient(overrides: Record<string, unknown> = {}): ConcertClient {
  return {
    // The bounded foreground attempt; the wake retry runs in the background.
    setVolume: jest.fn().mockResolvedValue(undefined),
    setVolumeWhenReady: jest.fn().mockResolvedValue(undefined),
    getVolume: jest.fn(),
    getLastPowerState: jest.fn().mockReturnValue(undefined),
    ...overrides,
  } as unknown as ConcertClient
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
    requestRefresh: jest.fn(),
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
    on: jest.fn(),
    addService: jest.fn(),
  } as unknown as PlatformAccessory

  return { platform, accessory, switchService, onChar }
}

/** The snap-back to HomeKit is deferred a macrotask so HAP cannot clobber it. */
async function flushDeferredUpdates(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve))
}

describe('VolumePresetAccessory', () => {
  it('sets volume when turned On', async () => {
    const { platform, accessory, onChar, switchService } = createPlatform()
    const client = mockClient({
      setVolume: jest.fn().mockResolvedValue(undefined),
    })

    new VolumePresetAccessory(platform, accessory, client)
    const setHandler = onChar.onSet.mock.calls[0][0] as (value: boolean) => Promise<void>
    await setHandler(true)

    // The foreground attempt is bounded so HAP gets an answer before it gives up.
    expect(client.setVolume).toHaveBeenCalledWith(
      57,
      1,
      { timeoutMs: HOMEKIT_WRITE_BUDGET_MS },
    )
    expect(client.setVolumeWhenReady).not.toHaveBeenCalled()
    expect(platform.log.info).toHaveBeenCalledWith('XR-8S Volume: SET 57')
    await flushDeferredUpdates()
    expect(switchService.updateCharacteristic).toHaveBeenCalledWith('On', true)
  })

  it('skips setVolume when already at the preset', async () => {
    const { platform, accessory, onChar } = createPlatform()
    const client = mockClient({
      setVolume: jest.fn().mockResolvedValue(undefined),
      getVolume: jest.fn().mockResolvedValue(57),
    })

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
    const client = mockClient({
      setVolume: jest.fn().mockImplementation(() => new Promise<void>((resolve) => {
        resolveSet = resolve
      })),
    })

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
    const client = mockClient({
      setVolume: jest.fn().mockResolvedValue(undefined),
    })

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
    const client = mockClient({
      setVolume: jest.fn().mockResolvedValue(undefined),
      getVolume: jest.fn().mockResolvedValue(57),
    })

    const handler = new VolumePresetAccessory(platform, accessory, client)
    await handler.refresh()
    const setHandler = onChar.onSet.mock.calls[0][0] as (value: boolean) => Promise<void>
    await setHandler(false)

    expect(client.setVolume).not.toHaveBeenCalled()
    expect(switchService.updateCharacteristic).toHaveBeenCalledWith('On', true)
  })

  it('reports On only when polled volume matches the target', async () => {
    const { platform, accessory, switchService } = createPlatform()
    const client = mockClient({
      getVolume: jest.fn()
        .mockResolvedValueOnce(40)
        .mockResolvedValueOnce(57),
    })

    const handler = new VolumePresetAccessory(platform, accessory, client)
    await handler.refresh()
    expect(switchService.updateCharacteristic).toHaveBeenCalledWith('On', false)

    await handler.refresh()
    expect(switchService.updateCharacteristic).toHaveBeenCalledWith('On', true)
    expect(platform.log.info).toHaveBeenCalledWith(
      expect.stringContaining('(level 57, external)'),
    )
  })

  it('keeps last known On when volume poll fails after being On', async () => {
    const { platform, accessory, switchService, onChar } = createPlatform()
    const client = mockClient({
      getLastPowerState: jest.fn().mockReturnValue(true),
      getVolume: jest.fn()
        .mockResolvedValueOnce(57)
        .mockRejectedValueOnce(new Error('standby')),
    })

    const handler = new VolumePresetAccessory(platform, accessory, client)
    await handler.refresh()
    await handler.refresh()

    expect(switchService.updateCharacteristic).toHaveBeenCalledWith('On', true)
    expect(switchService.updateCharacteristic).not.toHaveBeenCalledWith('On', false)
    expect(platform.log.warn).toHaveBeenCalledWith(
      'XR-8S Volume: poll failed: standby',
    )
    const getHandler = onChar.onGet.mock.calls[0][0] as () => boolean
    expect(getHandler()).toBe(true)
  })

  it('skips the volume query while the zone is in standby', async () => {
    const { platform, accessory } = createPlatform()
    const client = mockClient({
      getLastPowerState: jest.fn().mockReturnValue(false),
      getVolume: jest.fn().mockResolvedValue(57),
    })

    const handler = new VolumePresetAccessory(platform, accessory, client)
    await handler.refresh()

    expect(client.getVolume).not.toHaveBeenCalled()
    expect(platform.log.debug).toHaveBeenCalledWith(
      'XR-8S Volume: skipping volume poll (zone in standby)',
    )
  })

  it('reports Off when the zone enters standby instead of staying stuck On', async () => {
    const { platform, accessory, onChar, switchService } = createPlatform()
    const powered = { value: true }
    const client = mockClient({
      getLastPowerState: jest.fn(() => powered.value),
      getVolume: jest.fn().mockResolvedValue(57),
    })

    const handler = new VolumePresetAccessory(platform, accessory, client)
    await handler.refresh()
    const getHandler = onChar.onGet.mock.calls[0][0] as () => boolean
    expect(getHandler()).toBe(true)

    // The receiver goes to standby. A switch that means "the zone is at 57"
    // cannot be true of a receiver that is off.
    powered.value = false
    await handler.refresh()

    expect(getHandler()).toBe(false)
    expect(switchService.updateCharacteristic).toHaveBeenLastCalledWith('On', false)
    expect(platform.log.info).toHaveBeenCalledWith('XR-8S Volume: OFF (zone in standby)')
  })

  it('re-applies the preset when the cached On value has gone stale', async () => {
    const { platform, accessory, onChar } = createPlatform()
    const client = mockClient({
      getLastPowerState: jest.fn().mockReturnValue(true),
      getVolume: jest.fn().mockResolvedValue(57),
      setVolume: jest.fn().mockResolvedValue(undefined),
    })

    const handler = new VolumePresetAccessory(platform, accessory, client)
    await handler.refresh()
    const setHandler = onChar.onSet.mock.calls[0][0] as (value: boolean) => Promise<void>

    // Fresh reading: the write is redundant and skipped.
    await setHandler(true)
    expect(client.setVolume).not.toHaveBeenCalled()

    // Past the freshness window the level may have been changed at the front
    // panel, so dropping the write would silently do nothing.
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + STATE_FRESHNESS_MS + 1)
    await setHandler(true)
    expect(client.setVolume).toHaveBeenCalledTimes(1)
  })

  it('does not raise a warning for a post-set re-read that fails', async () => {
    const { platform, accessory } = createPlatform()
    const client = mockClient({
      getLastPowerState: jest.fn().mockReturnValue(true),
      getVolume: jest.fn().mockRejectedValue(new Error('invalid command in current state')),
    })

    const handler = new VolumePresetAccessory(platform, accessory, client)

    // The XR rejects reads for ~20s after waking, so the re-read triggered by a
    // power-on is expected to fail. Warning here cried wolf on every power-on.
    await handler.refresh('post-set')
    expect(platform.log.warn).not.toHaveBeenCalled()
    expect(platform.log.debug).toHaveBeenCalledWith(
      'XR-8S Volume: post-set re-read failed: invalid command in current state',
    )

    // A scheduled poll failing is real news and still warns.
    await handler.refresh('poll')
    expect(platform.log.warn).toHaveBeenCalledWith(
      'XR-8S Volume: poll failed: invalid command in current state',
    )
  })

  it('asks the platform to re-read siblings after a successful set', async () => {
    const { platform, accessory, onChar } = createPlatform()
    const client = mockClient({
      setVolume: jest.fn().mockResolvedValue(undefined),
    })

    new VolumePresetAccessory(platform, accessory, client)
    const setHandler = onChar.onSet.mock.calls[0][0] as (value: boolean) => Promise<void>
    await setHandler(true)

    // Only one level can be active, so other presets on this zone are now wrong.
    expect(platform.requestRefresh).toHaveBeenCalled()
  })

  it('reverts and throws HapStatusError when setVolume fails', async () => {
    const { platform, accessory, onChar, switchService } = createPlatform()
    const client = mockClient({
      setVolume: jest.fn().mockRejectedValue(new Error('offline')),
    })

    new VolumePresetAccessory(platform, accessory, client)
    const setHandler = onChar.onSet.mock.calls[0][0] as (value: boolean) => Promise<void>

    await expect(setHandler(true)).rejects.toBeInstanceOf(FakeHapStatusError)
    expect(switchService.updateCharacteristic).toHaveBeenCalledWith('On', false)
  })

  it('distinguishes a permanent value fault from a comms failure', async () => {
    const { platform, accessory, onChar } = createPlatform()
    const client = mockClient({
      setVolume: jest.fn().mockRejectedValue(new RangeError('Volume must be 0–99')),
    })

    new VolumePresetAccessory(platform, accessory, client)
    const setHandler = onChar.onSet.mock.calls[0][0] as (value: boolean) => Promise<void>

    // A bad configured value can never succeed, so HomeKit must not present it
    // as a retryable communication problem.
    await expect(setHandler(true)).rejects.toMatchObject({
      status: HAPStatus.INVALID_VALUE_IN_REQUEST,
    })
  })

  it('reports a transport failure as a communication error', async () => {
    const { platform, accessory, onChar } = createPlatform()
    const client = mockClient({
      setVolume: jest.fn().mockRejectedValue(new Error('Timed out')),
    })

    new VolumePresetAccessory(platform, accessory, client)
    const setHandler = onChar.onSet.mock.calls[0][0] as (value: boolean) => Promise<void>

    await expect(setHandler(true)).rejects.toMatchObject({
      status: HAPStatus.SERVICE_COMMUNICATION_FAILURE,
    })
  })

  it('acknowledges the write and finishes in the background when the receiver is waking', async () => {
    const { platform, accessory, onChar, switchService } = createPlatform()
    let finishWake: (() => void) | undefined
    const client = mockClient({
      setVolume: jest.fn().mockRejectedValue(
        new ProtocolError('volume set rejected: invalid command in current state', {
          answerCode: ANSWER_INVALID_STATE,
        }),
      ),
      setVolumeWhenReady: jest.fn().mockImplementation(() => new Promise<void>((resolve) => {
        finishWake = resolve
      })),
    })

    new VolumePresetAccessory(platform, accessory, client)
    const setHandler = onChar.onSet.mock.calls[0][0] as (value: boolean) => Promise<void>

    // HAP abandons a write after ~9s, so a 60s wake retry cannot be reported
    // through it. The write must resolve, not reject.
    await expect(setHandler(true)).resolves.toBeUndefined()
    expect(platform.log.info).toHaveBeenCalledWith(
      'XR-8S Volume: receiver is not ready (check power); '
      + 'retrying in the background for up to 60s',
    )
    expect(client.setVolumeWhenReady).toHaveBeenCalledWith(57, 1)
    expect(platform.log.info).not.toHaveBeenCalledWith('XR-8S Volume: SET 57')

    finishWake?.()
    await flushDeferredUpdates()

    // Only once the background work lands is HomeKit told the real value.
    expect(platform.log.info).toHaveBeenCalledWith('XR-8S Volume: SET 57')
    expect(switchService.updateCharacteristic).toHaveBeenCalledWith('On', true)
  })

  it('corrects HomeKit when the background completion ultimately fails', async () => {
    const { platform, accessory, onChar, switchService } = createPlatform()
    const client = mockClient({
      setVolume: jest.fn().mockRejectedValue(
        new ProtocolError('invalid command in current state', {
          answerCode: ANSWER_INVALID_STATE,
        }),
      ),
      setVolumeWhenReady: jest.fn().mockRejectedValue(new Error('gave up after 60s')),
    })

    new VolumePresetAccessory(platform, accessory, client)
    const setHandler = onChar.onSet.mock.calls[0][0] as (value: boolean) => Promise<void>

    await expect(setHandler(true)).resolves.toBeUndefined()
    await flushDeferredUpdates()

    expect(platform.log.error).toHaveBeenCalledWith(
      'XR-8S Volume: SET 57 did not complete: gave up after 60s',
    )
    expect(switchService.updateCharacteristic).toHaveBeenLastCalledWith('On', false)
  })

  it('requires volume in context', () => {
    const { platform, accessory } = createPlatform()
    ;(accessory.context as { volume?: number }).volume = undefined
    const client = mockClient()

    expect(() => new VolumePresetAccessory(platform, accessory, client)).toThrow(/missing volume/)
  })

  it('reports No Response until real state has been observed', async () => {
    const { platform, accessory, onChar } = createPlatform()
    const client = mockClient({ getVolume: jest.fn().mockResolvedValue(57) })

    const handler = new VolumePresetAccessory(platform, accessory, client)
    const getHandler = onChar.onGet.mock.calls[0][0] as () => boolean

    expect(() => getHandler()).toThrow(FakeHapStatusError)

    await handler.refresh()
    expect(getHandler()).toBe(true)
  })

  it('single-flights concurrent refresh calls', async () => {
    const { platform, accessory } = createPlatform()
    let resolvePoll: ((value: number) => void) | undefined
    const client = mockClient({
      getVolume: jest.fn().mockImplementation(() => new Promise<number>((resolve) => {
        resolvePoll = resolve
      })),
    })

    const handler = new VolumePresetAccessory(platform, accessory, client)
    const first = handler.refresh()
    const second = handler.refresh()
    expect(client.getVolume).toHaveBeenCalledTimes(1)
    resolvePoll?.(57)
    await Promise.all([first, second])
  })

  it('logs recovery after a successful poll following failures', async () => {
    const { platform, accessory } = createPlatform()
    const client = mockClient({
      getVolume: jest.fn()
        .mockRejectedValueOnce(new Error('timeout'))
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValueOnce(40),
    })

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
    const client = mockClient({
      setVolume: jest.fn().mockResolvedValue(undefined),
      getVolume: jest.fn().mockImplementation(() => new Promise<number>((resolve) => {
        resolvePoll = resolve
      })),
    })

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

  it('skips poll ticks while a volume set is in flight', async () => {
    const { platform, accessory, onChar } = createPlatform()
    let resolveSet: (() => void) | undefined
    const client = mockClient({
      setVolume: jest.fn().mockImplementation(() => new Promise<void>((resolve) => {
        resolveSet = resolve
      })),
      getVolume: jest.fn().mockResolvedValue(40),
    })

    const handler = new VolumePresetAccessory(platform, accessory, client)
    const setHandler = onChar.onSet.mock.calls[0][0] as (value: boolean) => Promise<void>
    const pendingSet = setHandler(true)
    await handler.refresh()
    expect(client.getVolume).not.toHaveBeenCalled()
    resolveSet?.()
    await pendingSet
  })
})
