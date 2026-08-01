"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Typed errors for Concert protocol I/O.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProtocolError = exports.ConnectionError = void 0;
/** TCP connect / write / timeout failure talking to the receiver. */
class ConnectionError extends Error {
    constructor(message, options) {
        super(message, options);
        this.name = 'ConnectionError';
    }
}
exports.ConnectionError = ConnectionError;
/** The receiver replied with a non-success answer code or an unreadable frame. */
class ProtocolError extends Error {
    constructor(message, options) {
        super(message, options);
        this.name = 'ProtocolError';
    }
}
exports.ProtocolError = ProtocolError;
//# sourceMappingURL=index.js.map