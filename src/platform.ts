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
import { PowerAccessory, VolumePresetAccessory } from './devices'
import {
  DEFAULT_MODEL,
  DEFAULT_REFRESH_RATE_SEC,
  PLATFORM_NAME,
  PLUGIN_NAME,
  UUID_PREFIX,
} from './settings'
import type {
  AccessoryContext,
  ConcertPlatformConfig,
  RefreshableAccessory,
  ResolvedAccessory,
} from './types'
import {
  accessoryIdentityKey,
  resolveAccessories,
  resolvePort,
  resolveRefreshRateSec,
  validateConfig,
} from './utils'

/**
 * Registers configured Switch accessories for a Concert receiver and polls
 * their state on a shared timer.
 */
export default class ConcertPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof ServiceClass
  public readonly Characteristic: typeof CharacteristicClass
  public readonly accessories: PlatformAccessory[] = []

  private readonly config: ConcertPlatformConfig
  private readonly handlers: RefreshableAccessory[] = []
  private client?: ConcertClient
  private pollTimer?: ReturnType<typeof setInterval>
  private stopped = false
  /** True when startup validation failed; the platform stays inert. */
  private disabled = false

  constructor(
    public readonly log: Logging,
    config: ConcertPlatformConfig,
    public readonly api: API,
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
   * Create or update Switch accessories for each configured entry and start
   * polling their state.
   */
  private discoverDevices(): void {
    const host = this.config.host.trim()
    const port = resolvePort(this.config.port)
    const model = (this.config.model?.trim() || DEFAULT_MODEL)
    const resolved = resolveAccessories(this.config)

    const keepUuids = new Set(
      resolved.map((accessory) => this.uuidFor(host, port, accessory)),
    )
    this.removeStaleAccessories(keepUuids)

    this.client = new ConcertClient({
      host,
      port,
      logger: this.log,
    })
    this.handlers.length = 0

    for (const accessoryConfig of resolved) {
      const uuid = this.uuidFor(host, port, accessoryConfig)
      const context: AccessoryContext = {
        kind: accessoryConfig.kind,
        host,
        port,
        zone: accessoryConfig.zone,
        model,
        volume: accessoryConfig.volume,
      }

      let accessory = this.accessories.find((cached) => cached.UUID === uuid)
      if (!accessory) {
        this.log.info(
          `Registering accessory "${accessoryConfig.name}" `
          + `(${accessoryIdentityKey(accessoryConfig)}) at ${host}:${port}`,
        )
        accessory = new this.api.platformAccessory(accessoryConfig.name, uuid)
        accessory.context = context
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
        this.accessories.push(accessory)
      } else {
        accessory.context = context
        this.applyAccessoryDisplayName(accessory, accessoryConfig.name)
        this.api.updatePlatformAccessories([accessory])
        this.log.info(
          `Restored accessory "${accessoryConfig.name}" `
          + `(${accessoryIdentityKey(accessoryConfig)}) at ${host}:${port}`,
        )
      }

      this.handlers.push(this.createHandler(accessoryConfig, accessory, this.client))
    }

    this.startPolling()

    for (const handler of this.handlers) {
      void handler.refresh()
    }
  }

  private createHandler(
    config: ResolvedAccessory,
    accessory: PlatformAccessory,
    client: ConcertClient,
  ): RefreshableAccessory {
    if (config.kind === 'power') {
      return new PowerAccessory(this, accessory, client)
    }
    return new VolumePresetAccessory(this, accessory, client)
  }

  private uuidFor(host: string, port: number, accessory: ResolvedAccessory): string {
    return this.api.hap.uuid.generate(
      `${UUID_PREFIX}${host}:${port}:${accessoryIdentityKey(accessory)}`,
    )
  }

  /**
   * Sync the accessory display name onto the PlatformAccessory wrapper and the
   * underlying HAP accessory. Assigning `displayName` alone does not update what
   * Homebridge serializes / publishes after cache restore — use `updateDisplayName`
   * when available (Homebridge ≥1.8).
   */
  private applyAccessoryDisplayName(accessory: PlatformAccessory, name: string): void {
    if (accessory.displayName === name) {
      return
    }
    const previous = accessory.displayName
    if (typeof accessory.updateDisplayName === 'function') {
      accessory.updateDisplayName(name)
    } else {
      accessory.displayName = name
      const hapAccessory = (accessory as PlatformAccessory & {
        _associatedHAPAccessory?: { displayName?: string }
      })._associatedHAPAccessory
      if (hapAccessory) {
        hapAccessory.displayName = name
      }
    }
    this.log.info(`Renamed accessory "${previous}" → "${name}"`)
  }

  /** Unregister cached accessories that are no longer in the configured set. */
  private removeStaleAccessories(keepUuids: Set<string>): void {
    const stale = this.accessories.filter((accessory) => !keepUuids.has(accessory.UUID))
    if (stale.length === 0) {
      return
    }
    for (const accessory of stale) {
      this.log.info(`Removing stale accessory: ${accessory.displayName}`)
    }
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale)
    this.accessories.splice(
      0,
      this.accessories.length,
      ...this.accessories.filter((accessory) => keepUuids.has(accessory.UUID)),
    )
  }

  private startPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
    }
    const refreshSec = resolveRefreshRateSec(
      this.config.options?.refreshRate,
      DEFAULT_REFRESH_RATE_SEC,
    )
    this.log.info(`Polling accessory state every ${refreshSec}s`)
    this.pollTimer = setInterval(() => {
      if (this.stopped || this.handlers.length === 0) {
        return
      }
      for (const handler of this.handlers) {
        void handler.refresh()
      }
    }, refreshSec * 1000)
  }
}
