/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview TCP client for AudioControl Concert X/XR series IP automation control.
 *
 * Keeps one TCP connection and sends every command on it. A fresh socket per
 * command, closed with a reset, leaks slots in the XR control stack. Standby
 * does not reset that stack; only a full power-off does. The socket is dropped
 * if the peer closes it or a request times out, and the next command dials.
 * Commands are serialized so two requests are never in flight together.
 */

import net from 'node:net'

import { ConnectionError, ProtocolError } from '../errors'
import {
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_CONTROL_PORT,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_ZONE,
  MAX_RESPONSE_BUFFER_BYTES,
  POWER_STATE_TTL_MS,
  QUERY_BREAKER_BASE_COOLDOWN_MS,
  QUERY_BREAKER_FAILURE_THRESHOLD,
  QUERY_BREAKER_MAX_COOLDOWN_MS,
  SET_SETTLE_MS,
  SET_VERIFY_ATTEMPTS,
  STATE_QUERY_RETRIES,
  STATE_QUERY_RETRY_MS,
  WAKE_RETRY_INTERVAL_MS,
  WAKE_RETRY_TIMEOUT_MS,
} from '../settings'
import type { PluginLogger } from '../types'
import { describeError } from '../utils/errors'
import {
  ANSWER_INVALID_STATE,
  ANSWER_OK,
  COMMAND_POWER,
  COMMAND_RC5,
  COMMAND_SOURCE,
  COMMAND_VOLUME,
  FRAME_START,
  buildPowerOn,
  buildPowerQuery,
  buildPowerStandby,
  buildSourceQuery,
  buildSourceSet,
  buildVolumeQuery,
  buildVolumeSet,
  describeAnswerCode,
  formatFrame,
  isPowerOn,
  isSourceFollowZone1,
  parseSource,
  parseVolume,
  resolveSourceDefinition,
  tryParseResponse,
  type ProtocolResponse,
  type SourceDefinition,
  type SourceId,
} from './protocol'

/** Responses accepted after a power set: RC5 ack, or a following Power status. */
const POWER_SET_RESPONSE_COMMANDS: readonly number[] = [COMMAND_RC5, COMMAND_POWER]

/** Responses accepted after a source set: RC5 ack, or a following Source status. */
const SOURCE_SET_RESPONSE_COMMANDS: readonly number[] = [COMMAND_RC5, COMMAND_SOURCE]

/** What one exchange with the receiver meant for the offline page. */
export type ExchangeResult = 'reply' | 'unreachable'

export interface ConcertClientOptions {
  host: string
  port?: number
  connectTimeoutMs?: number
  requestTimeoutMs?: number
  logger?: PluginLogger
  /** Injected for tests; defaults to `net.createConnection`. */
  createConnection?: typeof net.createConnection
  /**
   * A frame arrived, or a dial failed. A query the breaker refused before
   * dialing is not reported. Optional so the client stays usable without signals.
   */
  onExchange?: (result: ExchangeResult) => void
}

/** Options shared by the set methods. */
export interface SetOptions {
  /**
   * Overall budget for the set, including any post-ack verification.
   *
   * Without it a set is bounded only by the per-request connect/response
   * timeouts, so a set that falls back to verification can run for far longer
   * than the caller expects.
   */
  timeoutMs?: number
}

/**
 * Absolute epoch-ms budget for an operation, or `undefined` for "no overall
 * budget — only the per-request connect/response timeouts apply".
 *
 * Threaded through the set + verify path so a wake-retry loop cannot overrun
 * its advertised timeout by the duration of one final in-flight attempt.
 */
type Deadline = number | undefined

/** Convert a caller's relative budget into an absolute deadline. */
function deadlineFrom(options?: SetOptions): Deadline {
  return options?.timeoutMs === undefined ? undefined : Date.now() + options.timeoutMs
}

/** Per-request knobs for {@link ConcertClient.send}. */
interface SendOptions {
  /** Overall budget the request must finish inside. */
  deadline?: Deadline
  /**
   * Extra test a candidate frame must pass. A set may be acknowledged by a
   * following *status* frame, so its payload has to agree with what was asked;
   * a frame reporting the opposite state is discarded like any other unmatched
   * frame, routing the ambiguity into settle-and-verify rather than reporting a
   * false success.
   */
  confirms?: (response: ProtocolResponse) => boolean
}

/** Milliseconds left before `deadline`, or `undefined` when unbounded. */
function remainingMs(deadline: Deadline): number | undefined {
  return deadline === undefined ? undefined : deadline - Date.now()
}

/** True when a budget was supplied and has run out. */
function isExpired(deadline: Deadline): boolean {
  const remaining = remainingMs(deadline)
  return remaining !== undefined && remaining <= 0
}

/** Clamp a configured timeout to whatever budget is left. */
function boundedTimeout(configuredMs: number, deadline: Deadline): number {
  const remaining = remainingMs(deadline)
  return remaining === undefined ? configuredMs : Math.max(1, Math.min(configuredMs, remaining))
}

/**
 * How long a quiet control socket waits before TCP keepalive probes.
 *
 * Polls already write on this socket, so probes only matter when the receiver
 * reboots or drops the session without a FIN. Without them the next command
 * would sit until its response timeout.
 */
const CONTROL_SOCKET_KEEPALIVE_MS = 30_000

/** One in-flight exchange on the shared control socket. */
interface PendingExchange {
  zone: number
  accepted: readonly number[]
  confirms?: (response: ProtocolResponse) => boolean
  /** `host:port zone N`, the text operators see in timeout lines. */
  target: string
  /** False until the request bytes have been written. Earlier frames are stale. */
  armed: boolean
  settled: boolean
  session?: ControlSession
  connectTimer?: ReturnType<typeof setTimeout>
  requestTimer?: ReturnType<typeof setTimeout>
  abort: (error: Error) => void
  resolve: (response: ProtocolResponse) => void
  reject: (error: Error) => void
}

