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

/** Supported HomeKit accessory kinds exposed by this platform. */
export type AccessoryKind = 'power' | 'volumePreset'

/** One entry in the platform `accessories` array. */
export interface ConcertAccessoryConfig {
  /** HomeKit accessory kind. */
  type: AccessoryKind
  /** HomeKit display name. */
  name: string
  /** Zone number (1 = master, 2 = zone 2). Defaults to 1. */
  zone?: number
  /**
   * Target volume level (0–99) for `volumePreset` accessories.
   * Required when `type` is `volumePreset`; ignored for `power`.
   */
  volume?: number
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
  /** Model string shown in Accessory Information. */
  model?: string
  /** HomeKit switches to expose for this receiver. */
  accessories: ConcertAccessoryConfig[]
  options?: {
    /** Polling interval in seconds for accessory state. */
    refreshRate?: number
  }
}

/** A validated accessory ready for UUID generation and handler construction. */
export interface ResolvedAccessory {
  kind: AccessoryKind
  name: string
  zone: number
  /** Present when `kind` is `volumePreset`. */
  volume?: number
}

/** Persisted accessory context for a configured receiver switch. */
export interface AccessoryContext {
  kind: AccessoryKind
  host: string
  port: number
  zone: number
  model: string
  /** Present when `kind` is `volumePreset`. */
  volume?: number
}

/** Common surface for platform-polled accessory handlers. */
export interface RefreshableAccessory {
  refresh(): Promise<void>
}
