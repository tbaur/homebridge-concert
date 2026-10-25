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
    /**
     * True when the query breaker refused this attempt before dialing.
     * The receiver was not contacted, so the attempt is not a new failure.
     */
    readonly paused: boolean;
    constructor(message: string, options?: {
        cause?: unknown;
        paused?: boolean;
    });
}
/** The receiver replied with a non-success answer code or an unreadable frame. */
export declare class ProtocolError extends Error {
    /** Present when the error came from a parsed non-OK answer code. */
    readonly answerCode?: number;
    constructor(message: string, options?: {
        cause?: unknown;
        answerCode?: number;
    });
}
//# sourceMappingURL=index.d.ts.map