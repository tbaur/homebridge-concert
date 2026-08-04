/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 */

import { EventEmitter } from 'node:events'
import type net from 'node:net'

import { ConcertClient } from '../../src/api/client'
import { ConnectionError, ProtocolError } from '../../src/errors'
import {
  ANSWER_INVALID_STATE,
  ANSWER_OK,
  COMMAND_RC5,
  COMMAND_SOURCE,
  COMMAND_VOLUME,
  POWER_ON,
  RC5_POWER_OFF,
  RC5_POWER_ON,
  RC5_SYSTEM_ZONE1,
  buildPowerOn,
} from '../../src/api/protocol'
import {
  MAX_RESPONSE_BUFFER_BYTES,
  POWER_QUERY_RETRY_MS,
  SOURCE_READY_NOT_READY_LOG_AFTER_MS,
  SOURCE_READY_RETRY_INTERVAL_MS,
  SOURCE_READY_TIMEOUT_MS,
  VOLUME_READY_NOT_READY_LOG_AFTER_MS,
  VOLUME_READY_RETRY_INTERVAL_MS,
  VOLUME_READY_TIMEOUT_MS,
} from '../../src/settings'

class FakeSocket extends EventEmitter {
  destroyed = false
  written: Buffer[] = []

  write(data: Buffer, callback?: (error?: Error | null) => void): boolean {
    this.written.push(Buffer.from(data))
    callback?.(null)
    return true
  }

  destroy(): void {
    this.destroyed = true
    this.emit('close')
  }

  removeAllListeners(event?: string | symbol): this {
    super.removeAllListeners(event)
    return this
  }
}