/** The receiver's control connection, reused until it fails. */
interface ControlSession {
  socket: net.Socket
  buffer: Buffer
  dropped: boolean
  pending?: PendingExchange
  onConnect?: () => void
  onData: (chunk: Buffer) => void
  onError: (error: Error) => void
  onClose: () => void
  onEnd: () => void
}

/**
 * Sends framed automation commands to an AudioControl Concert receiver over TCP.
 */
export class ConcertClient {
  /** Host exactly as configured — used for logs and error messages. */
  private readonly host: string
  /** Host handed to `net`, with any IPv6 brackets removed. */
  private readonly connectHost: string
  private readonly port: number
  private readonly connectTimeoutMs: number
  private readonly requestTimeoutMs: number
  private readonly log: PluginLogger
  private readonly createConnection: typeof net.createConnection
  private readonly onExchange?: (result: ExchangeResult) => void
  /** Coalesce concurrent volume queries for the same zone (poll fan-out). */
  private readonly volumeQueryInFlight = new Map<number, Promise<number>>()
  /** Coalesce concurrent source queries for the same zone (poll fan-out). */
  private readonly sourceQueryInFlight = new Map<number, Promise<SourceId>>()
  /** Last successfully observed power state per zone, with when it was seen. */
  private readonly lastPowerByZone = new Map<number, { on: boolean; seenAt: number }>()
  /** Cancels for in-flight requests, invoked by {@link close}. */
  private readonly inFlightAborts = new Set<(reason: Error) => void>()
  /** Open control connection. Absent after a timeout, error, or peer close. */
  private session?: ControlSession
  /** Aborts pending retry sleeps and in-flight requests on shutdown. */
  private readonly shutdown = new AbortController()
  private isClosed = false
  /** Consecutive query failures, used to open {@link queryBreakerOpenUntil}. */
  private consecutiveQueryFailures = 0
  /** Epoch ms until which queries fail fast instead of dialing an absent receiver. */
  private queryBreakerOpenUntil = 0
  /** How many times the breaker has opened without an intervening success. */
  private queryBreakerOpenCount = 0
  /**
   * Serialize TCP commands. Nested work inside an exclusive section must call
   * unlocked helpers (not public methods) to avoid deadlock.
   */
  private sendQueue: Promise<void> = Promise.resolve()

  constructor(options: ConcertClientOptions) {
    this.host = options.host
    this.connectHost = stripIpv6Brackets(options.host)
    this.port = options.port ?? DEFAULT_CONTROL_PORT
    this.connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    this.log = options.logger ?? {}
    this.createConnection = options.createConnection ?? net.createConnection
    this.onExchange = options.onExchange
  }

  /**
   * @throws {RangeError} when an explicit zone is out of range. Silently
   *   coercing it would let a caller bug quietly control the wrong zone, and
   *   every other layer treats a bad zone as fatal.
   */
  private resolveZone(zone?: number): number {
    if (zone === undefined) {
      return DEFAULT_ZONE
    }
    if (zone !== 1 && zone !== 2) {
      throw new RangeError(`Zone must be 1 or 2, got ${zone}`)
    }
    return zone
  }

  /**
   * Last known power state for the zone, if a query or set has succeeded.
   * `undefined` until the first successful observation.
   */
  getLastPowerState(zone?: number): boolean | undefined {
    const seen = this.lastPowerByZone.get(this.resolveZone(zone))
    if (!seen || Date.now() - seen.seenAt > POWER_STATE_TTL_MS) {
      // Deliberately expires. A caller that skips its own query because the zone
      // was "last seen in standby" would otherwise keep re-confirming that
      // forever once the receiver became unreachable, and never report a fault.
      return undefined
    }
    return seen.on
  }

  private rememberPowerState(zone: number, on: boolean): void {
    this.lastPowerByZone.set(zone, { on, seenAt: Date.now() })
  }

  /**
   * Release every resource the client owns: wake pending retry sleeps and fail
   * in-flight requests instead of letting them run out their timeouts.
   * Idempotent. After this, further requests fail fast.
   */
  close(): void {
    if (this.isClosed) {
      return
    }
    this.isClosed = true
    this.shutdown.abort()
    for (const abort of [...this.inFlightAborts]) {
      abort(new ConnectionError('Client closed before the request completed'))
    }
    this.inFlightAborts.clear()
    if (this.session) {
      this.retireSession(this.session)
    }
  }

  /**
   * Fail fast while the query breaker is open.
   *
   * An absent receiver otherwise costs every accessory a full connect+retry
   * cycle on every poll tick, which can consume most of the poll interval.
   * Only queries consult the breaker — a HomeKit set is a deliberate user
   * action and always gets to try.
   */
  private assertQueryAllowed(): void {
    const cooldownRemaining = this.queryBreakerOpenUntil - Date.now()
    if (cooldownRemaining <= 0) {
      return
    }
    throw new ConnectionError(
      `${this.host}:${this.port} unreachable for ${this.consecutiveQueryFailures} `
      + `consecutive queries; pausing polls for ${Math.ceil(cooldownRemaining / 1000)}s`,
      { paused: true },
    )
  }

  /**
   * Tell the offline page what this exchange was.
   *
   * No argument means a frame arrived. A paused query is not an exchange:
   * the breaker returned before dialing.
   */
  private observeExchange(error?: Error): void {
    if (this.onExchange === undefined) {
      return
    }
    if (error === undefined || error instanceof ProtocolError) {
      this.onExchange('reply')
      return
    }
    if (error instanceof ConnectionError && !error.paused) {
      this.onExchange('unreachable')
    }
  }

