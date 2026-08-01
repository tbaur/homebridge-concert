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
    zone;
    connectTimeoutMs;
    requestTimeoutMs;
    log;
    createConnection;
    constructor(options) {
        this.host = options.host;
        this.port = options.port ?? settings_1.DEFAULT_CONTROL_PORT;
        this.zone = options.zone ?? settings_1.DEFAULT_ZONE;
        this.connectTimeoutMs = options.connectTimeoutMs ?? settings_1.DEFAULT_CONNECT_TIMEOUT_MS;
        this.requestTimeoutMs = options.requestTimeoutMs ?? settings_1.DEFAULT_REQUEST_TIMEOUT_MS;
        this.log = options.logger ?? {};
        this.createConnection = options.createConnection ?? node_net_1.default.createConnection;
    }
    /** Query whether the configured zone is powered on. */
    async getPowerState() {
        const response = await this.send((0, protocol_1.buildPowerQuery)(this.zone), protocol_1.COMMAND_POWER);
        this.assertOk(response, 'power query');
        return (0, protocol_1.isPowerOn)(response.data);
    }
    /** Power the configured zone on (discrete RC5 Power On). */
    async powerOn() {
        const response = await this.send((0, protocol_1.buildPowerOn)(this.zone), POWER_SET_RESPONSE_COMMANDS);
        this.assertOk(response, 'power on');
    }
    /** Put the configured zone into standby (discrete RC5 Power Off). */
    async powerStandby() {
        const response = await this.send((0, protocol_1.buildPowerStandby)(this.zone), POWER_SET_RESPONSE_COMMANDS);
        this.assertOk(response, 'standby');
    }
    /** Set power from a boolean HomeKit On value. */
    async setPower(on) {
        if (on) {
            await this.powerOn();
        }
        else {
            await this.powerStandby();
        }
    }
    assertOk(response, operation) {
        if (response.answerCode !== protocol_1.ANSWER_OK) {
            throw new errors_1.ProtocolError(`${operation} rejected: ${(0, protocol_1.describeAnswerCode)(response.answerCode)}`);
        }
    }
    /**
     * Open a TCP connection, write one request frame, and resolve with the first
     * matching response frame. Always closes the socket afterward.
     *
     * @param expectedCommands - Accept the first response whose command is in this list
     *   (RC5 set may reply with 0x08, and often also emits a Power 0x00 status)
     */
    send(request, expectedCommands) {
        const { host, port, zone } = this;
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
                    finish(new errors_1.ConnectionError(`Timed out waiting for response from ${host}:${port}${hint}`));
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
//# sourceMappingURL=client.js.map