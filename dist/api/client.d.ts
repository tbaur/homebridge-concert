/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview TCP client for AudioControl Concert X/XR series IP automation control.
 *
 * Opens a short-lived connection per request. That keeps the client simple and
 * avoids sticky half-open sockets if the receiver drops idle clients in standby.
 * Commands are serialized so standby does not see overlapping TCP sessions.
 */
import net from 'node:net';
import type { PluginLogger } from '../types';
import { type SourceDefinition, type SourceId } from './protocol';
export interface ConcertClientOptions {
    host: string;
    port?: number;
    connectTimeoutMs?: number;
    requestTimeoutMs?: number;
    logger?: PluginLogger;
    /** Injected for tests; defaults to `net.createConnection`. */
    createConnection?: typeof net.createConnection;
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
    timeoutMs?: number;
}
/**
 * Sends framed automation commands to an AudioControl Concert receiver over TCP.
 */
export declare class ConcertClient {
    /** Host exactly as configured — used for logs and error messages. */
    private readonly host;
    /** Host handed to `net`, with any IPv6 brackets removed. */
    private readonly connectHost;
    private readonly port;
    private readonly connectTimeoutMs;
    private readonly requestTimeoutMs;
    private readonly log;
    private readonly createConnection;
    /** Coalesce concurrent volume queries for the same zone (poll fan-out). */
    private readonly volumeQueryInFlight;
    /** Coalesce concurrent source queries for the same zone (poll fan-out). */
    private readonly sourceQueryInFlight;
    /** Last successfully observed power state per zone, with when it was seen. */
    private readonly lastPowerByZone;
    /** Cancels for in-flight requests, invoked by {@link close}. */
    private readonly inFlightAborts;
    /** Aborts pending retry sleeps and in-flight requests on shutdown. */
    private readonly shutdown;
    private isClosed;
    /** Consecutive query failures, used to open {@link queryBreakerOpenUntil}. */
    private consecutiveQueryFailures;
    /** Epoch ms until which queries fail fast instead of dialing an absent receiver. */
    private queryBreakerOpenUntil;
    /** How many times the breaker has opened without an intervening success. */
    private queryBreakerOpenCount;
    /**
     * Serialize TCP commands. Nested work inside an exclusive section must call
     * unlocked helpers (not public methods) to avoid deadlock.
     */
    private sendQueue;
    constructor(options: ConcertClientOptions);
    /**
     * @throws {RangeError} when an explicit zone is out of range. Silently
     *   coercing it would let a caller bug quietly control the wrong zone, and
     *   every other layer treats a bad zone as fatal.
     */
    private resolveZone;
    /**
     * Last known power state for the zone, if a query or set has succeeded.
     * `undefined` until the first successful observation.
     */
    getLastPowerState(zone?: number): boolean | undefined;
    private rememberPowerState;
    /**
     * Release every resource the client owns: wake pending retry sleeps and fail
     * in-flight requests instead of letting them run out their timeouts.
     * Idempotent. After this, further requests fail fast.
     */
    close(): void;
    /**
     * Fail fast while the query breaker is open.
     *
     * An absent receiver otherwise costs every accessory a full connect+retry
     * cycle on every poll tick, which can consume most of the poll interval.
     * Only queries consult the breaker — a HomeKit set is a deliberate user
     * action and always gets to try.
     */
    private assertQueryAllowed;
    /** A completed exchange proves the receiver is reachable; reset the breaker. */
    private noteReachable;
    /**
     * Count a transport failure and open the breaker once the threshold is hit.
     *
     * The cool-off grows once per *opening*, not once per failed query. One poll
     * sweep issues a query per command type, so counting per query advanced the
     * backoff several steps at a time and pushed recovery minutes past the point
     * the receiver came back.
     */
    private noteUnreachable;
    /**
     * Run a query, keeping the breaker state in sync. Only transport failures
     * count as unreachable — a ProtocolError means the receiver answered.
     */
    private trackQuery;
    /** Run `fn` with exclusive access to the TCP send path. */
    private withExclusive;
    /**
     * Retry a ConnectionError once — XR units sometimes accept TCP then stay
     * silent for a single request before answering normally.
     */
    private withQueryRetry;
    /** Retry sleep that wakes early on shutdown and never holds the event loop open. */
    private sleep;
    /**
     * Query whether the zone is powered on.
     *
     * Retries once on ConnectionError — XR units sometimes accept TCP then
     * stay silent for a single request before answering normally.
     */
    getPowerState(zone?: number): Promise<boolean>;
    /**
     * Query power with one retry.
     *
     * The retry policy sits *outside* the TCP lock and each attempt takes it
     * briefly, so the delay between attempts does not block other commands.
     */
    private readPowerState;
    /** Power the zone on (discrete RC5 Power On). */
    powerOn(zone?: number): Promise<void>;
    private powerOnUnlocked;
    /** Put the zone into standby (discrete RC5 Power Off). */
    powerStandby(zone?: number): Promise<void>;
    private powerStandbyUnlocked;
    /**
     * Set power from a boolean HomeKit On value.
     *
     * XR units sometimes apply RC5 Power On/Off without returning a frame (socket
     * stays open until our timeout). When the ack is missing, settle briefly and
     * confirm via Power query before failing the HomeKit write.
     */
    setPower(on: boolean, zone?: number, options?: SetOptions): Promise<void>;
    /**
     * Query the absolute volume level (0–99) for the zone.
     *
     * Concurrent callers for the same zone share one in-flight query so a poll
     * tick with multiple volume-preset accessories does not open N sockets.
     * Retries once on ConnectionError (same as power query).
     */
    getVolume(zone?: number): Promise<number>;
    private readVolume;
    /**
     * Set the absolute volume level (0–99) for the zone.
     *
     * When the set ack is missing (ConnectionError), settle and confirm via
     * volume query before failing — matching power-set resilience.
     */
    setVolume(level: number, zone?: number, options?: SetOptions): Promise<void>;
    /** {@link setVolume}, bounded by an overall budget shared with verification. */
    private setVolumeWithin;
    /**
     * Set volume, retrying politely while the receiver finishes waking.
     *
     * Cold boot often reports power On before volume is accepted (`0x85` / timeouts).
     * Retries every {@link WAKE_RETRY_INTERVAL_MS} until success or
     * {@link WAKE_RETRY_TIMEOUT_MS}, so Shortcuts can Set Volume without a fixed Wait.
     * Each attempt takes the TCP lock briefly; the wait between attempts does not.
     */
    setVolumeWhenReady(level: number, zone?: number): Promise<void>;
    /**
     * Retry `apply` on not-ready errors until the wake window closes.
     *
     * @param label - Subject of the debug lines, e.g. `Volume 57`
     * @param apply - Performs one attempt, bounded by the remaining budget
     */
    private applyWhenReady;
    /**
     * Query the current input source id for the zone.
     *
     * Concurrent callers for the same zone share one in-flight query.
     * Retries once on ConnectionError (same as power / volume query).
     */
    getSource(zone?: number): Promise<SourceId>;
    private readSource;
    /**
     * Select an input source for the zone (discrete RC5 source key).
     *
     * When the set ack is missing (ConnectionError), settle and confirm via
     * source query before failing — matching power/volume set resilience.
     *
     * @param source - Source id (`cd`), label (`CD`), or definition
     */
    setSource(source: SourceId | string | SourceDefinition, zone?: number, options?: SetOptions): Promise<void>;
    /** {@link setSource}, bounded by an overall budget shared with verification. */
    private setSourceWithin;
    /**
     * Select a source, retrying politely while the receiver finishes waking.
     *
     * Same wake window as {@link setVolumeWhenReady} so Shortcuts can Set Input
     * after power-on without a fixed Wait.
     */
    setSourceWhenReady(source: SourceId | string | SourceDefinition, zone?: number): Promise<void>;
    /** Stop a wake-retry loop promptly when Homebridge is shutting down. */
    private assertNotClosed;
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
    private verifyAfterMissingAck;
    /** Pause before re-checking; false when the budget ran out or we are closing. */
    private settleBeforeRecheck;
    /**
     * True when a follow-up query reports the state the set intended.
     *
     * @param read - Reads current state; acquires the TCP lock for itself
     * @param expected - What the set asked the receiver to become
     */
    private verifyState;
    private assertOk;
    /**
     * Open a TCP connection, write one request frame, and resolve with the first
     * matching response frame. Always closes the socket afterward.
     *
     * @param expectedCommands - Accept the first response whose command is in this list
     *   (RC5 set may reply with 0x08, and often also emits a Power 0x00 status)
     * @param zone - Zone expected on matching response frames
     */
    /**
     * @param confirms - Optional extra test a candidate frame must pass. A set is
     *   allowed to be acknowledged by a following *status* frame, so the payload
     *   has to agree with what was asked; a frame that reports the opposite state
     *   is discarded like any other unmatched frame, which routes the ambiguity
     *   into the settle-and-verify path rather than reporting a false success.
     */
    private send;
}
/** True when a set failure is likely due to wake / not-ready state. */
export declare function isReceiverNotReadyError(error: unknown): boolean;
//# sourceMappingURL=client.d.ts.map