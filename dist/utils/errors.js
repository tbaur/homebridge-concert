"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Turning caught values into log-ready text.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.describeError = describeError;
exports.describeErrorStack = describeErrorStack;
/**
 * Describe an unknown caught value for a log line, including its cause.
 *
 * The protocol errors are constructed with `{ cause }` precisely so the
 * underlying `ECONNRESET` / `EPIPE` survives; reading only `.message` throws
 * that away and leaves an operator with nothing to act on.
 */
function describeError(error) {
    if (!(error instanceof Error)) {
        return String(error);
    }
    const { cause } = error;
    if (cause instanceof Error && cause.message !== error.message) {
        return `${error.message} (cause: ${cause.message})`;
    }
    return error.message;
}
/** Stack trace for debug logging, or an empty string when unavailable. */
function describeErrorStack(error) {
    return error instanceof Error && error.stack ? error.stack : '';
}
//# sourceMappingURL=errors.js.map