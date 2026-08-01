/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Typed errors for Concert protocol I/O.
 */
/** TCP connect / write / timeout failure talking to the receiver. */
export declare class ConnectionError extends Error {
    constructor(message: string, options?: {
        cause?: unknown;
    });
}
/** The receiver replied with a non-success answer code or an unreadable frame. */
export declare class ProtocolError extends Error {
    constructor(message: string, options?: {
        cause?: unknown;
    });
}
//# sourceMappingURL=index.d.ts.map