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
 * Commands are serialized so standby does not see overlapping TCP sessions.
 */
import net from 'node:net';
import type { PluginLogger } from '../types';
import { type SourceDefinition, type SourceId } from './protocol';
export interface ConcertClientOptions {
    host: string;
    port?: number;
    /** Default zone when a method is called without an explicit zone. */
    zone?: number;
    connectTimeoutMs?: number;
    requestTimeoutMs?: number;
    logger?: PluginLogger;
    /** Injected for tests; defaults to `net.createConnection`. */
    createConnection?: typeof net.createConnection;
}
/** Options for {@link ConcertClient.setVolumeWhenReady}. */
export interface SetVolumeWhenReadyOptions {
    /**
     * Called once after {@link VOLUME_READY_NOT_READY_LOG_AFTER_MS} of retryable
     * failures (not on the first attempt — normal XR wake stays quiet).
     */
    onWaiting?: () => void;
}
/** Options for {@link ConcertClient.setSourceWhenReady}. */
export interface SetSourceWhenReadyOptions {
    /**
     * Called once after {@link SOURCE_READY_NOT_READY_LOG_AFTER_MS} of retryable
     * failures (not on the first attempt — normal XR wake stays quiet).
     */
    onWaiting?: () => void;
}
/**
 * Sends framed automation commands to an AudioControl Concert receiver over TCP.
 */
export declare class ConcertClient {
    private readonly host;
    private readonly port;
    private readonly defaultZone;
    private readonly connectTimeoutMs;
    private readonly requestTimeoutMs;
    private readonly log;
    private readonly createConnection;
    /** Coalesce concurrent volume queries for the same zone (poll fan-out). */
    private readonly volumeQueryInFlight;
    /** Coalesce concurrent source queries for the same zone (poll fan-out). */
    private readonly sourceQueryInFlight;
    /** Last successfully observed power state per zone. */
    private readonly lastPowerOnByZone;
    /**
     * Serialize TCP commands. Nested work inside an exclusive section must call
     * unlocked helpers (not public methods) to avoid deadlock.
     */
    private sendQueue;
    constructor(options: ConcertClientOptions);
    private resolveZone;
    /**
     * Last known power state for the zone, if a query or set has succeeded.
     * `undefined` until the first successful observation.
     */
    getLastPowerState(zone?: number): boolean | undefined;
    private rememberPowerState;
    /** Run `fn` with exclusive access to the TCP send path. */
    private withExclusive;
    /**
     * Retry a ConnectionError once — XR units sometimes accept TCP then stay
     * silent for a single request before answering normally.
     */
    private withQueryRetry;
    /**
     * Query whether the zone is powered on.
     *
     * Retries once on ConnectionError — XR units sometimes accept TCP then
     * stay silent for a single request before answering normally.
     */
    getPowerState(zone?: number): Promise<boolean>;
    private getPowerStateUnlocked;
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
    setPower(on: boolean, zone?: number): Promise<void>;
    /**
     * Query the absolute volume level (0–99) for the zone.
     *
     * Concurrent callers for the same zone share one in-flight query so a poll
     * tick with multiple volume-preset accessories does not open N sockets.
     * Retries once on ConnectionError (same as power query).
     */
    getVolume(zone?: number): Promise<number>;
    private getVolumeUnlocked;
    /**
     * Set the absolute volume level (0–99) for the zone.
     *
     * When the set ack is missing (ConnectionError), settle and confirm via
     * volume query before failing — matching power-set resilience.
     */
    setVolume(level: number, zone?: number): Promise<void>;
    /**
     * Set volume, retrying politely while the receiver finishes waking.
     *
     * Cold boot often reports power On before volume is accepted (`0x85` / timeouts).
     * Retries every {@link VOLUME_READY_RETRY_INTERVAL_MS} until success or
     * {@link VOLUME_READY_TIMEOUT_MS}, so Shortcuts can Set Volume without a fixed Wait.
     * Each attempt takes the TCP lock briefly; the wait between attempts does not.
     */
    setVolumeWhenReady(level: number, zone?: number, options?: SetVolumeWhenReadyOptions): Promise<void>;
    /**
     * Query the current input source id for the zone.
     *
     * Concurrent callers for the same zone share one in-flight query.
     * Retries once on ConnectionError (same as power / volume query).
     */
    getSource(zone?: number): Promise<SourceId>;
    private getSourceUnlocked;
    /**
     * Select an input source for the zone (discrete RC5 source key).
     *
     * When the set ack is missing (ConnectionError), settle and confirm via
     * source query before failing — matching power/volume set resilience.
     *
     * @param source - Source id (`cd`), label (`CD`), or definition
     */
    setSource(source: SourceId | string | SourceDefinition, zone?: number): Promise<void>;
    /**
     * Select a source, retrying politely while the receiver finishes waking.
     *
     * Same wake window as {@link setVolumeWhenReady} so Shortcuts can Set Input
     * after power-on without a fixed Wait.
     */
    setSourceWhenReady(source: SourceId | string | SourceDefinition, zone?: number, options?: SetSourceWhenReadyOptions): Promise<void>;
    /** True when a power query reports the desired on/off state. */
    private verifyPowerState;
    /** True when a volume query reports the desired level. */
    private verifyVolumeLevel;
    /** True when a source query reports the desired input. */
    private verifySource;
    private assertOk;
    /**
     * Open a TCP connection, write one request frame, and resolve with the first
     * matching response frame. Always closes the socket afterward.
     *
     * @param expectedCommands - Accept the first response whose command is in this list
     *   (RC5 set may reply with 0x08, and often also emits a Power 0x00 status)
     * @param zone - Zone expected on matching response frames
     */
    private send;
}
//# sourceMappingURL=client.d.ts.map