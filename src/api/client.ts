/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview TCP client for AudioControl Concert X/XR series IP automation control.
 *
 * Opens a short-lived connection per request. That keeps the MVP simple and
 * avoids sticky half-open sockets if the receiver drops idle clients in standby.
 */

import net from 'node:net'

import { ConnectionError, ProtocolError } from '../errors'
import {
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_CONTROL_PORT,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_ZONE,
  MAX_RESPONSE_BUFFER_BYTES,
} from '../settings'
import type { PluginLogger } from '../types'
import {
  ANSWER_OK,
  COMMAND_POWER,
  COMMAND_RC5,
  buildPowerOn,
  buildPowerQuery,
  buildPowerStandby,
  describeAnswerCode,
  formatFrame,
  isPowerOn,
  tryParseResponse,
  type ProtocolResponse,
} from './protocol'

/** Responses accepted after a power set: RC5 ack, or a following Power status. */
const POWER_SET_RESPONSE_COMMANDS: readonly number[] = [COMMAND_RC5, COMMAND_POWER]

export interface ConcertClientOptions {
  host: string
  port?: number
  zone?: number
  connectTimeoutMs?: number
  requestTimeoutMs?: number
  logger?: PluginLogger
  /** Injected for tests; defaults to `net.createConnection`. */
  createConnection?: typeof net.createConnection
}

/**
 * Sends framed automation commands to an AudioControl Concert receiver over TCP.
 */
export class ConcertClient {
  private readonly host: string
  private readonly port: number
  private readonly zone: number
  private readonly connectTimeoutMs: number
  private readonly requestTimeoutMs: number
  private readonly log: PluginLogger
  private readonly createConnection: typeof net.createConnection

  constructor(options: ConcertClientOptions) {
    this.host = options.host
    this.port = options.port ?? DEFAULT_CONTROL_PORT
    this.zone = options.zone ?? DEFAULT_ZONE
    this.connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    this.log = options.logger ?? {}
    this.createConnection = options.createConnection ?? net.createConnection
  }

  /** Query whether the configured zone is powered on. */
  async getPowerState(): Promise<boolean> {
    const response = await this.send(buildPowerQuery(this.zone), COMMAND_POWER)
    this.assertOk(response, 'power query')
    return isPowerOn(response.data)
  }

  /** Power the configured zone on (discrete RC5 Power On). */
  async powerOn(): Promise<void> {
    const response = await this.send(buildPowerOn(this.zone), POWER_SET_RESPONSE_COMMANDS)
    this.assertOk(response, 'power on')
  }

  /** Put the configured zone into standby (discrete RC5 Power Off). */
  async powerStandby(): Promise<void> {
    const response = await this.send(buildPowerStandby(this.zone), POWER_SET_RESPONSE_COMMANDS)
    this.assertOk(response, 'standby')
  }

  /** Set power from a boolean HomeKit On value. */
  async setPower(on: boolean): Promise<void> {
    if (on) {
      await this.powerOn()
    } else {
      await this.powerStandby()
    }
  }

  private assertOk(response: ProtocolResponse, operation: string): void {
    if (response.answerCode !== ANSWER_OK) {
      throw new ProtocolError(
        `${operation} rejected: ${describeAnswerCode(response.answerCode)}`,
      )
    }
  }

  /**
   * Open a TCP connection, write one request frame, and resolve with the first
   * matching response frame. Always closes the socket afterward.
   *
   * @param expectedCommands - Accept the first response whose command is in this list
   *   (RC5 set may reply with 0x08, and often also emits a Power 0x00 status)
   */
  private send(request: Buffer, expectedCommands: number | readonly number[]): Promise<ProtocolResponse> {
    const { host, port, zone } = this
    const accepted = Array.isArray(expectedCommands) ? expectedCommands : [expectedCommands]
    this.log.debug?.(`→ ${host}:${port} ${formatFrame(request)}`)

    return new Promise((resolve, reject) => {
      let settled = false
      let buffer = Buffer.alloc(0)
      let connectTimer: ReturnType<typeof setTimeout> | undefined
      let requestTimer: ReturnType<typeof setTimeout> | undefined

      const socket = this.createConnection({ host, port })

      const finish = (error?: Error, response?: ProtocolResponse): void => {
        if (settled) {
          return
        }
        settled = true
        if (connectTimer) {
          clearTimeout(connectTimer)
        }
        if (requestTimer) {
          clearTimeout(requestTimer)
        }
        socket.removeAllListeners()
        socket.destroy()
        if (error) {
          reject(error)
          return
        }
        if (!response) {
          reject(new ProtocolError('No response from receiver'))
          return
        }
        this.log.debug?.(
          `← ${host}:${port} cmd=0x${response.command.toString(16)} `
          + `answer=${describeAnswerCode(response.answerCode)} data=${formatFrame(response.data)}`,
        )
        resolve(response)
      }

      connectTimer = setTimeout(() => {
        finish(new ConnectionError(`Timed out connecting to ${host}:${port}`))
      }, this.connectTimeoutMs)

      socket.once('connect', () => {
        if (connectTimer) {
          clearTimeout(connectTimer)
          connectTimer = undefined
        }
        requestTimer = setTimeout(() => {
          const hint = buffer.length > 0 ? ` (received ${formatFrame(buffer)})` : ''
          finish(new ConnectionError(`Timed out waiting for response from ${host}:${port}${hint}`))
        }, this.requestTimeoutMs)

        socket.write(request, (writeError) => {
          if (writeError) {
            finish(new ConnectionError(`Failed to write to ${host}:${port}: ${writeError.message}`, {
              cause: writeError,
            }))
          }
        })
      })

      socket.on('data', (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk])
        if (buffer.length > MAX_RESPONSE_BUFFER_BYTES) {
          finish(new ProtocolError(
            `Response from ${host}:${port} exceeded ${MAX_RESPONSE_BUFFER_BYTES} bytes`,
          ))
          return
        }

        // Drain frames until we find one that matches the request, or wait for more data.
        let remaining = buffer
        while (remaining.length > 0) {
          const parsed = tryParseResponse(remaining)
          if (!parsed) {
            buffer = remaining
            return
          }
          remaining = remaining.subarray(parsed.consumed)
          buffer = remaining

          const { response } = parsed
          if (response.zone !== zone || !accepted.includes(response.command)) {
            const expected = accepted.map((cmd) => `0x${cmd.toString(16)}`).join('|')
            this.log.debug?.(
              `Ignoring unmatched frame zone=${response.zone} cmd=0x${response.command.toString(16)} `
              + `(expected zone=${zone} cmd=${expected})`,
            )
            continue
          }
          finish(undefined, response)
          return
        }
      })

      socket.once('error', (error: Error) => {
        finish(new ConnectionError(`Connection to ${host}:${port} failed: ${error.message}`, {
          cause: error,
        }))
      })

      socket.once('close', () => {
        if (!settled) {
          finish(new ConnectionError(`Connection to ${host}:${port} closed before a response arrived`))
        }
      })
    })
  }
}