  /** A completed exchange proves the receiver is reachable; reset the breaker. */
  private noteReachable(): void {
    if (this.consecutiveQueryFailures > 0) {
      this.log.debug?.(
        `${this.host}:${this.port} reachable again after `
        + `${this.consecutiveQueryFailures} failed queries`,
      )
    }
    this.consecutiveQueryFailures = 0
    this.queryBreakerOpenUntil = 0
    this.queryBreakerOpenCount = 0
  }

  /**
   * Count a transport failure and open the breaker once the threshold is hit.
   *
   * The cool-off grows once per *opening*, not once per failed query. One poll
   * sweep issues a query per command type, so counting per query advanced the
   * backoff several steps at a time and pushed recovery minutes past the point
   * the receiver came back.
   */
  private noteUnreachable(): void {
    this.consecutiveQueryFailures += 1
    if (this.consecutiveQueryFailures < QUERY_BREAKER_FAILURE_THRESHOLD) {
      return
    }
    if (Date.now() < this.queryBreakerOpenUntil) {
      return
    }
    const cooldownMs = Math.min(
      QUERY_BREAKER_BASE_COOLDOWN_MS * 2 ** this.queryBreakerOpenCount,
      QUERY_BREAKER_MAX_COOLDOWN_MS,
    )
    this.queryBreakerOpenCount += 1
    this.queryBreakerOpenUntil = Date.now() + cooldownMs
    this.log.debug?.(
      `Pausing queries to ${this.host}:${this.port} for ${Math.round(cooldownMs / 1000)}s`,
    )
  }

  /**
   * Run a query, keeping the breaker state in sync. Only transport failures
   * count as unreachable — a ProtocolError means the receiver answered.
   */
  private async trackQuery<T>(run: () => Promise<T>): Promise<T> {
    this.assertQueryAllowed()
    try {
      const result = await run()
      this.noteReachable()
      return result
    } catch (error) {
      if (error instanceof ConnectionError) {
        this.noteUnreachable()
      }
      throw error
    }
  }

