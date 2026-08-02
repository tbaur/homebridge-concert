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
import net from 'node:net';
import type { PluginLogger } from '../types';
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
    constructor(options: ConcertClientOptions);
    private resolveZone;
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
    /** Power the zone on (discrete RC5 Power On). */
    powerOn(zone?: number): Promise<void>;
    /** Put the zone into standby (discrete RC5 Power Off). */
    powerStandby(zone?: number): Promise<void>;
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
    /**
     * Set the absolute volume level (0–99) for the zone.
     *
     * When the set ack is missing (ConnectionError), settle and confirm via
     * volume query before failing — matching power-set resilience.
     */
    setVolume(level: number, zone?: number): Promise<void>;
    /** True when a power query reports the desired on/off state. */
    private verifyPowerState;
    /** True when a volume query reports the desired level. */
    private verifyVolumeLevel;
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