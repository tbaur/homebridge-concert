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
    private readonly zone;
    private readonly connectTimeoutMs;
    private readonly requestTimeoutMs;
    private readonly log;
    private readonly createConnection;
    constructor(options: ConcertClientOptions);
    /**
     * Query whether the configured zone is powered on.
     *
     * Retries once on ConnectionError — XR units sometimes accept TCP then
     * stay silent for a single request before answering normally.
     */
    getPowerState(): Promise<boolean>;
    private queryPowerOnce;
    /** Power the configured zone on (discrete RC5 Power On). */
    powerOn(): Promise<void>;
    /** Put the configured zone into standby (discrete RC5 Power Off). */
    powerStandby(): Promise<void>;
    /**
     * Set power from a boolean HomeKit On value.
     *
     * XR units sometimes apply RC5 Power On/Off without returning a frame (socket
     * stays open until our timeout). When the ack is missing, settle briefly and
     * confirm via Power query before failing the HomeKit write.
     */
    setPower(on: boolean): Promise<void>;
    /** True when a power query reports the desired on/off state. */
    private verifyPowerState;
    private assertOk;
    /**
     * Open a TCP connection, write one request frame, and resolve with the first
     * matching response frame. Always closes the socket afterward.
     *
     * @param expectedCommands - Accept the first response whose command is in this list
     *   (RC5 set may reply with 0x08, and often also emits a Power 0x00 status)
     */
    private send;
}
//# sourceMappingURL=client.d.ts.map