  /** Run `fn` with exclusive access to the TCP send path. */
  private withExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.sendQueue.then(fn, fn)
    this.sendQueue = run.then(() => undefined, () => undefined)
    return run
  }

  /**
   * Retry a ConnectionError once. XR units sometimes accept TCP then stay
   * silent for a single request. The silent socket is dropped first, so this
   * dials again instead of writing into a connection that already went quiet.
   */
  private async withQueryRetry<T>(
    operation: string,
    run: () => Promise<T>,
    deadline?: Deadline,
  ): Promise<T> {
    const attempts = 1 + STATE_QUERY_RETRIES
    let lastError: unknown
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await run()
      } catch (error) {
        lastError = error
        const isLastAttempt = attempt >= attempts
        if (!(error instanceof ConnectionError) || isLastAttempt || isExpired(deadline)) {
          throw error
        }
        this.log.debug?.(
          `${operation} failed (${error.message}); retrying `
          + `(${attempt}/${STATE_QUERY_RETRIES})`,
        )
        await this.sleep(boundedTimeout(STATE_QUERY_RETRY_MS, deadline))
      }
    }
    throw lastError
  }

  /** Retry sleep that wakes early on shutdown and never holds the event loop open. */
  private sleep(ms: number): Promise<void> {
    return sleep(ms, this.shutdown.signal)
  }

  /**
   * Query whether the zone is powered on.
   *
   * Retries once on ConnectionError — XR units sometimes accept TCP then
   * stay silent for a single request before answering normally.
   */
  async getPowerState(zone?: number): Promise<boolean> {
    const resolvedZone = this.resolveZone(zone)
    return this.trackQuery(() => this.readPowerState(resolvedZone))
  }

  /**
   * Query power with one retry.
   *
   * The retry policy sits *outside* the TCP lock and each attempt takes it
   * briefly, so the delay between attempts does not block other commands.
   */
  private async readPowerState(zone: number, deadline?: Deadline): Promise<boolean> {
    const on = await this.withQueryRetry('Power query', () => this.withExclusive(async () => {
      const response = await this.send(buildPowerQuery(zone), COMMAND_POWER, zone, { deadline })
      this.assertOk(response, 'power query')
      return isPowerOn(response.data)
    }), deadline)
    this.rememberPowerState(zone, on)
    return on
  }

  /** Power the zone on (discrete RC5 Power On). */
  async powerOn(zone?: number): Promise<void> {
    const resolvedZone = this.resolveZone(zone)
    return this.withExclusive(async () => {
      await this.powerOnUnlocked(resolvedZone)
      this.rememberPowerState(resolvedZone, true)
    })
  }

  private async powerOnUnlocked(zone: number, deadline?: Deadline): Promise<void> {
    const response = await this.send(
      buildPowerOn(zone),
      POWER_SET_RESPONSE_COMMANDS,
      zone,
      { deadline, confirms: confirmsPowerState(true) },
    )
    this.assertOk(response, 'power on')
  }

  /** Put the zone into standby (discrete RC5 Power Off). */
  async powerStandby(zone?: number): Promise<void> {
    const resolvedZone = this.resolveZone(zone)
    return this.withExclusive(async () => {
      await this.powerStandbyUnlocked(resolvedZone)
      this.rememberPowerState(resolvedZone, false)
    })
  }

  private async powerStandbyUnlocked(zone: number, deadline?: Deadline): Promise<void> {
    const response = await this.send(
      buildPowerStandby(zone),
      POWER_SET_RESPONSE_COMMANDS,
      zone,
      { deadline, confirms: confirmsPowerState(false) },
    )
    this.assertOk(response, 'standby')
  }

  /**
   * Set power from a boolean HomeKit On value.
   *
   * XR units sometimes apply RC5 Power On/Off without returning a frame (socket
   * stays open until our timeout). When the ack is missing, settle briefly and
   * confirm via Power query before failing the HomeKit write.
   */
  async setPower(on: boolean, zone?: number, options?: SetOptions): Promise<void> {
    const resolvedZone = this.resolveZone(zone)
    const deadline = deadlineFrom(options)
    try {
      // Only the write holds the TCP lock; verification re-acquires it per query
      // so a settle pause never blocks polls or other HomeKit writes.
      await this.withExclusive(async () => {
        if (on) {
          await this.powerOnUnlocked(resolvedZone, deadline)
        } else {
          await this.powerStandbyUnlocked(resolvedZone, deadline)
        }
      })
      this.rememberPowerState(resolvedZone, on)
      this.noteReachable()
      return
    } catch (error) {
      if (!(error instanceof ConnectionError)) {
        throw error
      }
      this.log.debug?.(
        `Power ${on ? 'on' : 'standby'} ack missing (${error.message}); verifying state`,
      )
      const verified = await this.verifyState(
        `Power ${on ? 'on' : 'standby'}`,
        () => this.readPowerState(resolvedZone, deadline),
        on,
        deadline,
      )
      if (verified) {
        this.rememberPowerState(resolvedZone, on)
        this.noteReachable()
        return
      }
      throw error
    }
  }

  /**
   * Query the absolute volume level (0–99) for the zone.
   *
   * Concurrent callers for the same zone share one in-flight query so a poll
   * tick with multiple volume-preset accessories does not open N sockets.
   * Retries once on ConnectionError (same as power query).
   */
  async getVolume(zone?: number): Promise<number> {
    const resolvedZone = this.resolveZone(zone)
    const existing = this.volumeQueryInFlight.get(resolvedZone)
    if (existing) {
      return existing
    }

    const pending = this.trackQuery(() => this.readVolume(resolvedZone))
      .finally(() => {
        this.volumeQueryInFlight.delete(resolvedZone)
      })

    this.volumeQueryInFlight.set(resolvedZone, pending)
    return pending
  }

  private async readVolume(zone: number, deadline?: Deadline): Promise<number> {
    return this.withQueryRetry('Volume query', () => this.withExclusive(async () => {
      const response = await this.send(buildVolumeQuery(zone), COMMAND_VOLUME, zone, { deadline })
      this.assertOk(response, 'volume query')
      return parseVolume(response.data)
    }), deadline)
  }

  /**
   * Set the absolute volume level (0–99) for the zone.
   *
   * When the set ack is missing (ConnectionError), settle and confirm via
   * volume query before failing — matching power-set resilience.
   */
  async setVolume(level: number, zone?: number, options?: SetOptions): Promise<void> {
    return this.setVolumeWithin(level, this.resolveZone(zone), deadlineFrom(options))
  }

  /** {@link setVolume}, bounded by an overall budget shared with verification. */
  private async setVolumeWithin(
    level: number,
    zone: number,
    deadline: Deadline,
  ): Promise<void> {
    try {
      await this.withExclusive(async () => {
        const response = await this.send(
          buildVolumeSet(zone, level),
          COMMAND_VOLUME,
          zone,
          { deadline, confirms: confirmsVolume(level) },
        )
        this.assertOk(response, 'volume set')
      })
      // Volume is only accepted while powered; keep standby-skip accurate.
      this.rememberPowerState(zone, true)
      this.noteReachable()
      return
    } catch (error) {
      if (!(error instanceof ConnectionError)) {
        throw error
      }
      this.log.debug?.(
        `Volume set ack missing (${error.message}); verifying level ${level}`,
      )
      const verified = await this.verifyState(
        `Volume ${level}`,
        () => this.readVolume(zone, deadline),
        level,
        deadline,
      )
      if (verified) {
        this.rememberPowerState(zone, true)
        this.noteReachable()
        return
      }
      throw error
    }
  }

  /**
   * Set volume, retrying politely while the receiver finishes waking.
   *
   * Cold boot often reports power On before volume is accepted (`0x85` / timeouts).
   * Retries every {@link WAKE_RETRY_INTERVAL_MS} until success or
   * {@link WAKE_RETRY_TIMEOUT_MS}, so Shortcuts can Set Volume without a fixed Wait.
   * Each attempt takes the TCP lock briefly; the wait between attempts does not.
   */
  async setVolumeWhenReady(
    level: number,
    zone?: number,
  ): Promise<void> {
    const resolvedZone = this.resolveZone(zone)
    return this.applyWhenReady(
      `Volume ${level}`,
      (timeoutMs) => this.setVolume(level, resolvedZone, { timeoutMs }),
    )
  }

  /**
   * Retry `apply` on not-ready errors until the wake window closes.
   *
   * @param label - Subject of the debug lines, e.g. `Volume 57`
   * @param apply - Performs one attempt, bounded by the remaining budget
   */
  private async applyWhenReady(
    label: string,
    apply: (timeoutMs: number) => Promise<void>,
  ): Promise<void> {
    const deadline = Date.now() + WAKE_RETRY_TIMEOUT_MS
    let attempt = 0

    for (;;) {
      this.assertNotClosed()
      attempt += 1
      try {
        // The budget bounds the attempt itself, not just the gap between
        // attempts, so the total wait cannot overrun the advertised window.
        await apply(deadline - Date.now())
        if (attempt > 1) {
          this.log.debug?.(`${label} set after ${attempt} attempts (receiver ready)`)
        }
        return
      } catch (error) {
        const remaining = deadline - Date.now()
        if (!isReceiverNotReadyError(error) || remaining <= 0) {
          throw error
        }
        this.log.debug?.(
          `${label} attempt ${attempt} failed (${describeError(error)}); retrying`,
        )
        await this.sleep(Math.min(WAKE_RETRY_INTERVAL_MS, remaining))
      }
    }
  }

  /**
   * Query the current input source id for the zone.
   *
   * Concurrent callers for the same zone share one in-flight query.
   * Retries once on ConnectionError (same as power / volume query).
   */
  async getSource(zone?: number): Promise<SourceId> {
    const resolvedZone = this.resolveZone(zone)
    const existing = this.sourceQueryInFlight.get(resolvedZone)
    if (existing) {
      return existing
    }

    const pending = this.trackQuery(() => this.readSource(resolvedZone))
      .finally(() => {
        this.sourceQueryInFlight.delete(resolvedZone)
      })

    this.sourceQueryInFlight.set(resolvedZone, pending)
    return pending
  }

  private async readSource(zone: number, deadline?: Deadline): Promise<SourceId> {
    return this.withQueryRetry('Source query', () => this.withExclusive(async () => {
      const response = await this.send(buildSourceQuery(zone), COMMAND_SOURCE, zone, { deadline })
      this.assertOk(response, 'source query')
      // Zone 2 may report Follow Zone 1 (0x00) — resolve the effective input.
      // Both queries stay inside one exclusive section so the pair is atomic.
      if (isSourceFollowZone1(response.data)) {
        if (zone === 1) {
          throw new ProtocolError('Source is Follow Zone 1 (unexpected for zone 1)')
        }
        const z1 = await this.send(buildSourceQuery(1), COMMAND_SOURCE, 1, { deadline })
        this.assertOk(z1, 'source query (zone 1 follow)')
        if (isSourceFollowZone1(z1.data)) {
          throw new ProtocolError('Zone 1 source is Follow Zone 1 (invalid)')
        }
        return parseSource(z1.data).id
      }
      return parseSource(response.data).id
    }), deadline)
  }

  /**
   * Select an input source for the zone (discrete RC5 source key).
   *
   * When the set ack is missing (ConnectionError), settle and confirm via
   * source query before failing — matching power/volume set resilience.
   *
   * @param source - Source id (`cd`), label (`CD`), or definition
   */
  async setSource(
    source: SourceId | string | SourceDefinition,
    zone?: number,
    options?: SetOptions,
  ): Promise<void> {
    return this.setSourceWithin(
      coerceSourceDefinition(source),
      this.resolveZone(zone),
      deadlineFrom(options),
    )
  }

  /** {@link setSource}, bounded by an overall budget shared with verification. */
  private async setSourceWithin(
    resolved: SourceDefinition,
    zone: number,
    deadline: Deadline,
  ): Promise<void> {
    try {
      await this.withExclusive(async () => {
        const response = await this.send(
          buildSourceSet(zone, resolved),
          SOURCE_SET_RESPONSE_COMMANDS,
          zone,
          { deadline, confirms: confirmsSource(resolved.id) },
        )
        this.assertOk(response, 'source set')
      })
      this.rememberPowerState(zone, true)
      this.noteReachable()
      return
    } catch (error) {
      if (!(error instanceof ConnectionError)) {
        throw error
      }
      this.log.debug?.(
        `Source set ack missing (${error.message}); verifying ${resolved.label}`,
      )
      const verified = await this.verifyState(
        `Source ${resolved.id}`,
        () => this.readSource(zone, deadline),
        resolved.id,
        deadline,
      )
      if (verified) {
        this.rememberPowerState(zone, true)
        this.noteReachable()
        return
      }
      throw error
    }
  }

  /**
   * Select a source, retrying politely while the receiver finishes waking.
   *
   * Same wake window as {@link setVolumeWhenReady} so Shortcuts can Set Input
   * after power-on without a fixed Wait.
   */
  async setSourceWhenReady(
    source: SourceId | string | SourceDefinition,
    zone?: number,
  ): Promise<void> {
    const resolved = coerceSourceDefinition(source)
    const resolvedZone = this.resolveZone(zone)
    return this.applyWhenReady(
      `Source ${resolved.label}`,
      (timeoutMs) => this.setSource(resolved, resolvedZone, { timeoutMs }),
    )
  }

  /** Stop a wake-retry loop promptly when Homebridge is shutting down. */
  private assertNotClosed(): void {
    if (this.isClosed) {
      throw new ConnectionError('Client closed while waiting for the receiver')
    }
  }

  /**
   * Poll state until it matches what a set intended, after a missing ack.
   *
   * The first check runs immediately: reaching here means a request timeout has
   * already elapsed, so the amp has had longer than {@link SET_SETTLE_MS} to
   * apply the change. Only re-checks pause. Each query re-acquires the TCP lock
   * on its own, so the pauses do not block other traffic.
   *
   * @param describe - Label for debug logs
   * @param matches - Reads current state and reports whether it matches
   */
  private async verifyAfterMissingAck(
    describe: string,
    matches: () => Promise<boolean>,
    deadline: Deadline,
  ): Promise<boolean> {
    for (let attempt = 0; attempt < SET_VERIFY_ATTEMPTS; attempt++) {
      if (attempt > 0 && !(await this.settleBeforeRecheck(deadline))) {
        return false
      }
      if (isExpired(deadline) || this.shutdown.signal.aborted) {
        return false
      }
      try {
        if (await matches()) {
          this.log.debug?.(`${describe} verified after missing ack`)
          return true
        }
      } catch (verifyError) {
        this.log.debug?.(
          `${describe} verify attempt ${attempt + 1} failed: ${describeError(verifyError)}`,
        )
      }
    }
    return false
  }

  /** Pause before re-checking; false when the budget ran out or we are closing. */
  private async settleBeforeRecheck(deadline: Deadline): Promise<boolean> {
    if (isExpired(deadline)) {
      return false
    }
    await this.sleep(boundedTimeout(SET_SETTLE_MS, deadline))
    return !this.shutdown.signal.aborted && !isExpired(deadline)
  }

  /**
   * True when a follow-up query reports the state the set intended.
   *
   * @param read - Reads current state; acquires the TCP lock for itself
   * @param expected - What the set asked the receiver to become
   */
  private verifyState<T>(
    label: string,
    read: () => Promise<T>,
    expected: T,
    deadline?: Deadline,
  ): Promise<boolean> {
    return this.verifyAfterMissingAck(label, async () => await read() === expected, deadline)
  }

  private assertOk(response: ProtocolResponse, operation: string): void {
    if (response.answerCode !== ANSWER_OK) {
      throw new ProtocolError(
        `${operation} rejected: ${describeAnswerCode(response.answerCode)}`,
        { answerCode: response.answerCode },
      )
    }
  }

  /**
   * Write one request frame on the shared control socket and resolve with the
   * first matching response. The socket stays open. A timeout, error, or peer
   * close drops it so the next command dials again.
   *
   * @param expectedCommands - Accept the first response whose command is in this list
   *   (RC5 set may reply with 0x08, and often also emits a Power 0x00 status)
   * @param zone - Zone expected on matching response frames
   * @param options.confirms - Extra test a candidate frame must pass. A set may
   *   be acknowledged by a following status frame, so the payload has to agree
   *   with what was asked. A frame reporting the opposite state is discarded,
   *   which routes the ambiguity into settle-and-verify rather than caching
   *   the inverse of reality.
   */
  private send(
    request: Buffer,
    expectedCommands: number | readonly number[],
    zone: number,
    options: SendOptions = {},
  ): Promise<ProtocolResponse> {
    const { deadline, confirms } = options
    const { host, port } = this
    // Not `Array.isArray`: it narrows a readonly tuple to `any[]`, which would
    // make the `accepted.includes` check below unchecked in a strict codebase.
    const accepted: readonly number[] = typeof expectedCommands === 'number'
      ? [expectedCommands]
      : expectedCommands
    if (accepted.length === 0) {
      // Otherwise every frame is discarded and the request can only time out.
      throw new RangeError('send() requires at least one expected response command')
    }
    if (this.isClosed) {
      return Promise.reject(new ConnectionError('Client is closed'))
    }
    if (isExpired(deadline)) {
      const error = new ConnectionError(`Ran out of time waiting for ${host}:${port} to become ready`)
      this.observeExchange(error)
      return Promise.reject(error)
    }
    this.log.debug?.(`→ ${host}:${port} ${formatFrame(request)}`)

    return new Promise((resolve, reject) => {
      const pending: PendingExchange = {
        zone,
        accepted,
        confirms,
        target: `${host}:${port} zone ${zone}`,
        armed: false,
        settled: false,
        abort: () => undefined,
        resolve,
        reject,
      }
      const abort = (error: Error): void => {
        this.rejectPending(pending, error)
      }
      pending.abort = abort
      this.inFlightAborts.add(abort)
      this.startExchange(pending, request, deadline)
    })
  }

  /** Reuse the open socket, or dial when the last one was dropped. */
  private startExchange(pending: PendingExchange, request: Buffer, deadline: Deadline): void {
    const existing = this.usableSession()
    if (existing) {
      this.armAndWrite(existing, pending, request, deadline)
      return
    }
    this.dial(pending, request, deadline)
  }

  /**
   * The live session, or `undefined` when there is nothing worth writing to.
   * A socket the peer already killed is retired here so its listeners do not
   * linger after {@link dial} replaces it.
   */
  private usableSession(): ControlSession | undefined {
    const session = this.session
    if (!session) {
      return undefined
    }
    const alive = !session.dropped
      && session.socket.destroyed !== true
      && session.socket.writable !== false
    if (alive) {
      return session
    }
    this.retireSession(session)
    return undefined
  }

  /** Open a new control connection for `pending` and write once it connects. */
  private dial(pending: PendingExchange, request: Buffer, deadline: Deadline): void {
    const { host, port, connectHost } = this
    let socket: net.Socket
    try {
      socket = this.createConnection({ host: connectHost, port })
    } catch (error) {
      // e.g. an option rejected by net before any socket/timer exists.
      this.rejectPending(pending, new ConnectionError(
        `Connection to ${host}:${port} failed: ${describeError(error)}`,
        { cause: error },
      ))
      return
    }
    if (!socket) {
      this.rejectPending(pending, new ConnectionError(
        `Connection to ${host}:${port} produced no socket`,
      ))
      return
    }

    const session = this.bindSession(socket)
    this.session = session
    pending.session = session
    session.pending = pending

    const onConnect = (): void => {
      socket.off('connect', onConnect)
      if (pending.connectTimer) {
        clearTimeout(pending.connectTimer)
        pending.connectTimer = undefined
      }
      this.armAndWrite(session, pending, request, deadline)
    }
    session.onConnect = onConnect
    pending.connectTimer = setTimeout(() => {
      this.rejectPending(pending, new ConnectionError(`Timed out connecting to ${pending.target}`))
    }, boundedTimeout(this.connectTimeoutMs, deadline))

    socket.on('connect', onConnect)
    socket.on('data', session.onData)
    socket.on('error', session.onError)
    socket.on('close', session.onClose)
    socket.on('end', session.onEnd)
  }

  /** Attach the session's listeners. They stay for the life of the socket. */
  private bindSession(socket: net.Socket): ControlSession {
    // Test fakes are EventEmitters, not real sockets, and lack these.
    const withOptions = socket as Partial<Pick<net.Socket, 'setNoDelay' | 'setKeepAlive'>>
    withOptions.setNoDelay?.(true)
    withOptions.setKeepAlive?.(true, CONTROL_SOCKET_KEEPALIVE_MS)

    const session: ControlSession = {
      socket,
      buffer: Buffer.alloc(0),
      dropped: false,
      onData: () => undefined,
      onError: () => undefined,
      onClose: () => undefined,
      onEnd: () => undefined,
    }
    session.onData = (chunk: Buffer) => {
      this.handleData(session, chunk)
    }
    session.onError = (error: Error) => {
      this.handleSocketError(session, error)
    }
    session.onClose = () => {
      this.handleSocketClose(session)
    }
    session.onEnd = () => {
      this.handleSocketClose(session)
    }
    return session
  }

  /** Arm the response timer and write. Stale bytes from earlier traffic are dropped. */
  private armAndWrite(
    session: ControlSession,
    pending: PendingExchange,
    request: Buffer,
    deadline: Deadline,
  ): void {
    if (pending.settled || session.dropped) {
      return
    }
    session.pending = pending
    pending.session = session
    // Anything already buffered arrived before this request. Matching it would
    // report whatever the receiver said last, not the answer to this write.
    session.buffer = Buffer.alloc(0)
    pending.armed = true
    // Recomputed here so connect + response together stay inside the budget.
    pending.requestTimer = setTimeout(() => {
      this.rejectPending(pending, new ConnectionError(
        `Timed out waiting for a response from ${pending.target}`
        + `${describePartialResponse(session.buffer)}`,
      ))
    }, boundedTimeout(this.requestTimeoutMs, deadline))

    session.socket.write(request, (writeError) => {
      if (!writeError || pending.settled) {
        return
      }
      this.rejectPending(pending, new ConnectionError(
        `Failed to write to ${pending.target}: ${writeError.message}`,
        { cause: writeError },
      ))
    })
  }

  /** Fold `chunk` into the session buffer and take the first frame that matches. */
  private handleData(session: ControlSession, chunk: Buffer): void {
    if (session.dropped) {
      return
    }
    session.buffer = Buffer.concat([session.buffer, chunk])
    let remaining = session.buffer
    while (remaining.length > 0) {
      const parsed = tryParseResponse(remaining)
      if (!parsed) {
        // Drop bytes before the first start byte so noise cannot accumulate
        // and be rescanned on every subsequent chunk.
        const nextStart = remaining.indexOf(FRAME_START)
        session.buffer = nextStart < 0 ? Buffer.alloc(0) : remaining.subarray(nextStart)
        break
      }
      remaining = remaining.subarray(parsed.consumed)
      session.buffer = remaining
      if (this.acceptFrame(session, parsed.response)) {
        return
      }
    }

    // Checked after draining so a valid frame at the head of an oversized
    // chunk is still honored; only unparseable residue trips the cap.
    if (!session.dropped && session.buffer.length > MAX_RESPONSE_BUFFER_BYTES) {
      this.failOversized(session)
    }
  }

  /**
   * Apply one parsed frame to the in-flight exchange.
   *
   * @returns true when the exchange is complete and the caller should stop
   */
  private acceptFrame(session: ControlSession, response: ProtocolResponse): boolean {
    const pending = session.pending
    if (!pending?.armed || pending.settled) {
      this.log.debug?.(
        `Ignoring unsolicited frame cmd=0x${response.command.toString(16)} `
        + `from ${this.host}:${this.port}`,
      )
      return false
    }
    if (response.zone !== pending.zone || !pending.accepted.includes(response.command)) {
      const expected = pending.accepted.map((cmd) => `0x${cmd.toString(16)}`).join('|')
      this.log.debug?.(
        `Ignoring unmatched frame zone=${response.zone} cmd=0x${response.command.toString(16)} `
        + `(expected zone=${pending.zone} cmd=${expected})`,
      )
      return false
    }
    // Only an OK frame needs its payload checked. A non-OK answer code is a
    // definitive rejection and must reach `assertOk` rather than being
    // discarded as unconfirming, which would turn it into a timeout.
    if (pending.confirms && response.answerCode === ANSWER_OK && !pending.confirms(response)) {
      this.log.debug?.(
        'Ignoring frame that does not confirm the request: cmd=0x'
        + `${response.command.toString(16)} data=${formatFrame(response.data)}`,
      )
      return false
    }
    this.succeedPending(pending, response)
    return true
  }

  /** Give up on a stream that will never parse. Drops the socket either way. */
  private failOversized(session: ControlSession): void {
    const pending = session.pending
    const target = pending?.target ?? `${this.host}:${this.port}`
    const error = new ProtocolError(
      `Response from ${target} exceeded ${MAX_RESPONSE_BUFFER_BYTES} bytes`,
    )
    if (pending && !pending.settled) {
      this.rejectPending(pending, error)
      return
    }
    this.retireSession(session)
  }

  /** Complete the exchange and leave the socket open for the next command. */
  private succeedPending(pending: PendingExchange, response: ProtocolResponse): void {
    if (pending.settled) {
      return
    }
    pending.settled = true
    this.clearPendingTimers(pending)
    this.inFlightAborts.delete(pending.abort)
    if (pending.session) {
      pending.session.pending = undefined
    }
    this.observeExchange()
    this.log.debug?.(
      `← ${this.host}:${this.port} cmd=0x${response.command.toString(16)} `
      + `answer=${describeAnswerCode(response.answerCode)} data=${formatFrame(response.data)}`,
    )
    pending.resolve(response)
  }

  /**
   * Fail the exchange and drop the socket.
   *
   * A socket that timed out or reset is not reused. The query retry then dials
   * a new one, which is what actually recovers after the receiver goes silent.
   */
  private rejectPending(pending: PendingExchange, error: Error): void {
    if (pending.settled) {
      return
    }
    pending.settled = true
    this.clearPendingTimers(pending)
    this.inFlightAborts.delete(pending.abort)
    const session = pending.session
    if (session) {
      session.pending = undefined
      this.retireSession(session)
    }
    this.observeExchange(error)
    pending.reject(error)
  }

  private clearPendingTimers(pending: PendingExchange): void {
    if (pending.connectTimer) {
      clearTimeout(pending.connectTimer)
      pending.connectTimer = undefined
    }
    if (pending.requestTimer) {
      clearTimeout(pending.requestTimer)
      pending.requestTimer = undefined
    }
  }

  private handleSocketError(session: ControlSession, error: Error): void {
    const pending = session.pending
    if (pending && !pending.settled) {
      this.rejectPending(pending, new ConnectionError(
        `Connection to ${pending.target} failed: ${error.message}`,
        { cause: error },
      ))
      return
    }
    this.log.debug?.(
      `Control connection to ${this.host}:${this.port} failed: ${error.message}`,
    )
    this.retireSession(session)
  }

  private handleSocketClose(session: ControlSession): void {
    if (session.dropped) {
      return
    }
    const pending = session.pending
    if (pending && !pending.settled) {
      this.rejectPending(pending, new ConnectionError(
        `Connection to ${pending.target} closed before a response arrived`,
      ))
      return
    }
    this.retireSession(session)
  }

  /**
   * Forget `session` and destroy its socket.
   *
   * Listeners this session added are removed first. `destroy()` can still emit
   * `error`, and Node rethrows that when nothing is listening, which would take
   * down the whole Homebridge process. `removeAllListeners()` is not used: it
   * would also strip the listeners net.Socket installs for its own lifecycle.
   */
  private retireSession(session: ControlSession): void {
    if (session.dropped) {
      return
    }
    session.dropped = true
    if (this.session === session) {
      this.session = undefined
    }
    session.pending = undefined
    const { socket } = session
    if (session.onConnect) {
      socket.off('connect', session.onConnect)
    }
    socket.off('data', session.onData)
    socket.off('error', session.onError)
    socket.off('close', session.onClose)
    socket.off('end', session.onEnd)
    socket.on('error', (late: Error) => {
      this.log.debug?.(`Socket error after teardown for ${this.host}:${this.port}: ${late.message}`)
    })
    socket.destroy()
  }
}

