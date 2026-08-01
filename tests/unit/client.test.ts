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
import { ANSWER_OK, POWER_ON, POWER_STANDBY, buildPowerOn } from '../../src/api/protocol'
import { MAX_RESPONSE_BUFFER_BYTES } from '../../src/settings'

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

  it('sends power-on and standby commands', async () => {
    const replies = [
      Buffer.from([0x21, 0x01, 0x00, ANSWER_OK, 0x01, POWER_ON, 0x0d]),
      Buffer.from([0x21, 0x01, 0x00, ANSWER_OK, 0x01, POWER_STANDBY, 0x0d]),
    ]
    let call = 0

    const createConnection = jest.fn(() => {
      const socket = new FakeSocket()
      queueMicrotask(() => {
        socket.emit('connect')
        queueMicrotask(() => socket.emit('data', replies[call++]))
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

  it('times out if connect never completes', async () => {
    jest.useFakeTimers()
    const socket = new FakeSocket()
    const createConnection = jest.fn(() => socket as unknown as net.Socket)

    const client = new ConcertClient({
      host: '192.168.1.50',
      connectTimeoutMs: 100,
      createConnection: createConnection as unknown as typeof net.createConnection,
    })

    const pending = client.getPowerState()
    jest.advanceTimersByTime(100)
    await expect(pending).rejects.toThrow(/Timed out connecting/)
  })

  it('times out if a response never arrives after connect', async () => {
    jest.useFakeTimers()
    const socket = new FakeSocket()
    const createConnection = jest.fn(() => {
      queueMicrotask(() => socket.emit('connect'))
      return socket as unknown as net.Socket
    })

    const client = new ConcertClient({
      host: '192.168.1.50',
      requestTimeoutMs: 100,
      createConnection: createConnection as unknown as typeof net.createConnection,
    })

    const pending = client.getPowerState()
    await Promise.resolve()
    jest.advanceTimersByTime(100)
    await expect(pending).rejects.toThrow(/Timed out waiting for response/)
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

  it('writes the expected power-on frame', () => {
    expect([...buildPowerOn(1)]).toEqual([0x21, 0x01, 0x00, 0x01, 0x01, 0x0d])
  })
})
