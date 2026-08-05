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
  FRAME_START,
  POWER_ON,
  RC5_POWER_OFF,
  RC5_POWER_ON,
  RC5_SYSTEM_ZONE1,
  buildPowerOn,
  resolveSourceDefinition,
} from '../../src/api/protocol'
import {
  DEFAULT_CONTROL_PORT,
  MAX_RESPONSE_BUFFER_BYTES,
  POWER_STATE_TTL_MS,
  QUERY_BREAKER_FAILURE_THRESHOLD,
  SET_SETTLE_MS,
  SET_VERIFY_ATTEMPTS,
  STATE_QUERY_RETRIES,
  STATE_QUERY_RETRY_MS,
  WAKE_RETRY_INTERVAL_MS,
  WAKE_RETRY_TIMEOUT_MS,
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
}

/**
 * Let fake time pass in small steps so the microtask chains between a timeout,
 * its retry, and the next socket all get a chance to run. Advancing the whole
 * span in one call can fire a later timer before an earlier chain has settled.
 */
async function advanceInSteps(totalMs: number, stepMs = 50): Promise<void> {
  for (let elapsed = 0; elapsed < totalMs; elapsed += stepMs) {
    await jest.advanceTimersByTimeAsync(stepMs)
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

  it('absorbs a late socket error after the request has settled', async () => {
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
    socket.emit('data', Buffer.from([0x21, 0x01, 0x00, ANSWER_OK, 0x01, POWER_ON, 0x0d]))
    await expect(pending).resolves.toBe(true)

    // Node rethrows an 'error' event that nothing is listening for, which would
    // take down the Homebridge process.
    expect(() => socket.emit('error', new Error('late ECONNRESET'))).not.toThrow()
  })

  it('wraps a synchronous createConnection failure in ConnectionError', async () => {
    const createConnection = jest.fn(() => {
      throw new TypeError('invalid connect options')
    })

    const client = new ConcertClient({
      host: '192.168.1.50',
      createConnection: createConnection as unknown as typeof net.createConnection,
    })

    await expect(client.getPowerState()).rejects.toBeInstanceOf(ConnectionError)
    expect(createConnection).toHaveBeenCalledTimes(1 + STATE_QUERY_RETRIES)
  })

  it('unwraps a bracketed IPv6 host before connecting', async () => {
    const socket = new FakeSocket()
    const createConnection = jest.fn(() => {
      queueMicrotask(() => socket.emit('connect'))
      return socket as unknown as net.Socket
    })

    const client = new ConcertClient({
      host: '[fe80::1]',
      createConnection: createConnection as unknown as typeof net.createConnection,
    })

    const pending = client.getPowerState()
    await new Promise((resolve) => setImmediate(resolve))
    socket.emit('data', Buffer.from([0x21, 0x01, 0x00, ANSWER_OK, 0x01, POWER_ON, 0x0d]))

    await expect(pending).resolves.toBe(true)
    // net resolves `host` through dns.lookup, which never strips brackets.
    expect(createConnection).toHaveBeenCalledWith({ host: 'fe80::1', port: DEFAULT_CONTROL_PORT })
  })

  it('stops dialing an unreachable receiver after repeated query failures', async () => {
    const createConnection = jest.fn(() => {
      const socket = new FakeSocket()
      queueMicrotask(() => socket.emit('error', new Error('ECONNREFUSED')))
      return socket as unknown as net.Socket
    })

    const client = new ConcertClient({
      host: '192.168.1.50',
      createConnection: createConnection as unknown as typeof net.createConnection,
    })

    for (let attempt = 0; attempt < QUERY_BREAKER_FAILURE_THRESHOLD; attempt++) {
      await expect(client.getPowerState()).rejects.toBeInstanceOf(ConnectionError)
    }
    const dialsBeforeBreaker = createConnection.mock.calls.length

    // The breaker is now open: further polls fail fast without touching the network.
    await expect(client.getPowerState()).rejects.toThrow(/pausing polls/)
    expect(createConnection).toHaveBeenCalledTimes(dialsBeforeBreaker)
  })

  it('still allows sets while the breaker is open, and resumes polling after one works', async () => {
    let unreachable = true
    const createConnection = jest.fn(() => {
      const socket = new FakeSocket()
      if (unreachable) {
        queueMicrotask(() => socket.emit('error', new Error('ECONNREFUSED')))
        return socket as unknown as net.Socket
      }
      queueMicrotask(() => {
        socket.emit('connect')
        // A Power status frame satisfies both an RC5 set and a power query.
        queueMicrotask(() => {
          socket.emit('data', Buffer.from([0x21, 0x01, 0x00, ANSWER_OK, 0x01, POWER_ON, 0x0d]))
        })
      })
      return socket as unknown as net.Socket
    })

    const client = new ConcertClient({
      host: '192.168.1.50',
      createConnection: createConnection as unknown as typeof net.createConnection,
    })

    for (let attempt = 0; attempt < QUERY_BREAKER_FAILURE_THRESHOLD; attempt++) {
      await expect(client.getPowerState()).rejects.toBeInstanceOf(ConnectionError)
    }
    await expect(client.getPowerState()).rejects.toThrow(/pausing polls/)

    // A HomeKit action is deliberate and must never be refused by the breaker.
    unreachable = false
    await expect(client.setPower(true)).resolves.toBeUndefined()

    // Proof of reachability reopens the poll path.
    await expect(client.getPowerState()).resolves.toBe(true)
  })

  it('fails in-flight and subsequent requests once closed', async () => {
    const socket = new FakeSocket()
    const createConnection = jest.fn(() => {
      queueMicrotask(() => socket.emit('connect'))
      return socket as unknown as net.Socket
    })

    const client = new ConcertClient({
      host: '192.168.1.50',
      createConnection: createConnection as unknown as typeof net.createConnection,
    })

    const pending = expect(client.getPowerState()).rejects.toThrow(/closed/)
    await new Promise((resolve) => setImmediate(resolve))

    // Shutdown must not leave HomeKit waiting out the full request timeout.
    client.close()
    await pending
    expect(socket.destroyed).toBe(true)

    await expect(client.getPowerState()).rejects.toThrow(/closed/)
  })

  it('bounds a set and its verification by the caller timeout', async () => {
    jest.useFakeTimers()
    // Never answers: every attempt can only end in a timeout.
    const createConnection = jest.fn(() => {
      const socket = new FakeSocket()
      queueMicrotask(() => socket.emit('connect'))
      return socket as unknown as net.Socket
    })

    const client = new ConcertClient({
      host: '192.168.1.50',
      requestTimeoutMs: 5_000,
      createConnection: createConnection as unknown as typeof net.createConnection,
    })

    const started = Date.now()
    let settledAt = 0
    const pending = client.setVolume(57, 1, { timeoutMs: 1_000 })
      .catch((error: unknown) => {
        settledAt = Date.now()
        return error
      })
    await advanceInSteps(4_000, 100)

    expect(await pending).toBeInstanceOf(ConnectionError)
    // Unbounded, the 5s request plus two verification rounds would take ~29s.
    expect(settledAt - started).toBeLessThan(2_000)
  })

  it('does not accept a power-on confirmed by a standby status frame', async () => {
    jest.useFakeTimers()
    const createConnection = jest.fn(() => {
      const socket = new FakeSocket()
      queueMicrotask(() => {
        socket.emit('connect')
        queueMicrotask(() => {
          // Answer code OK, but the payload says the zone is still in standby.
          socket.emit('data', Buffer.from([0x21, 0x01, 0x00, ANSWER_OK, 0x01, 0x00, 0x0d]))
        })
      })
      return socket as unknown as net.Socket
    })

    const client = new ConcertClient({
      host: '192.168.1.50',
      requestTimeoutMs: 100,
      createConnection: createConnection as unknown as typeof net.createConnection,
    })

    // Treating that as success would cache the inverse of reality, which then
    // drives the presets' standby handling.
    const pending = expect(client.setPower(true, 1, { timeoutMs: 400 }))
      .rejects.toBeInstanceOf(ConnectionError)
    await advanceInSteps(1_200, 50)
    await pending
    expect(client.getLastPowerState(1)).not.toBe(true)
  })

  it('accepts a power-on confirmed by an agreeing status frame', async () => {
    const createConnection = jest.fn(() => {
      const socket = new FakeSocket()
      queueMicrotask(() => {
        socket.emit('connect')
        queueMicrotask(() => {
          socket.emit('data', Buffer.from([0x21, 0x01, 0x00, ANSWER_OK, 0x01, POWER_ON, 0x0d]))
        })
      })
      return socket as unknown as net.Socket
    })

    const client = new ConcertClient({
      host: '192.168.1.50',
      createConnection: createConnection as unknown as typeof net.createConnection,
    })

    await expect(client.setPower(true, 1)).resolves.toBeUndefined()
    expect(client.getLastPowerState(1)).toBe(true)
  })

  it('expires a cached power state so an absent receiver cannot look confirmed', async () => {
    const socket = new FakeSocket()
    const createConnection = jest.fn(() => {
      queueMicrotask(() => socket.emit('connect'))
      return socket as unknown as net.Socket
    })

    const client = new ConcertClient({
      host: '192.168.1.50',
      createConnection: createConnection as unknown as typeof net.createConnection,
    })

    const pending = client.getPowerState(1)
    await new Promise((resolve) => setImmediate(resolve))
    socket.emit('data', Buffer.from([0x21, 0x01, 0x00, ANSWER_OK, 0x01, 0x00, 0x0d]))
    await expect(pending).resolves.toBe(false)
    expect(client.getLastPowerState(1)).toBe(false)

    // Without expiry, a preset that skips its own query while the zone is in
    // standby would keep re-confirming Off forever once the unit went away.
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + POWER_STATE_TTL_MS + 1)
    expect(client.getLastPowerState(1)).toBeUndefined()
  })

  it('rejects an out-of-range zone rather than silently using zone 1', async () => {
    const client = new ConcertClient({
      host: '192.168.1.50',
      createConnection: jest.fn() as unknown as typeof net.createConnection,
    })

    await expect(client.getPowerState(3)).rejects.toBeInstanceOf(RangeError)
  })

  it('does not spend the wake window re-dialing a host that is not there', async () => {
    const client = new ConcertClient({
      host: '192.168.1.50',
      createConnection: jest.fn() as unknown as typeof net.createConnection,
    })
    const refused = new ConnectionError('Connection to 192.168.1.50:50000 failed', {
      cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    })
    const setVolume = jest.spyOn(client, 'setVolume').mockRejectedValue(refused)

    // A refused connection is not a waking receiver; looping for 60s is pointless.
    await expect(client.setVolumeWhenReady(57, 1)).rejects.toBeInstanceOf(ConnectionError)
    expect(setVolume).toHaveBeenCalledTimes(1)
  })

  it('truncates a large partial response in the timeout message', async () => {
    jest.useFakeTimers()
    const createConnection = jest.fn(() => {
      const socket = new FakeSocket()
      queueMicrotask(() => {
        socket.emit('connect')
        // Start bytes with no valid frame behind them: retained as a possible
        // partial frame, unparseable, and previously pasted in whole.
        queueMicrotask(() => socket.emit('data', Buffer.alloc(2_000, FRAME_START)))
      })
      return socket as unknown as net.Socket
    })

    const client = new ConcertClient({
      host: '192.168.1.50',
      requestTimeoutMs: 100,
      createConnection: createConnection as unknown as typeof net.createConnection,
    })

    const pending = client.getPowerState(1).catch((error: unknown) => error)
    await advanceInSteps(1_500, 50)

    const error = await pending
    const message = error instanceof Error ? error.message : String(error)
    // This text is logged at warn level; a 4 KB buffer must not become a 12 KB line.
    expect(message).toContain('more bytes')
    expect(message.length).toBeLessThan(300)
  })

  it('rejects when the socket closes before a response arrives', async () => {
    const socket = new FakeSocket()
    const createConnection = jest.fn(() => {
      queueMicrotask(() => {
        socket.emit('connect')
        queueMicrotask(() => socket.emit('close'))
      })
      return socket as unknown as net.Socket
    })

    const client = new ConcertClient({
      host: '192.168.1.50',
      createConnection: createConnection as unknown as typeof net.createConnection,
    })

    await expect(client.getPowerState()).rejects.toThrow(/closed before a response arrived/)
  })

  it('rejects when the socket write fails', async () => {
    class FailingWriteSocket extends FakeSocket {
      override write(_data: Buffer, callback?: (error?: Error | null) => void): boolean {
        callback?.(new Error('EPIPE'))
        return false
      }
    }

    const createConnection = jest.fn(() => {
      const socket = new FailingWriteSocket()
      queueMicrotask(() => socket.emit('connect'))
      return socket as unknown as net.Socket
    })

    const client = new ConcertClient({
      host: '192.168.1.50',
      createConnection: createConnection as unknown as typeof net.createConnection,
    })

    await expect(client.getPowerState()).rejects.toThrow(/Failed to write to .*EPIPE/)
  })

  it('rejects a zone 1 source that reports Follow Zone 1', async () => {
    const createConnection = jest.fn(() => {
      const socket = new FakeSocket()
      queueMicrotask(() => {
        socket.emit('connect')
        queueMicrotask(() => {
          // 0x00 means "follow zone 1", which zone 1 itself cannot be.
          socket.emit('data', Buffer.from([0x21, 0x01, COMMAND_SOURCE, ANSWER_OK, 0x01, 0x00, 0x0d]))
        })
      })
      return socket as unknown as net.Socket
    })

    const client = new ConcertClient({
      host: '192.168.1.50',
      createConnection: createConnection as unknown as typeof net.createConnection,
    })

    await expect(client.getSource(1)).rejects.toThrow(/unexpected for zone 1/)
  })

  it('rejects when zone 2 follows a zone 1 that also reports Follow Zone 1', async () => {
    const createConnection = jest.fn(() => {
      const socket = new FakeSocket()
      queueMicrotask(() => {
        socket.emit('connect')
        queueMicrotask(() => {
          const zone = socket.written[0]?.[1] ?? 0x02
          socket.emit('data', Buffer.from([0x21, zone, COMMAND_SOURCE, ANSWER_OK, 0x01, 0x00, 0x0d]))
        })
      })
      return socket as unknown as net.Socket
    })

    const client = new ConcertClient({
      host: '192.168.1.50',
      createConnection: createConnection as unknown as typeof net.createConnection,
    })

    await expect(client.getSource(2)).rejects.toThrow(/Zone 1 source is Follow Zone 1/)
  })

  it('accepts a SourceDefinition object as well as an id', async () => {
    const createConnection = jest.fn(() => {
      const socket = new FakeSocket()
      queueMicrotask(() => {
        socket.emit('connect')
        queueMicrotask(() => {
          socket.emit('data', Buffer.from([
            0x21, 0x01, COMMAND_RC5, ANSWER_OK, 0x02, RC5_SYSTEM_ZONE1, 0x76, 0x0d,
          ]))
        })
      })
      return socket as unknown as net.Socket
    })

    const client = new ConcertClient({
      host: '192.168.1.50',
      createConnection: createConnection as unknown as typeof net.createConnection,
    })

    const cd = resolveSourceDefinition('cd')!
    await expect(client.setSource(cd, 1)).resolves.toBeUndefined()
  })

  it('rejects an unknown source name', async () => {
    const client = new ConcertClient({
      host: '192.168.1.50',
      createConnection: jest.fn() as unknown as typeof net.createConnection,
    })

    await expect(client.setSource('NOPE', 1)).rejects.toBeInstanceOf(RangeError)
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
    await jest.advanceTimersByTimeAsync(STATE_QUERY_RETRY_MS)
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
      // The message must name the receiver and zone: it is the failure an
      // operator sees most, and a bare "timed out" is not actionable.
      'Timed out waiting for a response from 192.168.1.50:50000 zone 1',
    )
    await Promise.resolve()
    await jest.advanceTimersByTimeAsync(100) // first attempt timeout
    await jest.advanceTimersByTimeAsync(STATE_QUERY_RETRY_MS) // retry delay
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
    await jest.advanceTimersByTimeAsync(STATE_QUERY_RETRY_MS)
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

    // Attach the rejection handler before advancing so Jest does not observe a
    // momentarily unhandled rejection.
    const pending = expect(client.setPower(false)).rejects.toBeInstanceOf(ConnectionError)
    await advanceInSteps(100 + SET_SETTLE_MS * SET_VERIFY_ATTEMPTS)
    await pending
    // One set attempt, then one query per verification attempt.
    expect(createConnection).toHaveBeenCalledTimes(1 + SET_VERIFY_ATTEMPTS)
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

    const pending = client.setVolumeWhenReady(57, 1)
    await Promise.resolve()
    await jest.advanceTimersByTimeAsync(WAKE_RETRY_INTERVAL_MS)
    await expect(pending).resolves.toBeUndefined()
    expect(setVolume).toHaveBeenCalledTimes(2)
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('receiver ready'))
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
    await jest.advanceTimersByTimeAsync(WAKE_RETRY_TIMEOUT_MS + WAKE_RETRY_INTERVAL_MS)
    await expectation
    // The loop must actually fill the window rather than giving up after a
    // couple of tries; allow slack for the attempt that straddles the deadline.
    const expectedAttempts = WAKE_RETRY_TIMEOUT_MS / WAKE_RETRY_INTERVAL_MS
    expect(setVolume.mock.calls.length).toBeGreaterThanOrEqual(expectedAttempts - 1)
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

    const pending = client.setSourceWhenReady('CD', 1)
    await Promise.resolve()
    await jest.advanceTimersByTimeAsync(WAKE_RETRY_INTERVAL_MS)
    await expect(pending).resolves.toBeUndefined()
    expect(setSource).toHaveBeenCalledTimes(2)
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('receiver ready'))
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
    await jest.advanceTimersByTimeAsync(WAKE_RETRY_TIMEOUT_MS + WAKE_RETRY_INTERVAL_MS)
    await expectation
    const expectedAttempts = WAKE_RETRY_TIMEOUT_MS / WAKE_RETRY_INTERVAL_MS
    expect(setSource.mock.calls.length).toBeGreaterThanOrEqual(expectedAttempts - 1)
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