/** Bytes of an unparseable partial response to include in an error message. */
const MAX_PARTIAL_RESPONSE_HINT_BYTES = 32

/**
 * Describe whatever arrived before a timeout, without pasting the whole buffer.
 *
 * The buffer holds up to {@link MAX_RESPONSE_BUFFER_BYTES}, and this message is
 * logged at warn level — a chatty or mismatched peer would otherwise turn every
 * poll failure into a multi-kilobyte log line.
 */
function describePartialResponse(buffer: Buffer): string {
  if (buffer.length === 0) {
    return ''
  }
  const shown = formatFrame(buffer.subarray(0, MAX_PARTIAL_RESPONSE_HINT_BYTES))
  const omitted = buffer.length - MAX_PARTIAL_RESPONSE_HINT_BYTES
  return omitted > 0
    ? ` (received ${shown} +${omitted} more bytes)`
    : ` (received ${shown})`
}

/**
 * Unwrap a bracketed IPv6 literal (`[fe80::1]` → `fe80::1`).
 *
 * Config accepts the bracketed form, but `net.createConnection` passes `host`
 * straight to `dns.lookup`, which never strips brackets and would fail with
 * ENOTFOUND on an otherwise valid address.
 */
function stripIpv6Brackets(host: string): string {
  const trimmed = host.trim()
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

/**
 * Accept an RC5 ack, or a Power status frame that agrees with the requested state.
 *
 * A `0x00` status frame is a legitimate acknowledgement of an RC5 power command,
 * but only if it reports the state we asked for. One reporting the opposite means
 * the command has not taken effect (yet), and treating it as success would cache
 * the inverse of reality.
 */
function confirmsPowerState(expectedOn: boolean) {
  return (response: ProtocolResponse): boolean => {
    if (response.command !== COMMAND_POWER) {
      return true
    }
    try {
      return isPowerOn(response.data) === expectedOn
    } catch {
      return false
    }
  }
}

/** Accept an RC5 ack, or a Source status frame that reports the requested input. */
function confirmsSource(expected: SourceId) {
  return (response: ProtocolResponse): boolean => {
    if (response.command !== COMMAND_SOURCE) {
      return true
    }
    try {
      return parseSource(response.data).id === expected
    } catch {
      return false
    }
  }
}

/** Accept a Volume status frame only when it echoes the requested level. */
function confirmsVolume(expectedLevel: number) {
  return (response: ProtocolResponse): boolean => {
    try {
      return parseVolume(response.data) === expectedLevel
    } catch {
      return false
    }
  }
}

/**
 * Transport failures that mean the receiver is absent, not merely asleep.
 *
 * Retrying these for the full wake window just re-dials a host that is not
 * there; a waking receiver accepts the connection and then stalls or answers
 * `0x85`, which is what the retry loop is for.
 */
const PERMANENT_CONNECT_CODES = new Set([
  'ENOTFOUND',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EAI_AGAIN',
])

/** True when a set failure is likely due to wake / not-ready state. */
export function isReceiverNotReadyError(error: unknown): boolean {
  if (error instanceof ConnectionError) {
    const code = (error.cause as { code?: unknown } | undefined)?.code
    return typeof code !== 'string' || !PERMANENT_CONNECT_CODES.has(code)
  }
  return error instanceof ProtocolError && error.answerCode === ANSWER_INVALID_STATE
}

function coerceSourceDefinition(
  source: SourceId | string | SourceDefinition,
): SourceDefinition {
  if (typeof source === 'object' && source !== null && 'id' in source && 'queryCode' in source) {
    return source
  }
  const resolved = resolveSourceDefinition(String(source))
  if (!resolved) {
    throw new RangeError(`Unknown source "${String(source)}"`)
  }
  return resolved
}

/**
 * Delay that resolves early on abort and never keeps Node alive on its own.
 *
 * Without `unref`, a pending wake-retry pause delays Homebridge shutdown by up
 * to the full retry interval.
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    timer.unref?.()

    function onAbort(): void {
      clearTimeout(timer)
      resolve()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
