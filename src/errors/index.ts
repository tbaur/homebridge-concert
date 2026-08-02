/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Typed errors for Concert protocol I/O.
 */

/** TCP connect / write / timeout failure talking to the receiver. */
export class ConnectionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ConnectionError'
  }
}

/** The receiver replied with a non-success answer code or an unreadable frame. */
export class ProtocolError extends Error {
  /** Present when the error came from a parsed non-OK answer code. */
  readonly answerCode?: number

  constructor(message: string, options?: { cause?: unknown; answerCode?: number }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'ProtocolError'
    this.answerCode = options?.answerCode
  }
}