describe('ConcertClient', () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  it('queries power state over a short-lived TCP connection', async () => {
    const socket = new FakeSocket()
    const createConnection = jest.fn(() => {
      queueMicrotask(() => socket.emit('connect'))
      return socket as unknown as net.Socket
    })

    const client = new ConcertClient({
      host: '192.168.1.50',
      createConnection: createConnection as unknown as typeof net.createConnection,
    })

    const pending = client.getPowerState()
    await new Promise((resolve) => setImmediate(resolve))
    expect(socket.written[0]).toEqual(Buffer.from([0x21, 0x01, 0x00, 0x01, 0xf0, 0x0d]))
    socket.emit('data', Buffer.from([0x21, 0x01, 0x00, ANSWER_OK, 0x01, POWER_ON, 0x0d]))

    await expect(pending).resolves.toBe(true)
    expect(socket.destroyed).toBe(true)
  })

  it('sends RC5 power-on and standby commands', async () => {
    const replies = [
      Buffer.from([0x21, 0x01, COMMAND_RC5, ANSWER_OK, 0x02, RC5_SYSTEM_ZONE1, RC5_POWER_ON, 0x0d]),
      Buffer.from([0x21, 0x01, COMMAND_RC5, ANSWER_OK, 0x02, RC5_SYSTEM_ZONE1, RC5_POWER_OFF, 0x0d]),
    ]
    let call = 0
    const written: Buffer[] = []

    const createConnection = jest.fn(() => {
      const socket = new FakeSocket()
      queueMicrotask(() => {
        socket.emit('connect')
        queueMicrotask(() => {
          written.push(...socket.written)
          socket.emit('data', replies[call++])
        })
      })
      return socket as unknown as net.Socket
    })

    const client = new ConcertClient({
      host: '192.168.1.50',
      createConnection: createConnection as unknown as typeof net.createConnection,
    })

    await expect(client.powerOn()).resolves.toBeUndefined()
    await expect(client.powerStandby()).resolves.toBeUndefined()
    expect(createConnection).toHaveBeenCalledTimes(2)
    expect([...written[0]]).toEqual([0x21, 0x01, COMMAND_RC5, 0x02, RC5_SYSTEM_ZONE1, RC5_POWER_ON, 0x0d])
    expect([...written[1]]).toEqual([0x21, 0x01, COMMAND_RC5, 0x02, RC5_SYSTEM_ZONE1, RC5_POWER_OFF, 0x0d])
  })

  it('accepts a Power status frame after an RC5 set (additional status message)', async () => {
    const socket = new FakeSocket()
    const createConnection = jest.fn(() => {
      queueMicrotask(() => socket.emit('connect'))
      return socket as unknown as net.Socket
    })

    const client = new ConcertClient({
      host: '192.168.1.50',
      createConnection: createConnection as unknown as typeof net.createConnection,
    })

    const pending = client.powerStandby()
    await new Promise((resolve) => setImmediate(resolve))
    // Only the following Power status arrives (RC5 ack omitted).
    socket.emit('data', Buffer.from([0x21, 0x01, 0x00, ANSWER_OK, 0x01, 0x00, 0x0d]))
    await expect(pending).resolves.toBeUndefined()
  })

  it('throws ProtocolError on a non-OK answer code', async () => {
    const createConnection = jest.fn(() => {
      const socket = new FakeSocket()
      queueMicrotask(() => {
        socket.emit('connect')
        queueMicrotask(() => {
          socket.emit('data', Buffer.from([0x21, 0x01, 0x00, 0x83, 0x00, 0x0d]))
        })
      })
      return socket as unknown as net.Socket
    })

    const client = new ConcertClient({
      host: '192.168.1.50',
      createConnection: createConnection as unknown as typeof net.createConnection,
    })

    await expect(client.setPower(true)).rejects.toBeInstanceOf(ProtocolError)
  })

  it('ignores unmatched frames then accepts a matching power response', async () => {
    const socket = new FakeSocket()
    const createConnection = jest.fn(() => {
      queueMicrotask(() => socket.emit('connect'))
      return socket as unknown as net.Socket
    })

    const client = new ConcertClient({
      host: '192.168.1.50',
      createConnection: createConnection as unknown as typeof net.createConnection,
    })

    const pending = client.getPowerState()
    await new Promise((resolve) => setImmediate(resolve))
    // Wrong command (0x0A), then correct power response.
    socket.emit('data', Buffer.from([
      0x21, 0x01, 0x0a, ANSWER_OK, 0x01, 0x01, 0x0d,
      0x21, 0x01, 0x00, ANSWER_OK, 0x01, POWER_ON, 0x0d,
    ]))

    await expect(pending).resolves.toBe(true)
  })

  it('throws ConnectionError when the socket errors', async () => {
    const createConnection = jest.fn(() => {
      const socket = new FakeSocket()
      queueMicrotask(() => socket.emit('error', new Error('ECONNREFUSED')))
      return socket as unknown as net.Socket
    })

    const client = new ConcertClient({
      host: '192.168.1.50',
      createConnection: createConnection as unknown as typeof net.createConnection,
    })

    await expect(client.getPowerState()).rejects.toBeInstanceOf(ConnectionError)
  })

  it('times out if connect never completes (and retry)', async () => {
    jest.useFakeTimers()
    const createConnection = jest.fn(() => new FakeSocket() as unknown as net.Socket)

    const client = new ConcertClient({
      host: '192.168.1.50',
      connectTimeoutMs: 100,
      createConnection: createConnection as unknown as typeof net.createConnection,
    })

    // Attach the rejection handler before timers fire so Jest does not see an
    // unhandled rejection during advanceTimersByTimeAsync.
    const pending = expect(client.getPowerState()).rejects.toThrow(/Timed out connecting/)
    await jest.advanceTimersByTimeAsync(100) // first attempt
    await jest.advanceTimersByTimeAsync(POWER_QUERY_RETRY_MS)
    await jest.advanceTimersByTimeAsync(100) // retry attempt
    await pending
    expect(createConnection).toHaveBeenCalledTimes(2)
  })

  it('times out if a response never arrives after connect (and retry)', async () => {
    jest.useFakeTimers()
    const createConnection = jest.fn(() => {
      const socket = new FakeSocket()
      queueMicrotask(() => socket.emit('connect'))
      return socket as unknown as net.Socket
    })

    const client = new ConcertClient({
      host: '192.168.1.50',
      requestTimeoutMs: 100,
      createConnection: createConnection as unknown as typeof net.createConnection,
    })

    const pending = expect(client.getPowerState()).rejects.toThrow(
      'Timed out waiting for response',
    )
    await Promise.resolve()
    await jest.advanceTimersByTimeAsync(100) // first attempt timeout
    await jest.advanceTimersByTimeAsync(POWER_QUERY_RETRY_MS) // retry delay
    await jest.advanceTimersByTimeAsync(100) // second attempt timeout
    await pending
    expect(createConnection).toHaveBeenCalledTimes(2)
  })

  it('retries a timed-out power query and succeeds', async () => {
    jest.useFakeTimers()
    let call = 0
    const createConnection = jest.fn(() => {
      const socket = new FakeSocket()
      const index = call++
      queueMicrotask(() => {
        socket.emit('connect')
        if (index >= 1) {
          queueMicrotask(() => {
            socket.emit('data', Buffer.from([0x21, 0x01, 0x00, ANSWER_OK, 0x01, POWER_ON, 0x0d]))
          })
        }
      })
      return socket as unknown as net.Socket
    })

    const client = new ConcertClient({
      host: '192.168.1.50',
      requestTimeoutMs: 100,
      createConnection: createConnection as unknown as typeof net.createConnection,
    })

    const pending = client.getPowerState()
    await Promise.resolve()
    await jest.advanceTimersByTimeAsync(100) // first attempt timeout
    await jest.advanceTimersByTimeAsync(POWER_QUERY_RETRY_MS)
    await expect(pending).resolves.toBe(true)
    expect(createConnection).toHaveBeenCalledTimes(2)
  })

  it('rejects oversized response buffers', async () => {
    const socket = new FakeSocket()
    const createConnection = jest.fn(() => {
      queueMicrotask(() => socket.emit('connect'))
      return socket as unknown as net.Socket
    })

    const client = new ConcertClient({
      host: '192.168.1.50',
      createConnection: createConnection as unknown as typeof net.createConnection,
    })

    const pending = client.getPowerState()
    await new Promise((resolve) => setImmediate(resolve))
    socket.emit('data', Buffer.alloc(MAX_RESPONSE_BUFFER_BYTES + 1, 0x21))
    await expect(pending).rejects.toBeInstanceOf(ProtocolError)
  })

  it('writes the expected RC5 power-on frame', () => {
    expect([...buildPowerOn(1)]).toEqual([
      0x21, 0x01, COMMAND_RC5, 0x02, RC5_SYSTEM_ZONE1, RC5_POWER_ON, 0x0d,
    ])
  })

  it('queries and sets source via 0x1D / RC5', async () => {
    const replies = [
      Buffer.from([0x21, 0x01, COMMAND_SOURCE, ANSWER_OK, 0x01, 0x01, 0x0d]),
      Buffer.from([0x21, 0x01, COMMAND_RC5, ANSWER_OK, 0x02, RC5_SYSTEM_ZONE1, 0x76, 0x0d]),
    ]
    let call = 0
    const written: Buffer[] = []

    const createConnection = jest.fn(() => {
      const socket = new FakeSocket()
      queueMicrotask(() => {
        socket.emit('connect')
        queueMicrotask(() => {
          written.push(...socket.written)
          socket.emit('data', replies[call++])
        })
      })
      return socket as unknown as net.Socket
    })

    const client = new ConcertClient({
      host: '192.168.1.50',
      createConnection: createConnection as unknown as typeof net.createConnection,
    })

    await expect(client.getSource()).resolves.toBe('cd')
    await expect(client.setSource('CD')).resolves.toBeUndefined()
    expect([...written[0]]).toEqual([0x21, 0x01, COMMAND_SOURCE, 0x01, 0xf0, 0x0d])
    expect([...written[1]]).toEqual([0x21, 0x01, COMMAND_RC5, 0x02, RC5_SYSTEM_ZONE1, 0x76, 0x0d])
  })

  it('resolves Zone 2 Follow Zone 1 by querying Zone 1 source', async () => {
    const replies = [
      // Zone 2: Follow Zone 1
      Buffer.from([0x21, 0x02, COMMAND_SOURCE, ANSWER_OK, 0x01, 0x00, 0x0d]),
      // Zone 1: CD
      Buffer.from([0x21, 0x01, COMMAND_SOURCE, ANSWER_OK, 0x01, 0x01, 0x0d]),
    ]
    let call = 0
    const written: Buffer[] = []

    const createConnection = jest.fn(() => {
      const socket = new FakeSocket()
      queueMicrotask(() => {
        socket.emit('connect')
        queueMicrotask(() => {
          written.push(...socket.written)
          socket.emit('data', replies[call++])
        })
      })
      return socket as unknown as net.Socket
    })

    const client = new ConcertClient({
      host: '192.168.1.50',
      createConnection: createConnection as unknown as typeof net.createConnection,
    })

    await expect(client.getSource(2)).resolves.toBe('cd')
    expect([...written[0]]).toEqual([0x21, 0x02, COMMAND_SOURCE, 0x01, 0xf0, 0x0d])
    expect([...written[1]]).toEqual([0x21, 0x01, COMMAND_SOURCE, 0x01, 0xf0, 0x0d])
  })

  it('succeeds when power-set times out but a later query confirms standby', async () => {
    jest.useFakeTimers()
    let call = 0
    const createConnection = jest.fn(() => {
      const socket = new FakeSocket()
      const index = call++
      queueMicrotask(() => {
        socket.emit('connect')
        if (index >= 1) {
          queueMicrotask(() => {
            // Power query: zone in standby
            socket.emit('data', Buffer.from([0x21, 0x01, 0x00, ANSWER_OK, 0x01, 0x00, 0x0d]))
          })
        }
      })
      return socket as unknown as net.Socket
    })

    const client = new ConcertClient({
      host: '192.168.1.50',
      requestTimeoutMs: 100,
      createConnection: createConnection as unknown as typeof net.createConnection,
    })

    const pending = client.setPower(false)
    await Promise.resolve()
    await jest.advanceTimersByTimeAsync(100) // set timeout
    await jest.advanceTimersByTimeAsync(1_500) // settle before verify query
    await expect(pending).resolves.toBeUndefined()
    expect(createConnection).toHaveBeenCalledTimes(2)
  })

  it('rethrows when power-set times out and verify query disagrees', async () => {
    jest.useFakeTimers()
    let call = 0
    const createConnection = jest.fn(() => {
      const socket = new FakeSocket()
      const index = call++
      queueMicrotask(() => {
        socket.emit('connect')
        if (index >= 1) {
          queueMicrotask(() => {
            // Still on — command did not take effect
            socket.emit('data', Buffer.from([0x21, 0x01, 0x00, ANSWER_OK, 0x01, POWER_ON, 0x0d]))
          })
        }
      })
      return socket as unknown as net.Socket
    })

    const client = new ConcertClient({
      host: '192.168.1.50',
      requestTimeoutMs: 100,
      createConnection: createConnection as unknown as typeof net.createConnection,
    })

    const pending = client.setPower(false)
    await Promise.resolve()
    await jest.advanceTimersByTimeAsync(100) // set timeout → verify path
    await jest.advanceTimersByTimeAsync(1_500) // settle + first disagreeing query
    await jest.advanceTimersByTimeAsync(1_500) // settle + second disagreeing query
    await expect(pending).rejects.toBeInstanceOf(ConnectionError)
    expect(createConnection).toHaveBeenCalledTimes(3)
  })

  it('queries and sets volume over short-lived TCP connections', async () => {
    const replies = [
      Buffer.from([0x21, 0x01, COMMAND_VOLUME, ANSWER_OK, 0x01, 57, 0x0d]),
      Buffer.from([0x21, 0x01, COMMAND_VOLUME, ANSWER_OK, 0x01, 57, 0x0d]),
    ]
    let call = 0
    const written: Buffer[] = []

    const createConnection = jest.fn(() => {
      const socket = new FakeSocket()
      queueMicrotask(() => {
        socket.emit('connect')
        queueMicrotask(() => {
          written.push(...socket.written)
          socket.emit('data', replies[call++])
        })
      })
      return socket as unknown as net.Socket
    })

    const client = new ConcertClient({
      host: '192.168.1.50',
      createConnection: createConnection as unknown as typeof net.createConnection,
    })

    await expect(client.getVolume(1)).resolves.toBe(57)
    await expect(client.setVolume(57, 1)).resolves.toBeUndefined()
    expect([...written[0]]).toEqual([0x21, 0x01, COMMAND_VOLUME, 0x01, 0xf0, 0x0d])
    expect([...written[1]]).toEqual([0x21, 0x01, COMMAND_VOLUME, 0x01, 57, 0x0d])
  })

  it('single-flights concurrent getVolume calls for the same zone', async () => {
    const socket = new FakeSocket()
    const createConnection = jest.fn(() => {
      queueMicrotask(() => socket.emit('connect'))
      return socket as unknown as net.Socket
    })

    const client = new ConcertClient({
      host: '192.168.1.50',
      createConnection: createConnection as unknown as typeof net.createConnection,
    })

    const first = client.getVolume(1)
    const second = client.getVolume(1)
    await new Promise((resolve) => setImmediate(resolve))
    expect(createConnection).toHaveBeenCalledTimes(1)
    socket.emit('data', Buffer.from([0x21, 0x01, COMMAND_VOLUME, ANSWER_OK, 0x01, 40, 0x0d]))
    await expect(Promise.all([first, second])).resolves.toEqual([40, 40])
  })

  it('succeeds when volume-set times out but a later query confirms the level', async () => {
    jest.useFakeTimers()
    let call = 0
    const createConnection = jest.fn(() => {
      const socket = new FakeSocket()
      const index = call++
      queueMicrotask(() => {
        socket.emit('connect')
        if (index >= 1) {
          queueMicrotask(() => {
            socket.emit('data', Buffer.from([0x21, 0x01, COMMAND_VOLUME, ANSWER_OK, 0x01, 57, 0x0d]))
          })
        }
      })
      return socket as unknown as net.Socket
    })

    const client = new ConcertClient({
      host: '192.168.1.50',
      requestTimeoutMs: 100,
      createConnection: createConnection as unknown as typeof net.createConnection,
    })

    const pending = client.setVolume(57, 1)
    await Promise.resolve()
    await jest.advanceTimersByTimeAsync(100)
    await jest.advanceTimersByTimeAsync(1_500)
    await expect(pending).resolves.toBeUndefined()
    expect(createConnection).toHaveBeenCalledTimes(2)
  })

  it('setVolumeWhenReady retries after invalid-state then succeeds', async () => {
    jest.useFakeTimers()
    const logger = { info: jest.fn(), debug: jest.fn() }
    const client = new ConcertClient({
      host: '192.168.1.50',
      logger,
      createConnection: jest.fn() as unknown as typeof net.createConnection,
    })
    const setVolume = jest.spyOn(client, 'setVolume')
      .mockRejectedValueOnce(new ProtocolError('volume set rejected: invalid command in current state', {
        answerCode: ANSWER_INVALID_STATE,
      }))
      .mockResolvedValueOnce(undefined)

    const onWaiting = jest.fn()
    const pending = client.setVolumeWhenReady(57, 1, { onWaiting })
    await Promise.resolve()
    await jest.advanceTimersByTimeAsync(VOLUME_READY_RETRY_INTERVAL_MS)
    await expect(pending).resolves.toBeUndefined()
    expect(setVolume).toHaveBeenCalledTimes(2)
    // Normal ~20s wake finishes before the not-ready info threshold.
    expect(onWaiting).not.toHaveBeenCalled()
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('receiver ready'))
  })

  it('setVolumeWhenReady notifies onWaiting only after the not-ready log delay', async () => {
    jest.useFakeTimers()
    const client = new ConcertClient({
      host: '192.168.1.50',
      createConnection: jest.fn() as unknown as typeof net.createConnection,
    })
    const notReady = new ProtocolError(
      'volume set rejected: invalid command in current state',
      { answerCode: ANSWER_INVALID_STATE },
    )
    const setVolume = jest.spyOn(client, 'setVolume').mockRejectedValue(notReady)

    const onWaiting = jest.fn()
    const pending = client.setVolumeWhenReady(57, 1, { onWaiting })
    await Promise.resolve()
    await jest.advanceTimersByTimeAsync(VOLUME_READY_NOT_READY_LOG_AFTER_MS - 1)
    expect(onWaiting).not.toHaveBeenCalled()

    // Cross the log threshold while still failing, then succeed on the next try.
    await jest.advanceTimersByTimeAsync(VOLUME_READY_RETRY_INTERVAL_MS)
    expect(onWaiting).toHaveBeenCalledTimes(1)

    setVolume.mockResolvedValueOnce(undefined)
    await jest.advanceTimersByTimeAsync(VOLUME_READY_RETRY_INTERVAL_MS)
    await expect(pending).resolves.toBeUndefined()
  })

  it('setVolumeWhenReady does not retry permanent protocol errors', async () => {
    const client = new ConcertClient({
      host: '192.168.1.50',
      createConnection: jest.fn() as unknown as typeof net.createConnection,
    })
    const setVolume = jest.spyOn(client, 'setVolume').mockRejectedValue(
      new ProtocolError('volume set rejected: incorrect parameter', { answerCode: 0x84 }),
    )

    await expect(client.setVolumeWhenReady(57, 1)).rejects.toBeInstanceOf(ProtocolError)
    expect(setVolume).toHaveBeenCalledTimes(1)
  })

  it('setVolumeWhenReady gives up after the ready timeout', async () => {
    jest.useFakeTimers()
    const client = new ConcertClient({
      host: '192.168.1.50',
      createConnection: jest.fn() as unknown as typeof net.createConnection,
    })
    const setVolume = jest.spyOn(client, 'setVolume').mockRejectedValue(
      new ProtocolError('volume set rejected: invalid command in current state', {
        answerCode: ANSWER_INVALID_STATE,
      }),
    )

    const pending = client.setVolumeWhenReady(57, 1)
    const expectation = expect(pending).rejects.toBeInstanceOf(ProtocolError)
    await jest.advanceTimersByTimeAsync(VOLUME_READY_TIMEOUT_MS + VOLUME_READY_RETRY_INTERVAL_MS)
    await expectation
    expect(setVolume.mock.calls.length).toBeGreaterThan(1)
  })

  it('setSourceWhenReady retries after invalid-state then succeeds', async () => {
    jest.useFakeTimers()
    const logger = { info: jest.fn(), debug: jest.fn() }
    const client = new ConcertClient({
      host: '192.168.1.50',
      logger,
      createConnection: jest.fn() as unknown as typeof net.createConnection,
    })
    const setSource = jest.spyOn(client, 'setSource')
      .mockRejectedValueOnce(new ProtocolError('source set rejected: invalid command in current state', {
        answerCode: ANSWER_INVALID_STATE,
      }))
      .mockResolvedValueOnce(undefined)

    const onWaiting = jest.fn()
    const pending = client.setSourceWhenReady('CD', 1, { onWaiting })
    await Promise.resolve()
    await jest.advanceTimersByTimeAsync(SOURCE_READY_RETRY_INTERVAL_MS)
    await expect(pending).resolves.toBeUndefined()
    expect(setSource).toHaveBeenCalledTimes(2)
    expect(onWaiting).not.toHaveBeenCalled()
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('receiver ready'))
  })

  it('setSourceWhenReady notifies onWaiting only after the not-ready log delay', async () => {
    jest.useFakeTimers()
    const client = new ConcertClient({
      host: '192.168.1.50',
      createConnection: jest.fn() as unknown as typeof net.createConnection,
    })
    const notReady = new ProtocolError(
      'source set rejected: invalid command in current state',
      { answerCode: ANSWER_INVALID_STATE },
    )
    const setSource = jest.spyOn(client, 'setSource').mockRejectedValue(notReady)

    const onWaiting = jest.fn()
    const pending = client.setSourceWhenReady('CD', 1, { onWaiting })
    await Promise.resolve()
    await jest.advanceTimersByTimeAsync(SOURCE_READY_NOT_READY_LOG_AFTER_MS - 1)
    expect(onWaiting).not.toHaveBeenCalled()

    await jest.advanceTimersByTimeAsync(SOURCE_READY_RETRY_INTERVAL_MS)
    expect(onWaiting).toHaveBeenCalledTimes(1)

    setSource.mockResolvedValueOnce(undefined)
    await jest.advanceTimersByTimeAsync(SOURCE_READY_RETRY_INTERVAL_MS)
    await expect(pending).resolves.toBeUndefined()
  })

  it('setSourceWhenReady does not retry permanent protocol errors', async () => {
    const client = new ConcertClient({
      host: '192.168.1.50',
      createConnection: jest.fn() as unknown as typeof net.createConnection,
    })
    const setSource = jest.spyOn(client, 'setSource').mockRejectedValue(
      new ProtocolError('source set rejected: incorrect parameter', { answerCode: 0x84 }),
    )

    await expect(client.setSourceWhenReady('CD', 1)).rejects.toBeInstanceOf(ProtocolError)
    expect(setSource).toHaveBeenCalledTimes(1)
  })

  it('setSourceWhenReady gives up after the ready timeout', async () => {
    jest.useFakeTimers()
    const client = new ConcertClient({
      host: '192.168.1.50',
      createConnection: jest.fn() as unknown as typeof net.createConnection,
    })
    const setSource = jest.spyOn(client, 'setSource').mockRejectedValue(
      new ProtocolError('source set rejected: invalid command in current state', {
        answerCode: ANSWER_INVALID_STATE,
      }),
    )

    const pending = client.setSourceWhenReady('CD', 1)
    const expectation = expect(pending).rejects.toBeInstanceOf(ProtocolError)
    await jest.advanceTimersByTimeAsync(SOURCE_READY_TIMEOUT_MS + SOURCE_READY_RETRY_INTERVAL_MS)
    await expectation
    expect(setSource.mock.calls.length).toBeGreaterThan(1)
  })

  it('succeeds when source-set times out but a later query confirms the input', async () => {
    jest.useFakeTimers()
    let call = 0
    const createConnection = jest.fn(() => {
      const socket = new FakeSocket()
      const index = call++
      queueMicrotask(() => {
        socket.emit('connect')
        if (index >= 1) {
          queueMicrotask(() => {
            socket.emit('data', Buffer.from([0x21, 0x01, COMMAND_SOURCE, ANSWER_OK, 0x01, 0x01, 0x0d]))
          })
        }
      })
      return socket as unknown as net.Socket
    })

    const client = new ConcertClient({
      host: '192.168.1.50',
      requestTimeoutMs: 100,
      createConnection: createConnection as unknown as typeof net.createConnection,
    })

    const pending = client.setSource('CD', 1)
    await Promise.resolve()
    await jest.advanceTimersByTimeAsync(100)
    await jest.advanceTimersByTimeAsync(1_500)
    await expect(pending).resolves.toBeUndefined()
    expect(createConnection).toHaveBeenCalledTimes(2)
  })

  it('single-flights concurrent getSource calls for the same zone', async () => {
    const socket = new FakeSocket()
    const createConnection = jest.fn(() => {
      queueMicrotask(() => socket.emit('connect'))
      return socket as unknown as net.Socket
    })

    const client = new ConcertClient({
      host: '192.168.1.50',
      createConnection: createConnection as unknown as typeof net.createConnection,
    })

    const first = client.getSource(1)
    const second = client.getSource(1)
    await new Promise((resolve) => setImmediate(resolve))
    expect(createConnection).toHaveBeenCalledTimes(1)
    socket.emit('data', Buffer.from([0x21, 0x01, COMMAND_SOURCE, ANSWER_OK, 0x01, 0x01, 0x0d]))
    await expect(Promise.all([first, second])).resolves.toEqual(['cd', 'cd'])
  })

  it('rejects unknown sources on setSource', async () => {
    const client = new ConcertClient({
      host: '192.168.1.50',
      createConnection: jest.fn() as unknown as typeof net.createConnection,
    })
    await expect(client.setSource('tape')).rejects.toThrow(/Unknown source/)
  })

  it('serializes concurrent power and volume queries onto one socket at a time', async () => {
    const sockets: FakeSocket[] = []
    const createConnection = jest.fn(() => {
      const socket = new FakeSocket()
      sockets.push(socket)
      queueMicrotask(() => socket.emit('connect'))
      return socket as unknown as net.Socket
    })

    const client = new ConcertClient({
      host: '192.168.1.50',
      createConnection: createConnection as unknown as typeof net.createConnection,
    })

    const power = client.getPowerState()
    const volume = client.getVolume(1)
    await new Promise((resolve) => setImmediate(resolve))
    expect(createConnection).toHaveBeenCalledTimes(1)

    sockets[0].emit('data', Buffer.from([0x21, 0x01, 0x00, ANSWER_OK, 0x01, POWER_ON, 0x0d]))
    await expect(power).resolves.toBe(true)

    await new Promise((resolve) => setImmediate(resolve))
    expect(createConnection).toHaveBeenCalledTimes(2)
    sockets[1].emit('data', Buffer.from([0x21, 0x01, COMMAND_VOLUME, ANSWER_OK, 0x01, 57, 0x0d]))
    await expect(volume).resolves.toBe(57)
  })

  it('remembers last power state after successful query and set', async () => {
    const replies = [
      Buffer.from([0x21, 0x01, 0x00, ANSWER_OK, 0x01, POWER_ON, 0x0d]),
      Buffer.from([0x21, 0x01, COMMAND_RC5, ANSWER_OK, 0x02, RC5_SYSTEM_ZONE1, RC5_POWER_OFF, 0x0d]),
    ]
    let call = 0
    const createConnection = jest.fn(() => {
      const socket = new FakeSocket()
      queueMicrotask(() => {
        socket.emit('connect')
        queueMicrotask(() => {
          socket.emit('data', replies[call++])
        })
      })
      return socket as unknown as net.Socket
    })

    const client = new ConcertClient({
      host: '192.168.1.50',
      createConnection: createConnection as unknown as typeof net.createConnection,
    })

    expect(client.getLastPowerState(1)).toBeUndefined()
    await expect(client.getPowerState(1)).resolves.toBe(true)
    expect(client.getLastPowerState(1)).toBe(true)
    await expect(client.setPower(false, 1)).resolves.toBeUndefined()
    expect(client.getLastPowerState(1)).toBe(false)
  })
})
