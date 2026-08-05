/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Public surface of the receiver client, for the platform and
 * device handlers. Protocol internals are imported from `./protocol` directly
 * by the few places that build or parse frames.
 */

export { ConcertClient, isReceiverNotReadyError } from './client'
export type {
  ConcertClientOptions,
  SetOptions,
} from './client'
export { resolveSourceDefinition } from './protocol'
export type { ProtocolResponse, SourceDefinition, SourceId } from './protocol'
