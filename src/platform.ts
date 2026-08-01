/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Homebridge dynamic platform for AudioControl Concert XR receivers.
 */

import type {
  API,
  Characteristic as CharacteristicClass,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  Service as ServiceClass,
} from 'homebridge'

import { ConcertClient } from './api'
import { ReceiverAccessory } from './devices/receiver'
import {
  DEFAULT_REFRESH_RATE_SEC,
  PLATFORM_NAME,
  PLUGIN_NAME,
  UUID_PREFIX,
} from './settings'
import type { ConcertPlatformConfig, ReceiverContext } from './types'
import {
  resolvePort,
  resolveRefreshRateSec,
  resolveZone,
  validateConfig,
} from './utils'

/**
 * Registers a single Switch accessory for the configured Concert receiver
 * and polls its power state on a timer.
 */
export default class ConcertPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof ServiceClass
  public readonly Characteristic: typeof CharacteristicClass
  public readonly accessories: PlatformAccessory[] = []

  private readonly config: ConcertPlatformConfig
  private handler?: ReceiverAccessory
  private client?: ConcertClient
  private pollTimer?: ReturnType<typeof setInterval>
  private stopped = false
  /** True when startup validation failed; the platform stays inert. */
  private disabled = false

  constructor(
    public readonly log: Logging,
    config: ConcertPlatformConfig,
    private readonly api: API,
  ) {
    this.Service = api.hap.Service
    this.Characteristic = api.hap.Characteristic
    this.config = config

    const { errors, warnings } = validateConfig(config)
    for (const warning of warnings) {
      this.log.warn(warning)
    }
    if (errors.length > 0) {
      for (const error of errors) {
        this.log.error(error)
      }
      this.log.error('Invalid configuration; plugin will not start until it is corrected.')
      this.disabled = true
    } else {
      this.log.info(`Initializing ${this.config.name ?? PLATFORM_NAME} platform`)
    }

    // Always register lifecycle handlers so a disabled platform can still clear
    // orphaned cached accessories and shut down cleanly.
    this.api.on('didFinishLaunching', () => {
      if (this.stopped) {
        return
      }
      if (this.disabled) {
        this.clearCachedAccessories()
        return
      }
      this.discoverDevices()
    })

    this.api.on('shutdown', () => {
      this.stopPolling()
    })
  }

  /**
   * Restore a cached accessory from disk. Handlers are attached later during
   * discovery so we only keep a reference here.
   */
  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info(`Loading cached accessory: ${accessory.displayName}`)
    this.accessories.push(accessory)
  }

  /** Clear the poll timer and mark the platform stopped. */
  private stopPolling(): void {
    this.stopped = true
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = undefined
    }
  }

  /**
   * Unregister every cached accessory. Used when config is invalid so HomeKit
   * does not keep zombie switches with no handlers.
   */
  private clearCachedAccessories(): void {
    if (this.accessories.length === 0) {
      return
    }
    this.log.warn(
      `Unregistering ${this.accessories.length} cached accessory(ies) because configuration is invalid.`,
    )
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [...this.accessories])
    this.accessories.length = 0
  }

  /**
   * Create or update the Switch accessory for the configured receiver and start
   * polling power state.
   */
  private discoverDevices(): void {
    const host = this.config.host.trim()
    const port = resolvePort(this.config.port)
    const zone = resolveZone(this.config.zone)
    const model = (this.config.model?.trim() || 'Concert XR-8S')
    const displayName = (this.config.accessoryName?.trim() || this.config.name?.trim() || PLATFORM_NAME)

    const context: ReceiverContext = { host, port, zone, model }
    const uuid = this.api.hap.uuid.generate(`${UUID_PREFIX}${host}:${port}:z${zone}`)

    // Always drop accessories that no longer match the configured target.
    this.removeStaleAccessories(uuid)

    let accessory = this.accessories.find((cached) => cached.UUID === uuid)
    if (!accessory) {
      this.log.info(`Registering accessory "${displayName}" at ${host}:${port} (zone ${zone})`)
      accessory = new this.api.platformAccessory(displayName, uuid)
      accessory.context = context
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
      this.accessories.push(accessory)
    } else {
      accessory.context = context
      if (accessory.displayName !== displayName) {
        accessory.displayName = displayName
      }
      this.api.updatePlatformAccessories([accessory])
      this.log.info(`Restored accessory "${displayName}" at ${host}:${port} (zone ${zone})`)
    }

    this.client = new ConcertClient({
      host,
      port,
      zone,
      logger: this.log,
    })
    this.handler = new ReceiverAccessory(this, accessory, this.client)
    this.startPolling()

    // Immediate refresh so HomeKit has a real value shortly after launch.
    void this.handler.refresh()
  }

  /** Unregister cached accessories that no longer match the configured target. */
  private removeStaleAccessories(keepUuid: string): void {
    const stale = this.accessories.filter((accessory) => accessory.UUID !== keepUuid)
    if (stale.length === 0) {
      return
    }
    for (const accessory of stale) {
      this.log.info(`Removing stale accessory: ${accessory.displayName}`)
    }
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale)
    this.accessories.splice(0, this.accessories.length, ...this.accessories.filter((a) => a.UUID === keepUuid))
  }

  private startPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
    }
    const refreshSec = resolveRefreshRateSec(
      this.config.options?.refreshRate,
      DEFAULT_REFRESH_RATE_SEC,
    )
    this.log.info(`Polling power state every ${refreshSec}s`)
    this.pollTimer = setInterval(() => {
      if (this.stopped || !this.handler) {
        return
      }
      void this.handler.refresh()
    }, refreshSec * 1000)
  }
}
