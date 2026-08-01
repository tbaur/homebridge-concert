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
    /** Query whether the configured zone is powered on. */
    getPowerState(): Promise<boolean>;
    /** Power the configured zone on. */
    powerOn(): Promise<void>;
    /** Put the configured zone into standby. */
    powerStandby(): Promise<void>;
    /** Set power from a boolean HomeKit On value. */
    setPower(on: boolean): Promise<void>;
    private assertOk;
    /**
     * Open a TCP connection, write one request frame, and resolve with the first
     * matching response frame. Always closes the socket afterward.
     */
    private send;
}
//# sourceMappingURL=client.d.ts.map