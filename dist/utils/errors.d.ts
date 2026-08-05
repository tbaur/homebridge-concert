/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Turning caught values into log-ready text.
 */
/**
 * Describe an unknown caught value for a log line, including its cause.
 *
 * The protocol errors are constructed with `{ cause }` precisely so the
 * underlying `ECONNRESET` / `EPIPE` survives; reading only `.message` throws
 * that away and leaves an operator with nothing to act on.
 */
export declare function describeError(error: unknown): string;
/** Stack trace for debug logging, or an empty string when unavailable. */
export declare function describeErrorStack(error: unknown): string;
//# sourceMappingURL=errors.d.ts.map