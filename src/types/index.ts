/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Type definitions for plugin config and device context.
 */

import type { PlatformConfig } from 'homebridge'

/**
 * Minimal logger surface shared by the TCP client. Any subset of methods may
 * be provided; the Homebridge `Logging` object satisfies it.
 */
export interface PluginLogger {
  debug?: (message: string) => void
  info?: (message: string) => void
  warn?: (message: string) => void
  error?: (message: string) => void
}

/**
 * The full plugin configuration block as it appears in the Homebridge
 * `config.json` platforms array.
 */
export interface ConcertPlatformConfig extends PlatformConfig {
  /** Hostname or IP address of the AudioControl Concert receiver. */
  host: string
  /** TCP control port. Defaults to 50000. */
  port?: number
  /** Display name for the HomeKit accessory. */
  accessoryName?: string
  /** Zone number (1 = master, 2 = zone 2). Defaults to 1. */
  zone?: number
  /** Model string shown in Accessory Information. */
  model?: string
  options?: {
    /** Polling interval in seconds for power state. */
    refreshRate?: number
  }
}

/** Persisted accessory context for a configured receiver. */
export interface ReceiverContext {
  host: string
  port: number
  zone: number
  model: string
}
