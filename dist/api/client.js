"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConcertClient = void 0;
const node_net_1 = __importDefault(require("node:net"));
const errors_1 = require("../errors");
const settings_1 = require("../settings");
const protocol_1 = require("./protocol");
/** Responses accepted after a power set: RC5 ack, or a following Power status. */
const POWER_SET_RESPONSE_COMMANDS = [protocol_1.COMMAND_RC5, protocol_1.COMMAND_POWER];
/**
 * Sends framed automation commands to an AudioControl Concert receiver over TCP.
 */
class ConcertClient {
    host;
    port;
    defaultZone;
    connectTimeoutMs;
    requestTimeoutMs;
    log;
    createConnection;
    /** Coalesce concurrent volume queries for the same zone (poll fan-out). */
    volumeQueryInFlight = new Map();
    constructor(options) {
        this.host = options.host;
        this.port = options.port ?? settings_1.DEFAULT_CONTROL_PORT;
        this.defaultZone = options.zone ?? settings_1.DEFAULT_ZONE;
        this.connectTimeoutMs = options.connectTimeoutMs ?? settings_1.DEFAULT_CONNECT_TIMEOUT_MS;
        this.requestTimeoutMs = options.requestTimeoutMs ?? settings_1.DEFAULT_REQUEST_TIMEOUT_MS;
        this.log = options.logger ?? {};
        this.createConnection = options.createConnection ?? node_net_1.default.createConnection;
    }
    resolveZone(zone) {
        return zone === 1 || zone === 2 ? zone : this.defaultZone;
    }
    /**
     * Retry a ConnectionError once — XR units sometimes accept TCP then stay
     * silent for a single request before answering normally.
     */
    async withQueryRetry(operation, run) {
        const attempts = 1 + settings_1.POWER_QUERY_RETRIES;
        let lastError;
        for (let attempt = 1; attempt <= attempts; attempt++) {
            try {
                return await run();
            }
            catch (error) {
                lastError = error;
                if (!(error instanceof errors_1.ConnectionError) || attempt >= attempts) {
                    throw error;
                }
                this.log.debug?.(`${operation} failed (${error.message}); retrying `
                    + `(${attempt}/${settings_1.POWER_QUERY_RETRIES})`);
                await sleep(settings_1.POWER_QUERY_RETRY_MS);
            }
        }
        throw lastError;
    }
    /**
     * Query whether the zone is powered on.
     *
     * Retries once on ConnectionError — XR units sometimes accept TCP then
     * stay silent for a single request before answering normally.
     */
    async getPowerState(zone) {
        const resolvedZone = this.resolveZone(zone);
        return this.withQueryRetry('Power query', async () => {
            const response = await this.send((0, protocol_1.buildPowerQuery)(resolvedZone), protocol_1.COMMAND_POWER, resolvedZone);
            this.assertOk(response, 'power query');
            return (0, protocol_1.isPowerOn)(response.data);
        });
    }
    /** Power the zone on (discrete RC5 Power On). */
    async powerOn(zone) {
        const resolvedZone = this.resolveZone(zone);
        const response = await this.send((0, protocol_1.buildPowerOn)(resolvedZone), POWER_SET_RESPONSE_COMMANDS, resolvedZone);
        this.assertOk(response, 'power on');
    }
    /** Put the zone into standby (discrete RC5 Power Off). */
    async powerStandby(zone) {
        const resolvedZone = this.resolveZone(zone);
        const response = await this.send((0, protocol_1.buildPowerStandby)(resolvedZone), POWER_SET_RESPONSE_COMMANDS, resolvedZone);
        this.assertOk(response, 'standby');
    }
    /**
     * Set power from a boolean HomeKit On value.
     *
     * XR units sometimes apply RC5 Power On/Off without returning a frame (socket
     * stays open until our timeout). When the ack is missing, settle briefly and
     * confirm via Power query before failing the HomeKit write.
     */
    async setPower(on, zone) {
        const resolvedZone = this.resolveZone(zone);
        try {
            if (on) {
                await this.powerOn(resolvedZone);
            }
            else {
                await this.powerStandby(resolvedZone);
            }
        }
        catch (error) {
            if (!(error instanceof errors_1.ConnectionError)) {
                throw error;
            }
            this.log.debug?.(`Power ${on ? 'on' : 'standby'} ack missing (${error.message}); verifying state`);
            if (await this.verifyPowerState(on, resolvedZone)) {
                return;
            }
            throw error;
        }
    }
    /**
     * Query the absolute volume level (0–99) for the zone.
     *
     * Concurrent callers for the same zone share one in-flight query so a poll
     * tick with multiple volume-preset accessories does not open N sockets.
     * Retries once on ConnectionError (same as power query).
     */
    async getVolume(zone) {
        const resolvedZone = this.resolveZone(zone);
        const existing = this.volumeQueryInFlight.get(resolvedZone);
        if (existing) {
            return existing;
        }
        const pending = this.withQueryRetry('Volume query', async () => {
            const response = await this.send((0, protocol_1.buildVolumeQuery)(resolvedZone), protocol_1.COMMAND_VOLUME, resolvedZone);
            this.assertOk(response, 'volume query');
            return (0, protocol_1.parseVolume)(response.data);
        }).finally(() => {
            this.volumeQueryInFlight.delete(resolvedZone);
        });
        this.volumeQueryInFlight.set(resolvedZone, pending);
        return pending;
    }
    /**
     * Set the absolute volume level (0–99) for the zone.
     *
     * When the set ack is missing (ConnectionError), settle and confirm via
     * volume query before failing — matching power-set resilience.
     */
    async setVolume(level, zone) {
        const resolvedZone = this.resolveZone(zone);
        try {
            const response = await this.send((0, protocol_1.buildVolumeSet)(resolvedZone, level), protocol_1.COMMAND_VOLUME, resolvedZone);
            this.assertOk(response, 'volume set');
        }
        catch (error) {
            if (!(error instanceof errors_1.ConnectionError)) {
                throw error;
            }
            this.log.debug?.(`Volume set ack missing (${error.message}); verifying level ${level}`);
            if (await this.verifyVolumeLevel(level, resolvedZone)) {
                return;
            }
            throw error;
        }
    }
    /**
     * Set volume, retrying politely while the receiver finishes waking.
     *
     * Cold boot often reports power On before volume is accepted (`0x85` / timeouts).
     * Retries every {@link VOLUME_READY_RETRY_INTERVAL_MS} until success or
     * {@link VOLUME_READY_TIMEOUT_MS}, so Shortcuts can Set Volume without a fixed Wait.
     */
    async setVolumeWhenReady(level, zone, options) {
        const resolvedZone = this.resolveZone(zone);
        const startedAt = Date.now();
        const deadline = startedAt + settings_1.VOLUME_READY_TIMEOUT_MS;
        let attempt = 0;
        let notifiedWaiting = false;
        for (;;) {
            attempt += 1;
            try {
                await this.setVolume(level, resolvedZone);
                if (attempt > 1) {
                    this.log.debug?.(`Volume ${level} set after ${attempt} attempts (receiver ready)`);
                }
                return;
            }
            catch (error) {
                const now = Date.now();
                const remaining = deadline - now;
                if (!isRetryableVolumeError(error) || remaining <= 0) {
                    throw error;
                }
                const message = error instanceof Error ? error.message : String(error);
                if (!notifiedWaiting && now - startedAt >= settings_1.VOLUME_READY_NOT_READY_LOG_AFTER_MS) {
                    notifiedWaiting = true;
                    options?.onWaiting?.();
                    this.log.debug?.(`Volume not ready yet (${message}); retrying for up to `
                        + `${Math.round(settings_1.VOLUME_READY_TIMEOUT_MS / 1000)}s`);
                }
                else {
                    this.log.debug?.(`Volume set attempt ${attempt} failed; retrying`);
                }
                await sleep(Math.min(settings_1.VOLUME_READY_RETRY_INTERVAL_MS, remaining));
            }
        }
    }
    /** True when a power query reports the desired on/off state. */
    async verifyPowerState(expectedOn, zone) {
        for (let attempt = 0; attempt < settings_1.POWER_VERIFY_ATTEMPTS; attempt++) {
            await sleep(settings_1.POWER_SETTLE_MS);
            try {
                const actual = await this.getPowerState(zone);
                if (actual === expectedOn) {
                    this.log.debug?.(`Power state verified as ${expectedOn ? 'on' : 'standby'} after missing ack`);
                    return true;
                }
            }
            catch (verifyError) {
                const message = verifyError instanceof Error ? verifyError.message : String(verifyError);
                this.log.debug?.(`Power verify attempt ${attempt + 1} failed: ${message}`);
            }
        }
        return false;
    }
    /** True when a volume query reports the desired level. */
    async verifyVolumeLevel(expectedLevel, zone) {
        for (let attempt = 0; attempt < settings_1.POWER_VERIFY_ATTEMPTS; attempt++) {
            await sleep(settings_1.POWER_SETTLE_MS);
            try {
                const actual = await this.getVolume(zone);
                if (actual === expectedLevel) {
                    this.log.debug?.(`Volume verified as ${expectedLevel} after missing ack`);
                    return true;
                }
            }
            catch (verifyError) {
                const message = verifyError instanceof Error ? verifyError.message : String(verifyError);
                this.log.debug?.(`Volume verify attempt ${attempt + 1} failed: ${message}`);
            }
        }
        return false;
    }
    assertOk(response, operation) {
        if (response.answerCode !== protocol_1.ANSWER_OK) {
            throw new errors_1.ProtocolError(`${operation} rejected: ${(0, protocol_1.describeAnswerCode)(response.answerCode)}`, { answerCode: response.answerCode });
        }
    }
    /**
     * Open a TCP connection, write one request frame, and resolve with the first
     * matching response frame. Always closes the socket afterward.
     *
     * @param expectedCommands - Accept the first response whose command is in this list
     *   (RC5 set may reply with 0x08, and often also emits a Power 0x00 status)
     * @param zone - Zone expected on matching response frames
     */
    send(request, expectedCommands, zone) {
        const { host, port } = this;
        const accepted = Array.isArray(expectedCommands) ? expectedCommands : [expectedCommands];
        this.log.debug?.(`→ ${host}:${port} ${(0, protocol_1.formatFrame)(request)}`);
        return new Promise((resolve, reject) => {
            let settled = false;
            let buffer = Buffer.alloc(0);
            let connectTimer;
            let requestTimer;
            const socket = this.createConnection({ host, port });
            const finish = (error, response) => {
                if (settled) {
                    return;
                }
                settled = true;
                if (connectTimer) {
                    clearTimeout(connectTimer);
                }
                if (requestTimer) {
                    clearTimeout(requestTimer);
                }
                socket.removeAllListeners();
                socket.destroy();
                if (error) {
                    reject(error);
                    return;
                }
                if (!response) {
                    reject(new errors_1.ProtocolError('No response from receiver'));
                    return;
                }
                this.log.debug?.(`← ${host}:${port} cmd=0x${response.command.toString(16)} `
                    + `answer=${(0, protocol_1.describeAnswerCode)(response.answerCode)} data=${(0, protocol_1.formatFrame)(response.data)}`);
                resolve(response);
            };
            connectTimer = setTimeout(() => {
                finish(new errors_1.ConnectionError(`Timed out connecting to ${host}:${port}`));
            }, this.connectTimeoutMs);
            socket.once('connect', () => {
                if (connectTimer) {
                    clearTimeout(connectTimer);
                    connectTimer = undefined;
                }
                requestTimer = setTimeout(() => {
                    const hint = buffer.length > 0 ? ` (received ${(0, protocol_1.formatFrame)(buffer)})` : '';
                    this.log.debug?.(`Timed out waiting for response from ${host}:${port}${hint}`);
                    finish(new errors_1.ConnectionError('Timed out waiting for response'));
                }, this.requestTimeoutMs);
                socket.write(request, (writeError) => {
                    if (writeError) {
                        finish(new errors_1.ConnectionError(`Failed to write to ${host}:${port}: ${writeError.message}`, {
                            cause: writeError,
                        }));
                    }
                });
            });
            socket.on('data', (chunk) => {
                buffer = Buffer.concat([buffer, chunk]);
                if (buffer.length > settings_1.MAX_RESPONSE_BUFFER_BYTES) {
                    finish(new errors_1.ProtocolError(`Response from ${host}:${port} exceeded ${settings_1.MAX_RESPONSE_BUFFER_BYTES} bytes`));
                    return;
                }
                // Drain frames until we find one that matches the request, or wait for more data.
                let remaining = buffer;
                while (remaining.length > 0) {
                    const parsed = (0, protocol_1.tryParseResponse)(remaining);
                    if (!parsed) {
                        buffer = remaining;
                        return;
                    }
                    remaining = remaining.subarray(parsed.consumed);
                    buffer = remaining;
                    const { response } = parsed;
                    if (response.zone !== zone || !accepted.includes(response.command)) {
                        const expected = accepted.map((cmd) => `0x${cmd.toString(16)}`).join('|');
                        this.log.debug?.(`Ignoring unmatched frame zone=${response.zone} cmd=0x${response.command.toString(16)} `
                            + `(expected zone=${zone} cmd=${expected})`);
                        continue;
                    }
                    finish(undefined, response);
                    return;
                }
            });
            socket.once('error', (error) => {
                finish(new errors_1.ConnectionError(`Connection to ${host}:${port} failed: ${error.message}`, {
                    cause: error,
                }));
            });
            socket.once('close', () => {
                if (!settled) {
                    finish(new errors_1.ConnectionError(`Connection to ${host}:${port} closed before a response arrived`));
                }
            });
        });
    }
}
exports.ConcertClient = ConcertClient;
/** True when a volume set failure is likely due to wake / not-ready state. */
function isRetryableVolumeError(error) {
    if (error instanceof errors_1.ConnectionError) {
        return true;
    }
    return error instanceof errors_1.ProtocolError && error.answerCode === protocol_1.ANSWER_INVALID_STATE;
}
function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}
//# sourceMappingURL=client.js.map